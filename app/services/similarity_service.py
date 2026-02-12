"""Qdrant-powered similarity search service.

Manages a local-mode Qdrant client (disk-persisted, no Docker) that
mirrors DINOv2 embeddings from DuckDB.  Collections are created lazily
on first query and can be invalidated when embeddings are re-generated.
"""

from __future__ import annotations

import logging
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, PointStruct, VectorParams

from app.repositories.duckdb_repo import DuckDBRepo

logger = logging.getLogger(__name__)


class SimilarityService:
    """Qdrant lifecycle manager and similarity query interface."""

    def __init__(self, qdrant_path: str | Path, db: DuckDBRepo) -> None:
        path = Path(qdrant_path)
        path.mkdir(parents=True, exist_ok=True)
        self.client = QdrantClient(path=str(path))
        self.db = db

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

    def close(self) -> None:
        """Close the Qdrant client."""
        self.client.close()
