"""DataVisor FastAPI application entry point."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.plugins.registry import PluginRegistry
from app.repositories.duckdb_repo import DuckDBRepo
from app.repositories.storage import StorageBackend
from app.services.embedding_service import EmbeddingService
from app.services.image_service import ImageService
from app.services.reduction_service import ReductionService
from app.services.similarity_service import SimilarityService
from app.services.vlm_service import VLMService

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage application startup and shutdown.

    On startup:
    - Create DuckDB connection and initialize schema.
    - Create StorageBackend, ImageService, PluginRegistry.
    - Discover plugins from the configured plugin directory.
    - Store all services on app.state for dependency injection.

    On shutdown:
    - Shut down plugin registry.
    - Close DuckDB connection.
    """
    settings = get_settings()

    # Database
    db = DuckDBRepo(settings.db_path)
    db.initialize_schema()
    app.state.db = db

    # Storage
    storage = StorageBackend()
    app.state.storage = storage

    # Image service
    image_service = ImageService(
        cache_dir=Path(settings.thumbnail_cache_dir),
        storage=storage,
    )
    app.state.image_service = image_service

    # Embedding service (model loaded at startup to avoid per-request latency)
    embedding_service = EmbeddingService(db=db, storage=storage)
    embedding_service.load_model()
    app.state.embedding_service = embedding_service

    # Reduction service (t-SNE dimensionality reduction for scatter plot)
    reduction_service = ReductionService(db=db)
    app.state.reduction_service = reduction_service

    # Similarity service (Qdrant local mode for vector similarity search)
    similarity_service = SimilarityService(
        qdrant_path=settings.qdrant_path, db=db
    )
    app.state.similarity_service = similarity_service

    # VLM service (Moondream2 -- model loaded on-demand, NOT at startup)
    vlm_service = VLMService(db=db, storage=storage, device=settings.vlm_device)
    app.state.vlm_service = vlm_service

    # Plugin registry
    plugin_registry = PluginRegistry()
    plugin_dir = Path(settings.plugin_dir)
    discovered = plugin_registry.discover_plugins(plugin_dir)
    if discovered:
        logger.info("Loaded plugins: %s", ", ".join(discovered))
    app.state.plugin_registry = plugin_registry

    yield

    # Shutdown
    plugin_registry.shutdown()
    similarity_service.close()
    db.close()


app = FastAPI(
    title="DataVisor",
    description="Unified CV dataset introspection tool",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for dev -- will restrict later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router includes
from app.routers import agent, datasets, embeddings, images, samples, similarity, statistics, views, vlm  # noqa: E402

app.include_router(datasets.router)
app.include_router(samples.router)
app.include_router(images.router)
app.include_router(views.router)
app.include_router(statistics.router)
app.include_router(embeddings.router)
app.include_router(similarity.router)
app.include_router(agent.router)
app.include_router(vlm.router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Simple health check endpoint."""
    return {"status": "ok"}
