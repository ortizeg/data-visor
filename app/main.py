"""VisionLens FastAPI application entry point."""

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.repositories.duckdb_repo import DuckDBRepo


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage application startup and shutdown.

    On startup: create DuckDB connection, initialize schema, store on app.state.
    On shutdown: close DuckDB connection.
    """
    settings = get_settings()
    db = DuckDBRepo(settings.db_path)
    db.initialize_schema()
    app.state.db = db
    yield
    db.close()


app = FastAPI(
    title="VisionLens",
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

# Router includes (will be added as plans progress)
# from app.routers import datasets, samples, images
# app.include_router(datasets.router)
# app.include_router(samples.router)
# app.include_router(images.router)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Simple health check endpoint."""
    return {"status": "ok"}
