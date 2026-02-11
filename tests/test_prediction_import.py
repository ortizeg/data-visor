"""Integration tests for the prediction import pipeline.

Tests the POST /datasets/{dataset_id}/predictions endpoint and verifies
that predictions are stored correctly alongside ground truth annotations.
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from app.plugins.registry import PluginRegistry
from app.repositories.duckdb_repo import DuckDBRepo
from app.repositories.storage import StorageBackend
from app.services.image_service import ImageService
from app.services.ingestion import IngestionService

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SMALL_COCO = FIXTURES_DIR / "small_coco.json"
COCO_PREDICTIONS = FIXTURES_DIR / "coco_predictions.json"


# ------------------------------------------------------------------ #
# Helper: run ingestion via service for fast setup
# ------------------------------------------------------------------ #


def _run_ingestion(
    db: DuckDBRepo,
    annotation_path: str,
    image_dir: str,
    tmp_path: Path,
) -> str:
    """Run the full ingestion pipeline and return the dataset_id."""
    storage = StorageBackend()
    thumb_dir = tmp_path / "thumbs"
    thumb_dir.mkdir(exist_ok=True)
    image_service = ImageService(cache_dir=thumb_dir, storage=storage)
    plugin_registry = PluginRegistry()

    service = IngestionService(
        db=db,
        storage=storage,
        image_service=image_service,
        plugin_registry=plugin_registry,
    )

    list(
        service.ingest_with_progress(
            annotation_path=annotation_path,
            image_dir=image_dir,
        )
    )

    cursor = db.connection.cursor()
    try:
        row = cursor.execute("SELECT id FROM datasets").fetchone()
    finally:
        cursor.close()
    assert row is not None
    return row[0]


# ------------------------------------------------------------------ #
# Prediction import tests
# ------------------------------------------------------------------ #


class TestPredictionImport:
    """Test POST /datasets/{dataset_id}/predictions endpoint."""

    async def test_import_predictions_success(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """Importing predictions stores them with source='prediction'."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.post(
                f"/datasets/{dataset_id}/predictions",
                json={"prediction_path": str(COCO_PREDICTIONS)},
            )

        assert response.status_code == 200
        data = response.json()
        # 9 predictions in fixture, 1 has unmapped category_id=999
        assert data["prediction_count"] == 8
        assert data["skipped_count"] == 1
        assert data["dataset_id"] == dataset_id

        # Verify predictions are in the database with correct source
        cursor = db.connection.cursor()
        try:
            pred_count = cursor.execute(
                "SELECT COUNT(*) FROM annotations "
                "WHERE dataset_id = ? AND source = 'prediction'",
                [dataset_id],
            ).fetchone()[0]
            # Verify confidence values are set
            null_conf = cursor.execute(
                "SELECT COUNT(*) FROM annotations "
                "WHERE dataset_id = ? AND source = 'prediction' "
                "AND confidence IS NULL",
                [dataset_id],
            ).fetchone()[0]
            # Verify dataset prediction_count was updated
            ds_pred_count = cursor.execute(
                "SELECT prediction_count FROM datasets WHERE id = ?",
                [dataset_id],
            ).fetchone()[0]
        finally:
            cursor.close()

        assert pred_count == 8
        assert null_conf == 0  # All predictions have confidence scores
        assert ds_pred_count == 8

    async def test_import_predictions_replaces_existing(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """Re-importing predictions replaces previous ones (no duplicates)."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            # Import predictions twice
            await client.post(
                f"/datasets/{dataset_id}/predictions",
                json={"prediction_path": str(COCO_PREDICTIONS)},
            )
            response = await client.post(
                f"/datasets/{dataset_id}/predictions",
                json={"prediction_path": str(COCO_PREDICTIONS)},
            )

        assert response.status_code == 200

        # Should still be 8 predictions, not 16
        cursor = db.connection.cursor()
        try:
            pred_count = cursor.execute(
                "SELECT COUNT(*) FROM annotations "
                "WHERE dataset_id = ? AND source = 'prediction'",
                [dataset_id],
            ).fetchone()[0]
        finally:
            cursor.close()

        assert pred_count == 8

    async def test_import_predictions_preserves_ground_truth(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """Importing predictions never touches ground truth annotations."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        # Count ground truth before prediction import
        cursor = db.connection.cursor()
        try:
            gt_before = cursor.execute(
                "SELECT COUNT(*) FROM annotations "
                "WHERE dataset_id = ? AND source = 'ground_truth'",
                [dataset_id],
            ).fetchone()[0]
        finally:
            cursor.close()

        async with full_app_client as client:
            response = await client.post(
                f"/datasets/{dataset_id}/predictions",
                json={"prediction_path": str(COCO_PREDICTIONS)},
            )

        assert response.status_code == 200

        # Ground truth count should be unchanged
        cursor = db.connection.cursor()
        try:
            gt_after = cursor.execute(
                "SELECT COUNT(*) FROM annotations "
                "WHERE dataset_id = ? AND source = 'ground_truth'",
                [dataset_id],
            ).fetchone()[0]
        finally:
            cursor.close()

        assert gt_before == 17  # Original COCO fixture has 17 annotations
        assert gt_after == 17

    async def test_import_predictions_unknown_dataset(
        self,
        full_app_client: httpx.AsyncClient,
    ) -> None:
        """POST predictions to nonexistent dataset returns 404."""
        async with full_app_client as client:
            response = await client.post(
                "/datasets/nonexistent-id/predictions",
                json={"prediction_path": str(COCO_PREDICTIONS)},
            )
        assert response.status_code == 404
