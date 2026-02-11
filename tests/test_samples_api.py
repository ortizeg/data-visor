"""Tests for samples and images API endpoints.

Relies on the ingestion helper to populate the DB before testing
query and image-serving endpoints.
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
# Samples endpoint tests
# ------------------------------------------------------------------ #


class TestSamplesAPI:
    """Test GET /samples endpoints."""

    async def test_get_samples_paginated(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """GET /samples returns paginated results."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.get(
                "/samples", params={"dataset_id": dataset_id}
            )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 10
        assert len(data["items"]) == 10
        assert data["offset"] == 0
        assert data["limit"] == 50

    async def test_get_samples_with_limit(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """Verify limit parameter restricts result count."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.get(
                "/samples",
                params={"dataset_id": dataset_id, "limit": 3},
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 3
        assert data["total"] == 10
        assert data["limit"] == 3

    async def test_get_samples_with_offset(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """Verify offset parameter skips results."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.get(
                "/samples",
                params={"dataset_id": dataset_id, "offset": 8, "limit": 50},
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2  # 10 total - 8 offset = 2
        assert data["total"] == 10

    async def test_get_sample_annotations(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """GET /samples/{id}/annotations returns annotations for a sample."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        # Image 1 has 2 annotations in the fixture
        async with full_app_client as client:
            response = await client.get(
                "/samples/1/annotations",
                params={"dataset_id": dataset_id},
            )

        assert response.status_code == 200
        annotations = response.json()
        assert len(annotations) == 2
        # Verify annotation structure
        ann = annotations[0]
        assert "id" in ann
        assert "category_name" in ann
        assert "bbox_x" in ann
        assert "source" in ann

    async def test_get_samples_category_filter(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """GET /samples with category filter returns only matching samples."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.get(
                "/samples",
                params={"dataset_id": dataset_id, "category": "dog"},
            )

        assert response.status_code == 200
        data = response.json()
        # "dog" annotations are on images 2, 5, 7, 10 (4 images)
        assert data["total"] == 4


# ------------------------------------------------------------------ #
# Images endpoint tests
# ------------------------------------------------------------------ #


class TestImagesAPI:
    """Test GET /images/{dataset_id}/{sample_id} endpoint."""

    async def test_get_image_thumbnail(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """GET /images/.../...?size=medium returns a WebP thumbnail."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.get(
                f"/images/{dataset_id}/1",
                params={"size": "medium"},
            )

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/webp"
        # Verify it's actual WebP content (starts with RIFF...WEBP)
        assert response.content[:4] == b"RIFF"
        assert response.content[8:12] == b"WEBP"

    async def test_get_image_original(
        self,
        db: DuckDBRepo,
        sample_images_dir: Path,
        full_app_client: httpx.AsyncClient,
        tmp_path: Path,
    ) -> None:
        """GET /images/.../...?size=original returns the original JPEG."""
        dataset_id = _run_ingestion(
            db, str(SMALL_COCO), str(sample_images_dir), tmp_path
        )

        async with full_app_client as client:
            response = await client.get(
                f"/images/{dataset_id}/1",
                params={"size": "original"},
            )

        assert response.status_code == 200
        # JPEG starts with FF D8
        assert response.content[:2] == b"\xff\xd8"

    async def test_get_image_not_found(
        self,
        full_app_client: httpx.AsyncClient,
    ) -> None:
        """GET /images/{dataset_id}/nonexistent returns 404."""
        async with full_app_client as client:
            response = await client.get(
                "/images/fake-dataset/nonexistent-sample",
                params={"size": "medium"},
            )
        assert response.status_code == 404

    async def test_get_image_invalid_size(
        self,
        full_app_client: httpx.AsyncClient,
    ) -> None:
        """GET /images/...?size=invalid returns 400."""
        async with full_app_client as client:
            response = await client.get(
                "/images/ds/sample",
                params={"size": "huge"},
            )
        assert response.status_code == 400
