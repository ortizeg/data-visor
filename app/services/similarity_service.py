"""Qdrant-powered similarity search service.

Manages a local-mode Qdrant client (disk-persisted, no Docker) that
mirrors DINOv2 embeddings from DuckDB.  Collections are created lazily
on first query and can be invalidated when embeddings are re-generated.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, PointStruct, VectorParams

from app.models.similarity import (
    NearDuplicateGroup,
    NearDuplicateProgress,
    NearDuplicateResponse,
)
from app.repositories.duckdb_repo import DuckDBRepo

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Union-Find helpers for grouping near-duplicate pairs
# ---------------------------------------------------------------------------


def _find(parent: dict[str, str], x: str) -> str:
    """Find root with path compression."""
    while parent.get(x, x) != x:
        parent[x] = parent.get(parent[x], parent[x])  # path compression
        x = parent[x]
    return x


def _union(parent: dict[str, str], a: str, b: str) -> None:
    """Union two elements by root."""
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[ra] = rb


class SimilarityService:
    """Qdrant lifecycle manager and similarity query interface."""

    def __init__(self, qdrant_path: str | Path, db: DuckDBRepo) -> None:
        path = Path(qdrant_path)
        path.mkdir(parents=True, exist_ok=True)
        self.client = QdrantClient(path=str(path))
        self.db = db
        self._near_dupe_progress: dict[str, NearDuplicateProgress] = {}
        self._near_dupe_results: dict[str, NearDuplicateResponse] = {}

    def ensure_collection(self, dataset_id: str) -> str:
        """Create Qdrant collection if not exists, sync from DuckDB."""
        collection_name = f"embeddings_{dataset_id}"
        if not self.client.collection_exists(collection_name):
            self.client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(size=768, distance=Distance.COSINE),
            )
            self._sync_from_duckdb(dataset_id, collection_name)
        return collection_name

    def _sync_from_duckdb(self, dataset_id: str, collection_name: str) -> None:
        """Load embeddings from DuckDB embeddings table and upsert to Qdrant."""
        cursor = self.db.connection.cursor()
        try:
            rows = cursor.execute(
                "SELECT sample_id, vector FROM embeddings "
                "WHERE dataset_id = ? AND vector IS NOT NULL",
                [dataset_id],
            ).fetchall()

            if not rows:
                logger.info(
                    "No embeddings found in DuckDB for dataset %s", dataset_id
                )
                return

            points = [
                PointStruct(
                    id=idx,
                    vector=list(row[1]),  # FLOAT[768] from DuckDB -> list
                    payload={"sample_id": row[0], "dataset_id": dataset_id},
                )
                for idx, row in enumerate(rows)
            ]

            BATCH_SIZE = 500
            for i in range(0, len(points), BATCH_SIZE):
                self.client.upsert(
                    collection_name=collection_name,
                    points=points[i : i + BATCH_SIZE],
                )

            logger.info(
                "Synced %d embeddings to Qdrant collection %s",
                len(points),
                collection_name,
            )
        finally:
            cursor.close()

    def invalidate_collection(self, dataset_id: str) -> None:
        """Drop collection so it re-syncs on next query.

        Call after re-embedding to ensure Qdrant reflects the latest vectors.
        """
        collection_name = f"embeddings_{dataset_id}"
        if self.client.collection_exists(collection_name):
            self.client.delete_collection(collection_name)
            logger.info("Invalidated Qdrant collection %s", collection_name)

    def find_similar(
        self, dataset_id: str, sample_id: str, limit: int = 20
    ) -> list[dict]:
        """Find similar images by embedding distance.

        Returns a list of dicts with ``sample_id`` and ``score`` keys,
        sorted by descending similarity.  The query sample is excluded.
        """
        collection_name = self.ensure_collection(dataset_id)

        # Get query vector from DuckDB
        cursor = self.db.connection.cursor()
        try:
            row = cursor.execute(
                "SELECT vector FROM embeddings "
                "WHERE dataset_id = ? AND sample_id = ?",
                [dataset_id, sample_id],
            ).fetchone()
        finally:
            cursor.close()

        if not row or row[0] is None:
            return []

        results = self.client.query_points(
            collection_name=collection_name,
            query=list(row[0]),
            limit=limit + 1,  # +1 to exclude self
            with_payload=True,
        ).points

        return [
            {"sample_id": r.payload["sample_id"], "score": r.score}
            for r in results
            if r.payload["sample_id"] != sample_id
        ][:limit]

    # ------------------------------------------------------------------
    # Near-duplicate detection
    # ------------------------------------------------------------------

    def find_near_duplicates(
        self,
        dataset_id: str,
        threshold: float = 0.95,
        limit_per_query: int = 10,
    ) -> NearDuplicateResponse:
        """Pairwise similarity scan with union-find grouping.

        Scrolls all points from Qdrant, queries each for neighbours above
        *threshold*, then groups connected pairs via union-find.

        Progress is tracked in ``_near_dupe_progress`` for SSE streaming.
        """
        try:
            self._near_dupe_progress[dataset_id] = NearDuplicateProgress(
                status="scanning",
                progress=0.0,
                scanned=0,
                total=0,
                groups_found=0,
                message="Preparing...",
            )

            collection_name = self.ensure_collection(dataset_id)

            # Scroll all points from the collection
            all_points: list = []
            offset = None
            while True:
                points, next_offset = self.client.scroll(
                    collection_name=collection_name,
                    limit=500,
                    with_vectors=True,
                    with_payload=True,
                    offset=offset,
                )
                all_points.extend(points)
                if next_offset is None:
                    break
                offset = next_offset

            total = len(all_points)
            if total == 0:
                result = NearDuplicateResponse(
                    groups=[], total_groups=0, total_duplicates=0, threshold=threshold
                )
                self._near_dupe_results[dataset_id] = result
                self._near_dupe_progress[dataset_id] = NearDuplicateProgress(
                    status="complete",
                    progress=1.0,
                    scanned=0,
                    total=0,
                    groups_found=0,
                    message="No embeddings found",
                )
                return result

            self._near_dupe_progress[dataset_id] = NearDuplicateProgress(
                status="scanning",
                progress=0.0,
                scanned=0,
                total=total,
                groups_found=0,
                message=f"Scanning {total} embeddings...",
            )

            parent: dict[str, str] = {}
            all_sample_ids: set[str] = set()

            for i, point in enumerate(all_points):
                sid = point.payload["sample_id"]
                all_sample_ids.add(sid)

                results = self.client.query_points(
                    collection_name=collection_name,
                    query=point.vector,
                    score_threshold=threshold,
                    limit=limit_per_query,
                    with_payload=True,
                ).points

                for r in results:
                    r_sid = r.payload["sample_id"]
                    if r_sid != sid:
                        _union(parent, sid, r_sid)

                # Update progress periodically (every 10 points or last)
                if i % 10 == 0 or i == total - 1:
                    self._near_dupe_progress[dataset_id] = NearDuplicateProgress(
                        status="scanning",
                        progress=(i + 1) / total,
                        scanned=i + 1,
                        total=total,
                        groups_found=0,
                        message=f"Scanning {i + 1}/{total} embeddings...",
                    )

            # Grouping phase
            self._near_dupe_progress[dataset_id] = NearDuplicateProgress(
                status="grouping",
                progress=1.0,
                scanned=total,
                total=total,
                groups_found=0,
                message="Grouping duplicates...",
            )

            # Group by root
            groups_map: dict[str, list[str]] = defaultdict(list)
            for sid in all_sample_ids:
                if sid in parent:  # only those involved in a union
                    root = _find(parent, sid)
                    groups_map[root].append(sid)

            # Filter to groups of size >= 2, sort by size descending
            groups = [
                NearDuplicateGroup(sample_ids=sorted(members), size=len(members))
                for members in groups_map.values()
                if len(members) >= 2
            ]
            groups.sort(key=lambda g: g.size, reverse=True)

            total_duplicates = sum(g.size for g in groups)
            result = NearDuplicateResponse(
                groups=groups,
                total_groups=len(groups),
                total_duplicates=total_duplicates,
                threshold=threshold,
            )
            self._near_dupe_results[dataset_id] = result

            self._near_dupe_progress[dataset_id] = NearDuplicateProgress(
                status="complete",
                progress=1.0,
                scanned=total,
                total=total,
                groups_found=len(groups),
                message=f"Found {len(groups)} duplicate groups ({total_duplicates} images)",
            )

            logger.info(
                "Near-duplicate scan complete for %s: %d groups, %d images",
                dataset_id,
                len(groups),
                total_duplicates,
            )
            return result

        except Exception:
            logger.exception(
                "Near-duplicate detection failed for dataset %s", dataset_id
            )
            self._near_dupe_progress[dataset_id] = NearDuplicateProgress(
                status="error",
                progress=0.0,
                scanned=0,
                total=0,
                groups_found=0,
                message="Detection failed -- check server logs",
            )
            raise

    def get_near_dupe_progress(self, dataset_id: str) -> NearDuplicateProgress:
        """Return current near-duplicate detection progress."""
        return self._near_dupe_progress.get(
            dataset_id,
            NearDuplicateProgress(
                status="idle",
                progress=0,
                scanned=0,
                total=0,
                groups_found=0,
                message="Not started",
            ),
        )

    def get_near_dupe_results(
        self, dataset_id: str
    ) -> NearDuplicateResponse | None:
        """Return cached near-duplicate results, or None if not yet run."""
        return self._near_dupe_results.get(dataset_id)

    def is_near_dupe_running(self, dataset_id: str) -> bool:
        """Check if near-duplicate detection is currently running."""
        p = self._near_dupe_progress.get(dataset_id)
        return p is not None and p.status in ("scanning", "grouping")

    def close(self) -> None:
        """Close the Qdrant client."""
        self.client.close()
