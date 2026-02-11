"""FastAPI dependency injection for DuckDB and future services."""

from collections.abc import Generator
from typing import Any

import duckdb
from fastapi import Depends, Request

from app.repositories.duckdb_repo import DuckDBRepo


def get_db(request: Request) -> DuckDBRepo:
    """Return the application-wide DuckDBRepo stored on app.state."""
    return request.app.state.db


def get_cursor(
    db: DuckDBRepo = Depends(get_db),
) -> Generator[duckdb.DuckDBPyConnection, None, None]:
    """Yield a DuckDB cursor, closing it after the request."""
    cursor = db.connection.cursor()
    try:
        yield cursor
    finally:
        cursor.close()


def get_storage() -> Any:
    """Placeholder for storage service (Plan 01-03)."""
    raise NotImplementedError("Storage service not yet implemented")


def get_image_service() -> Any:
    """Placeholder for image/thumbnail service (Plan 01-03)."""
    raise NotImplementedError("Image service not yet implemented")
