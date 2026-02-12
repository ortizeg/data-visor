"""Smoke tests for application health and database initialization."""

import pytest

from app.repositories.duckdb_repo import DuckDBRepo


def test_db_creates_all_tables(db: DuckDBRepo) -> None:
    """DuckDB schema initialization creates all tables."""
    tables = db.connection.execute("SHOW TABLES").fetchall()
    table_names = sorted(t[0] for t in tables)
    assert table_names == [
        "annotations", "categories", "datasets", "embeddings",
        "samples", "saved_views",
    ]


async def test_health_endpoint(app_client) -> None:
    """GET /health returns status ok."""
    response = await app_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
