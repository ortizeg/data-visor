"""End-to-end ingestion tests.

Tests the IngestionService directly (service-level) and the
POST /datasets/ingest SSE endpoint, plus datasets CRUD endpoints.
"""

from __future__ import annotations

import json
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


# ------------------------------------------------------------------ #
# Helper: run ingestion via service (not API) for fast setup
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

    events = list(
        service.ingest_with_progress(
            annotation_path=annotation_path,
            image_dir=image_dir,
        )
    )
    # Last event is "complete" and carries dataset info
    assert events[-1].stage == "complete"

    # Extract dataset_id from DB (it was generated inside the service)
    cursor = db.connection.cursor()
    try:
        row = cursor.execute("SELECT id FROM datasets").fetchone()
    finally:
        cursor.close()
    assert row is not None
    return row[0]


# ------------------------------------------------------------------ #
# Service-level tests
# ------------------------------------------------------------------ #


class TestIngestionService:
    """Test IngestionService.ingest_with_progress directly."""

    def test_ingest_coco_dataset(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        tmp_path: Path,
    ) -> None:
        """Full ingestion produces expected progress stages and DB state."""
        storage = StorageBackend()
        thumb_dir = tmp_path / "thumbs"
        thumb_dir.mkdir()
        image_service = ImageService(cache_dir=thumb_dir, storage=storage)
        plugin_registry = PluginRegistry()

        service = IngestionService(
            db=db,
            storage=storage,
            image_service=image_service,
            plugin_registry=plugin_registry,
        )

        events = list(
            service.ingest_with_progress(
                annotation_path=str(SMALL_COCO),
                image_dir=str(sample_images_dir),
            )
        )

        # Verify stages appear in order
        stages = [e.stage for e in events]
        assert stages[0] == "categories"
        assert "parsing_images" in stages
        assert "parsing_annotations" in stages
        assert "thumbnails" in stages
        assert stages[-1] == "complete"

        # Verify final event counts
        complete = events[-1]
        assert complete.current == 10  # 10 images
        assert "17 annotations" in complete.message

        # Verify DB state
        cursor = db.connection.cursor()
        try:
            ds_count = cursor.execute(
                "SELECT COUNT(*) FROM datasets"
            ).fetchone()[0]
            sample_count = cursor.execute(
                "SELECT COUNT(*) FROM samples"
            ).fetchone()[0]
            ann_count = cursor.execute(
                "SELECT COUNT(*) FROM annotations"
            ).fetchone()[0]
            cat_count = cursor.execute(
                "SELECT COUNT(*) FROM categories"
            ).fetchone()[0]
        finally:
            cursor.close()

        assert ds_count == 1
        assert sample_count == 10
        assert ann_count == 17
        assert cat_count == 3

    def test_plugin_hooks_fire(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        tmp_path: Path,
    ) -> None:
        """Plugin on_ingest_start and on_ingest_complete are called."""
        storage = StorageBackend()
        thumb_dir = tmp_path / "thumbs"
        thumb_dir.mkdir()
        image_service = ImageService(cache_dir=thumb_dir, storage=storage)

        # Track hook calls
        hook_calls: list[str] = []

        from app.plugins.base_plugin import BasePlugin, PluginContext
        from typing import Any

        class TrackingPlugin(BasePlugin):
            @property
            def name(self) -> str:
                return "tracker"

            def on_ingest_start(self, *, context: PluginContext) -> None:
                hook_calls.append("start")

            def on_ingest_complete(
                self, *, context: PluginContext, stats: dict[str, Any]
            ) -> None:
                hook_calls.append("complete")

        registry = PluginRegistry()
        registry.register_plugin(TrackingPlugin())

        service = IngestionService(
            db=db,
            storage=storage,
            image_service=image_service,
            plugin_registry=registry,
        )

        # Consume the generator fully
        list(
            service.ingest_with_progress(
                annotation_path=str(SMALL_COCO),
                image_dir=str(sample_images_dir),
            )
        )

        assert "start" in hook_calls
        assert "complete" in hook_calls


# ------------------------------------------------------------------ #
# API-level tests
# ------------------------------------------------------------------ #


class TestDatasetsAPI:
    """Test datasets router endpoints after ingestion."""

    async def test_ingest_sse_streams_events(
        self,
        full_app_client: httpx.AsyncClient,
        sample_images_dir: Path,
    ) -> None:
        """POST /datasets/ingest returns SSE events."""
        async with full_app_client as client:
            response = await client.post(
                "/datasets/ingest",
                json={
                    "annotation_path": str(SMALL_COCO),
                    "image_dir": str(sample_images_dir),
                },
            )
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"]

            # Parse SSE events from response body
            events = []
            for line in response.text.strip().split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))

            # Verify stages
            stages = [e["stage"] for e in events]
            assert "categories" in stages
            assert "parsing_images" in stages
            assert "parsing_annotations" in stages
            assert "complete" in stages

            # Verify final event
            final = events[-1]
            assert final["stage"] == "complete"
            assert final["current"] == 10

    async def test_get_datasets_after_ingest(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """GET /datasets returns ingested dataset with correct counts."""
        _run_ingestion(db, str(SMALL_COCO), str(sample_images_dir), tmp_path)

        async with full_app_client as client:
            response = await client.get("/datasets")

        assert response.status_code == 200
        data = response.json()
        assert len(data["datasets"]) == 1

        ds = data["datasets"][0]
        assert ds["image_count"] == 10
        assert ds["annotation_count"] == 17
        assert ds["category_count"] == 3
        assert ds["format"] == "coco"

    async def test_get_dataset_by_id(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """GET /datasets/{id} returns the specific dataset."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.get(f"/datasets/{dataset_id}")

        assert response.status_code == 200
        ds = response.json()
        assert ds["id"] == dataset_id
        assert ds["image_count"] == 10

    async def test_get_dataset_not_found(
        self,
        full_app_client: httpx.AsyncClient,
    ) -> None:
        """GET /datasets/{id} returns 404 for nonexistent dataset."""
        async with full_app_client as client:
            response = await client.get("/datasets/nonexistent-id")
        assert response.status_code == 404

    async def test_delete_dataset(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """DELETE /datasets/{id} removes dataset and all related data."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.delete(f"/datasets/{dataset_id}")
            assert response.status_code == 204

            # Verify dataset is gone
            response = await client.get("/datasets")
            assert response.json()["datasets"] == []

        # Verify related data is gone
        cursor = db.connection.cursor()
        try:
            samples = cursor.execute(
                "SELECT COUNT(*) FROM samples WHERE dataset_id = ?",
                [dataset_id],
            ).fetchone()[0]
            anns = cursor.execute(
                "SELECT COUNT(*) FROM annotations WHERE dataset_id = ?",
                [dataset_id],
            ).fetchone()[0]
            cats = cursor.execute(
                "SELECT COUNT(*) FROM categories WHERE dataset_id = ?",
                [dataset_id],
            ).fetchone()[0]
        finally:
            cursor.close()

        assert samples == 0
        assert anns == 0
        assert cats == 0
