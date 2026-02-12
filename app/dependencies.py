"""FastAPI dependency injection for DuckDB and application services."""

from collections.abc import Generator

import duckdb
from fastapi import Depends, Request

from app.plugins.registry import PluginRegistry
from app.repositories.duckdb_repo import DuckDBRepo
from app.repositories.storage import StorageBackend
from app.services.image_service import ImageService
from app.services.embedding_service import EmbeddingService
from app.services.ingestion import IngestionService
from app.services.reduction_service import ReductionService


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


def get_storage(request: Request) -> StorageBackend:
    """Return the application-wide StorageBackend stored on app.state."""
    return request.app.state.storage


def get_image_service(request: Request) -> ImageService:
    """Return the application-wide ImageService stored on app.state."""
    return request.app.state.image_service


def get_plugin_registry(request: Request) -> PluginRegistry:
    """Return the application-wide PluginRegistry stored on app.state."""
    return request.app.state.plugin_registry


def get_embedding_service(request: Request) -> EmbeddingService:
    """Return the application-wide EmbeddingService stored on app.state."""
    return request.app.state.embedding_service


def get_reduction_service(request: Request) -> ReductionService:
    """Return the application-wide ReductionService stored on app.state."""
    return request.app.state.reduction_service


def get_ingestion_service(
    db: DuckDBRepo = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
    image_service: ImageService = Depends(get_image_service),
    plugin_registry: PluginRegistry = Depends(get_plugin_registry),
) -> IngestionService:
    """Compose an IngestionService from its collaborators."""
    return IngestionService(
        db=db,
        storage=storage,
        image_service=image_service,
        plugin_registry=plugin_registry,
    )
