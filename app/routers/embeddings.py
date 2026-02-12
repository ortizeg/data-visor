"""Embeddings API router.

Endpoints:
- POST /datasets/{dataset_id}/embeddings/generate        -- trigger background embedding generation
- GET  /datasets/{dataset_id}/embeddings/progress         -- SSE stream of generation progress
- GET  /datasets/{dataset_id}/embeddings/status           -- current embedding availability
- POST /datasets/{dataset_id}/embeddings/reduce           -- trigger background t-SNE reduction
- GET  /datasets/{dataset_id}/embeddings/reduce/progress  -- SSE stream of reduction progress
- GET  /datasets/{dataset_id}/embeddings/coordinates      -- 2D scatter-plot coordinates
"""

from __future__ import annotations

import asyncio
import json

import duckdb
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.dependencies import get_cursor, get_db, get_embedding_service, get_reduction_service
from app.models.embedding import (
    EmbeddingGenerateRequest,
    EmbeddingGenerateResponse,
    EmbeddingStatus,
)
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.embedding_service import EmbeddingService
from app.services.reduction_service import ReductionService

router = APIRouter(
    prefix="/datasets/{dataset_id}/embeddings", tags=["embeddings"]
)


@router.post("/generate", status_code=202, response_model=EmbeddingGenerateResponse)
def generate_embeddings(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    request: EmbeddingGenerateRequest | None = None,
    db: DuckDBRepo = Depends(get_db),
    embedding_service: EmbeddingService = Depends(get_embedding_service),
) -> EmbeddingGenerateResponse:
    """Trigger background embedding generation for a dataset.

    Returns 202 Accepted immediately.  Monitor progress via the
    ``/progress`` SSE endpoint.
    """
    # Check if generation is already running
    if embedding_service.is_running(dataset_id):
        raise HTTPException(
            status_code=409,
            detail="Embedding generation already running for this dataset",
        )

    # Verify dataset exists
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
    finally:
        cursor.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    background_tasks.add_task(
        embedding_service.generate_embeddings, dataset_id
    )

    return EmbeddingGenerateResponse(
        dataset_id=dataset_id,
        status="started",
        message="Embedding generation started",
    )


@router.get("/progress")
async def embedding_progress(
    dataset_id: str,
    embedding_service: EmbeddingService = Depends(get_embedding_service),
) -> EventSourceResponse:
    """Stream embedding generation progress via Server-Sent Events.

    Yields progress events every 0.5s until status is ``complete`` or
    ``error``, then closes the connection.
    """

    async def event_generator():
        while True:
            progress = embedding_service.get_progress(dataset_id)
            yield {
                "event": "progress",
                "data": json.dumps(progress.model_dump()),
            }
            if progress.status in ("complete", "error"):
                break
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@router.get("/status", response_model=EmbeddingStatus)
def embedding_status(
    dataset_id: str,
    db: DuckDBRepo = Depends(get_db),
) -> EmbeddingStatus:
    """Return the current embedding status for a dataset.

    Reports whether embeddings exist, their count, the model used,
    and whether 2D reduction coordinates (x, y) are populated.
    """
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT COUNT(*), MAX(model_name), "
            "COUNT(x) FILTER (WHERE x IS NOT NULL) "
            "FROM embeddings WHERE dataset_id = ?",
            [dataset_id],
        ).fetchone()
    finally:
        cursor.close()

    count = row[0]
    model_name = row[1]
    reduction_count = row[2]

    return EmbeddingStatus(
        dataset_id=dataset_id,
        has_embeddings=count > 0,
        embedding_count=count,
        model_name=model_name,
        has_reduction=reduction_count > 0,
    )


# ---------------------------------------------------------------------------
# Dimensionality reduction (t-SNE) endpoints
# ---------------------------------------------------------------------------


@router.post("/reduce", status_code=202)
def reduce_embeddings(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    db: DuckDBRepo = Depends(get_db),
    reduction_service: ReductionService = Depends(get_reduction_service),
) -> dict:
    """Trigger background t-SNE dimensionality reduction for a dataset.

    Returns 202 Accepted immediately.  Monitor progress via the
    ``/reduce/progress`` SSE endpoint.
    """
    # Reject if reduction is already in progress
    if reduction_service.is_running(dataset_id):
        raise HTTPException(
            status_code=409,
            detail="Reduction already running for this dataset",
        )

    # Verify embeddings exist for this dataset
    cursor = db.connection.cursor()
    try:
        count = cursor.execute(
            "SELECT COUNT(*) FROM embeddings WHERE dataset_id = ?",
            [dataset_id],
        ).fetchone()[0]
    finally:
        cursor.close()

    if count == 0:
        raise HTTPException(
            status_code=400,
            detail="No embeddings found. Generate embeddings first.",
        )

    background_tasks.add_task(
        reduction_service.reduce_embeddings, dataset_id
    )

    return {"status": "started", "message": "Dimensionality reduction started"}


@router.get("/reduce/progress")
async def reduction_progress(
    dataset_id: str,
    reduction_service: ReductionService = Depends(get_reduction_service),
) -> EventSourceResponse:
    """Stream reduction progress via Server-Sent Events.

    Yields progress events every 0.5 s until status is ``complete`` or
    ``error``, then closes the connection.
    """

    async def event_generator():
        while True:
            progress = reduction_service.get_progress(dataset_id)
            yield {
                "event": "progress",
                "data": json.dumps(progress.model_dump()),
            }
            if progress.status in ("complete", "error"):
                break
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@router.get("/coordinates")
def get_coordinates(
    dataset_id: str,
    cursor: duckdb.DuckDBPyConnection = Depends(get_cursor),
    reduction_service: ReductionService = Depends(get_reduction_service),
) -> list[dict]:
    """Return 2D scatter-plot coordinates for all reduced embeddings.

    Returns an empty list ``[]`` if no reduction has been run yet (not 404).
    Each item contains ``sampleId``, ``x``, ``y``, ``fileName``, and
    ``thumbnailPath`` for the frontend scatter plot.
    """
    return reduction_service.get_coordinates(dataset_id, cursor)
