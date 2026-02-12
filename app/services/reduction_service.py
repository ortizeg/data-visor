"""Dimensionality reduction service using scikit-learn t-SNE.

Loads 768-dim embeddings from DuckDB, runs t-SNE to produce 2D (x, y)
coordinates, and writes them back to the embeddings table for scatter-plot
visualization.

Note: The original plan called for umap-learn, but numba/llvmlite are
incompatible with Python 3.14.  scikit-learn's t-SNE provides the same
fit_transform API and produces high-quality 2D layouts for CV embeddings.
"""

from __future__ import annotations

import logging
import traceback

import numpy as np
from sklearn.manifold import TSNE

from app.models.embedding import ReductionProgress
from app.repositories.duckdb_repo import DuckDBRepo

logger = logging.getLogger(__name__)


class ReductionService:
    """Manages dimensionality reduction from 768-dim to 2D coordinates.

    Progress is tracked via an in-memory dict that SSE endpoints poll.
    The actual reduction runs as a FastAPI background task so the POST
    endpoint returns 202 immediately.
    """

    def __init__(self, db: DuckDBRepo) -> None:
        self.db = db
        self._tasks: dict[str, ReductionProgress] = {}

    def get_progress(self, dataset_id: str) -> ReductionProgress:
        """Return the current progress for a dataset's reduction task."""
        return self._tasks.get(
            dataset_id, ReductionProgress(status="idle")
        )

    def is_running(self, dataset_id: str) -> bool:
        """Check whether reduction is currently running or fitting."""
        task = self._tasks.get(dataset_id)
        return task is not None and task.status in ("running", "fitting")

    def reduce_embeddings(
        self,
        dataset_id: str,
        perplexity: float = 30.0,
    ) -> None:
        """Background task: reduce embeddings to 2D via t-SNE.

        1. Load all 768-dim vectors from the embeddings table.
        2. Run t-SNE with ``random_state=42`` for reproducible layouts.
        3. UPDATE each row's x, y columns with the 2D coordinates.

        Re-running overwrites previous coordinates (no duplicates).
        """
        self._tasks[dataset_id] = ReductionProgress(
            status="running",
            message="Loading embeddings from database",
        )

        cursor = self.db.connection.cursor()
        try:
            results = cursor.execute(
                "SELECT sample_id, vector FROM embeddings "
                "WHERE dataset_id = ? ORDER BY sample_id",
                [dataset_id],
            ).fetchall()

            if not results:
                self._tasks[dataset_id] = ReductionProgress(
                    status="error",
                    message="No embeddings found. Run embedding generation first.",
                )
                return

            sample_ids = [row[0] for row in results]
            vectors = np.array([row[1] for row in results])

            n_samples = len(vectors)
            # t-SNE perplexity must be < n_samples; clamp to safe value
            effective_perplexity = min(perplexity, max(1.0, n_samples - 1))

            self._tasks[dataset_id] = ReductionProgress(
                status="fitting",
                message=f"Running t-SNE on {n_samples} embeddings...",
            )

            reducer = TSNE(
                n_components=2,
                perplexity=effective_perplexity,
                metric="cosine",
                random_state=42,
                init="pca",
            )
            coords_2d = reducer.fit_transform(vectors)  # shape: (N, 2)

            # Write 2D coordinates back to DuckDB
            for sid, coord in zip(sample_ids, coords_2d):
                cursor.execute(
                    "UPDATE embeddings SET x = ?, y = ? "
                    "WHERE dataset_id = ? AND sample_id = ?",
                    [float(coord[0]), float(coord[1]), dataset_id, sid],
                )

            self._tasks[dataset_id] = ReductionProgress(
                status="complete",
                message=f"Reduced {n_samples} embeddings to 2D",
            )
            logger.info(
                "Reduction complete for dataset %s: %d embeddings -> 2D",
                dataset_id,
                n_samples,
            )

        except Exception as e:
            self._tasks[dataset_id] = ReductionProgress(
                status="error", message=str(e)
            )
            logger.error(
                "Reduction failed for dataset %s:\n%s",
                dataset_id,
                traceback.format_exc(),
            )
        finally:
            cursor.close()

    def get_coordinates(
        self,
        dataset_id: str,
        cursor,
    ) -> list[dict]:
        """Return 2D scatter-plot coordinates for a dataset.

        Joins the embeddings table with the samples table to include
        ``file_name`` and ``thumbnail_path`` for each point.  Only rows
        with non-NULL x/y (i.e., reduction has been run) are returned.
        """
        result = cursor.execute(
            """
            SELECT e.sample_id, e.x, e.y, s.file_name, s.thumbnail_path
            FROM embeddings e
            JOIN samples s ON e.sample_id = s.id AND e.dataset_id = s.dataset_id
            WHERE e.dataset_id = ? AND e.x IS NOT NULL
            ORDER BY e.sample_id
            """,
            [dataset_id],
        ).fetchall()
        return [
            {
                "sampleId": r[0],
                "x": r[1],
                "y": r[2],
                "fileName": r[3],
                "thumbnailPath": r[4],
            }
            for r in result
        ]
