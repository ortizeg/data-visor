"""Similarity search API router.

Endpoints:
- GET  /datasets/{dataset_id}/similarity/search           -- find visually similar images
- POST /datasets/{dataset_id}/near-duplicates/detect      -- trigger background near-duplicate detection
- GET  /datasets/{dataset_id}/near-duplicates/progress    -- SSE stream of detection progress
- GET  /datasets/{dataset_id}/near-duplicates              -- cached near-duplicate results
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sse_starlette.sse import EventSourceResponse

from app.dependencies import get_db, get_similarity_service
from app.models.similarity import (
    NearDuplicateResponse,
    SimilarityResponse,
    SimilarResult,
)
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.similarity_service import SimilarityService

router = APIRouter(prefix="/datasets", tags=["similarity"])


@router.get("/{dataset_id}/similarity/search", response_model=SimilarityResponse)
def search_similar(
    dataset_id: str,
    sample_id: str = Query(
        ..., description="Source sample to find similar images for"
    ),
    limit: int = Query(20, ge=1, le=100),
    similarity_service: SimilarityService = Depends(get_similarity_service),
    db: DuckDBRepo = Depends(get_db),
) -> SimilarityResponse:
    """Find visually similar images ranked by embedding distance.

    Returns ranked results with cosine similarity scores.
    Empty results (no embeddings) return an empty list, not 404.
    """
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

    # Find similar images
    raw_results = similarity_service.find_similar(dataset_id, sample_id, limit)

    if not raw_results:
        return SimilarityResponse(results=[], query_sample_id=sample_id)

    # Enrich results with sample metadata (file_name, thumbnail_path)
    cursor = db.connection.cursor()
    try:
        result_ids = [r["sample_id"] for r in raw_results]
        placeholders = ",".join(["?"] * len(result_ids))
        rows = cursor.execute(
            f"SELECT id, file_name, thumbnail_path FROM samples "
            f"WHERE dataset_id = ? AND id IN ({placeholders})",
            [dataset_id, *result_ids],
        ).fetchall()
        meta = {r[0]: {"file_name": r[1], "thumbnail_path": r[2]} for r in rows}
    finally:
        cursor.close()

    enriched = [
        SimilarResult(
            sample_id=r["sample_id"],
            score=r["score"],
            file_name=meta.get(r["sample_id"], {}).get("file_name"),
            thumbnail_path=meta.get(r["sample_id"], {}).get("thumbnail_path"),
        )
        for r in raw_results
    ]

    return SimilarityResponse(results=enriched, query_sample_id=sample_id)


# ---------------------------------------------------------------------------
# Near-duplicate detection endpoints
# ---------------------------------------------------------------------------


@router.post("/{dataset_id}/near-duplicates/detect", status_code=202)
def detect_near_duplicates(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    threshold: float = Query(0.95, ge=0.80, le=0.99),
    db: DuckDBRepo = Depends(get_db),
    similarity_service: SimilarityService = Depends(get_similarity_service),
) -> dict:
    """Trigger background near-duplicate detection.

    Returns 202 Accepted immediately.  Monitor progress via the
    ``/near-duplicates/progress`` SSE endpoint.
    """
    if similarity_service.is_near_dupe_running(dataset_id):
        raise HTTPException(
            status_code=409,
            detail="Near-duplicate detection already running for this dataset",
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
        similarity_service.find_near_duplicates, dataset_id, threshold
    )

    return {"status": "started", "message": "Near-duplicate detection started"}


@router.get("/{dataset_id}/near-duplicates/progress")
async def near_duplicate_progress(
    dataset_id: str,
    similarity_service: SimilarityService = Depends(get_similarity_service),
) -> EventSourceResponse:
    """Stream near-duplicate detection progress via Server-Sent Events.

    Yields progress events every 0.5s until status is ``complete`` or
    ``error``, then closes the connection.
    """

    async def event_generator():
        while True:
            progress = similarity_service.get_near_dupe_progress(dataset_id)
            yield {
                "event": "progress",
                "data": json.dumps(progress.model_dump()),
            }
            if progress.status in ("complete", "error"):
                break
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@router.get(
    "/{dataset_id}/near-duplicates", response_model=NearDuplicateResponse
)
def get_near_duplicates(
    dataset_id: str,
    similarity_service: SimilarityService = Depends(get_similarity_service),
) -> NearDuplicateResponse:
    """Return cached near-duplicate detection results.

    Returns 404 if detection has not been run yet.
    """
    result = similarity_service.get_near_dupe_results(dataset_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No near-duplicate results. Run detection first.",
        )
    return result
