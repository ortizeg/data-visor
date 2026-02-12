"""VLM (Vision-Language Model) auto-tagging API router.

Endpoints:
- POST /datasets/{dataset_id}/auto-tag  -- trigger background VLM auto-tagging
- GET  /datasets/{dataset_id}/auto-tag/progress -- SSE stream of tagging progress
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.dependencies import get_db, get_vlm_service
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.vlm_service import VLMService

router = APIRouter(prefix="/datasets", tags=["vlm"])


@router.post("/{dataset_id}/auto-tag", status_code=202)
def auto_tag(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    db: DuckDBRepo = Depends(get_db),
    vlm_service: VLMService = Depends(get_vlm_service),
) -> dict:
    """Trigger VLM auto-tagging for all samples in a dataset.

    Returns 202 Accepted immediately.  Monitor progress via the
    ``/auto-tag/progress`` SSE endpoint.

    Uses Moondream2 to generate descriptive tags (lighting, clarity,
    setting, weather, density) for each sample image.  Tags are
    validated against a controlled vocabulary and merged into the
    existing ``samples.tags`` column.
    """
    # Reject if tagging is already running
    if vlm_service.is_running(dataset_id):
        raise HTTPException(
            status_code=409,
            detail="Auto-tagging already running for this dataset",
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

    background_tasks.add_task(vlm_service.generate_tags, dataset_id)

    return {"status": "started", "message": "Auto-tagging started"}


@router.get("/{dataset_id}/auto-tag/progress")
async def auto_tag_progress(
    dataset_id: str,
    vlm_service: VLMService = Depends(get_vlm_service),
) -> EventSourceResponse:
    """Stream auto-tagging progress via Server-Sent Events.

    Yields progress events every 0.5s until status is ``complete`` or
    ``error``, then closes the connection.
    """

    async def event_generator():
        while True:
            progress = vlm_service.get_progress(dataset_id)
            yield {
                "event": "progress",
                "data": json.dumps(progress.model_dump()),
            }
            if progress.status in ("complete", "error"):
                break
            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())
