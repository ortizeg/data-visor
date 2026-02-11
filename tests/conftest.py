"""Shared pytest fixtures for VisionLens tests."""

from pathlib import Path

import pytest
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.repositories.duckdb_repo import DuckDBRepo


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
