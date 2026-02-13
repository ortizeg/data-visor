"""Triage API router.

Endpoints:
- PATCH /samples/set-triage-tag     -- atomically set a triage tag on a sample
- DELETE /samples/{sample_id}/triage-tag -- remove all triage tags from a sample
- GET /datasets/{dataset_id}/worst-images -- ranked samples by composite error score
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_db
from app.models.triage import (
    TRIAGE_PREFIX,
    VALID_TRIAGE_TAGS,
    SetTriageTagRequest,
    WorstImagesResponse,
)
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.triage import compute_worst_images

# Router for sample-level triage endpoints
samples_router = APIRouter(prefix="/samples", tags=["triage"])

# Router for dataset-level triage endpoints
datasets_router = APIRouter(prefix="/datasets", tags=["triage"])


@samples_router.patch("/set-triage-tag")
def set_triage_tag(
    request: SetTriageTagRequest,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Atomically replace any previous triage tag on a sample.

    Uses a single DuckDB UPDATE that:
    1. Filters out existing triage:* tags via list_filter + starts_with
    2. Appends the new triage tag via list_append
    3. Deduplicates via list_distinct
    """
    if request.tag not in VALID_TRIAGE_TAGS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid triage tag '{request.tag}'. Must be one of: {sorted(VALID_TRIAGE_TAGS)}",
        )

    cursor = db.connection.cursor()
    try:
        cursor.execute(
            "UPDATE samples SET tags = list_distinct(list_append("
            "list_filter(COALESCE(tags, []), x -> NOT starts_with(x, ?)), ?"
            ")) WHERE dataset_id = ? AND id = ?",
            [TRIAGE_PREFIX, request.tag, request.dataset_id, request.sample_id],
        )
    finally:
        cursor.close()

    return {"sample_id": request.sample_id, "tag": request.tag}


@samples_router.delete("/{sample_id}/triage-tag")
def remove_triage_tag(
    sample_id: str,
    dataset_id: str = Query(..., description="Dataset ID"),
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Remove all triage tags from a sample.

    Filters out any tag starting with the triage prefix.
    """
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            "UPDATE samples SET tags = list_filter(COALESCE(tags, []), "
            "x -> NOT starts_with(x, ?)) WHERE dataset_id = ? AND id = ?",
            [TRIAGE_PREFIX, dataset_id, sample_id],
        )
    finally:
        cursor.close()

    return {"sample_id": sample_id, "cleared": True}


@datasets_router.get("/{dataset_id}/worst-images", response_model=WorstImagesResponse)
def get_worst_images(
    dataset_id: str,
    source: str = Query("prediction"),
    iou_threshold: float = Query(0.5, ge=0.1, le=1.0),
    conf_threshold: float = Query(0.25, ge=0.0, le=1.0),
    split: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: DuckDBRepo = Depends(get_db),
) -> WorstImagesResponse:
    """Return samples ranked by composite error score (worst first).

    Score = 0.6 * normalized_error_count + 0.4 * normalized_confidence_spread
    """
    # Verify dataset exists
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        scores = compute_worst_images(
            cursor, dataset_id, source, iou_threshold, conf_threshold,
            split=split, limit=limit,
        )
    finally:
        cursor.close()

    return WorstImagesResponse(items=scores)
