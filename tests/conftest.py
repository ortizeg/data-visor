"""Shared pytest fixtures for VisionLens tests."""

from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from app.plugins.registry import PluginRegistry
from app.repositories.duckdb_repo import DuckDBRepo
from app.repositories.storage import StorageBackend
from app.routers import datasets, images, samples
from app.services.image_service import ImageService


@pytest.fixture()
def tmp_db_path(tmp_path: Path) -> Path:
    """Return a temporary DuckDB file path."""
    return tmp_path / "test.duckdb"


@pytest.fixture()
def db(tmp_db_path: Path) -> DuckDBRepo:
    """Create a DuckDBRepo with a temporary database, initialize schema, then close."""
    repo = DuckDBRepo(tmp_db_path)
    repo.initialize_schema()
    yield repo
    repo.close()


@pytest.fixture()
async def app_client(db: DuckDBRepo, tmp_path: Path) -> httpx.AsyncClient:
    """Create a FastAPI test app with the test DB and yield an async HTTP client."""

    test_app = FastAPI()

    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @test_app.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "ok"}

    test_app.state.db = db

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=test_app),
        base_url="http://testserver",
    ) as client:
        yield client


@pytest.fixture()
def sample_images_dir(tmp_path: Path) -> Path:
    """Create a directory of small test JPEG images matching small_coco.json."""
    img_dir = tmp_path / "sample_images"
    img_dir.mkdir()
    # Create 10 test images matching the fixture
    image_specs = [
        ("img_001.jpg", 1920, 1080),
        ("img_002.jpg", 1280, 720),
        ("img_003.jpg", 640, 480),
        ("img_004.jpg", 800, 600),
        ("img_005.jpg", 1024, 768),
        ("img_006.jpg", 1920, 1080),
        ("img_007.jpg", 3840, 2160),
        ("img_008.jpg", 512, 512),
        ("img_009.jpg", 1600, 1200),
        ("img_010.jpg", 2560, 1440),
    ]
    for name, w, h in image_specs:
        # Create small images (scaled down to save time)
        img = Image.new("RGB", (min(w, 64), min(h, 64)), color="blue")
        img.save(img_dir / name, "JPEG")
    return img_dir


@pytest.fixture()
def full_app_client(
    db: DuckDBRepo, tmp_path: Path
) -> httpx.AsyncClient:
    """Create a fully wired FastAPI test app with all services and routers."""
    test_app = FastAPI()

    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Wire services onto app.state
    test_app.state.db = db
    test_app.state.storage = StorageBackend()

    thumb_dir = tmp_path / "thumbnails"
    thumb_dir.mkdir()
    test_app.state.image_service = ImageService(
        cache_dir=thumb_dir,
        storage=test_app.state.storage,
    )
    test_app.state.plugin_registry = PluginRegistry()

    # Include routers
    test_app.include_router(datasets.router)
    test_app.include_router(samples.router)
    test_app.include_router(images.router)

    @test_app.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "ok"}

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=test_app),
        base_url="http://testserver",
    )
