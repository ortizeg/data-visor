"""Per-annotation triage API router.

Endpoints:
- GET  /samples/{sample_id}/annotation-triage      -- IoU-computed classifications merged with overrides
- PATCH /samples/set-annotation-triage              -- persist a manual triage override
- DELETE /samples/{sample_id}/annotation-triage/{annotation_id} -- remove a manual override
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_db
from app.models.annotation_triage import (
    VALID_ANNOTATION_TRIAGE_LABELS,
    AnnotationTriageResponse,
    AnnotationTriageResult,
    SetAnnotationTriageRequest,
)
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.annotation_matching import match_sample_annotations

router = APIRouter(prefix="/samples", tags=["annotation-triage"])


@router.get(
    "/{sample_id}/annotation-triage",
    response_model=AnnotationTriageResponse,
)
def get_annotation_triage(
    sample_id: str,
    dataset_id: str = Query(..., description="Dataset ID"),
    source: str = Query("prediction", description="Prediction source name"),
    iou_threshold: float = Query(0.45, ge=0.1, le=1.0),
    conf_threshold: float = Query(0.25, ge=0.0, le=1.0),
    db: DuckDBRepo = Depends(get_db),
) -> AnnotationTriageResponse:
    """Return per-annotation TP/FP/FN classifications for a single sample.

    Auto-computed labels from IoU matching are merged with manual overrides
    stored in the annotation_triage table. Overrides take precedence.
    """
    cursor = db.connection.cursor()
    try:
        # 1. Compute auto labels via IoU matching
        auto_results = match_sample_annotations(
            cursor, dataset_id, sample_id, source, iou_threshold, conf_threshold
        )

        # 2. Fetch manual overrides
        overrides_rows = cursor.execute(
            "SELECT annotation_id, label FROM annotation_triage "
            "WHERE dataset_id = ? AND sample_id = ?",
            [dataset_id, sample_id],
        ).fetchall()
        overrides = {row[0]: row[1] for row in overrides_rows}

        # 3. Merge: override takes precedence over auto
        items: list[AnnotationTriageResult] = []
        for ann_id, info in auto_results.items():
            auto_label = info["label"]
            override_label = overrides.get(ann_id)
            items.append(
                AnnotationTriageResult(
                    annotation_id=ann_id,
                    auto_label=auto_label,
                    label=override_label if override_label else auto_label,
                    matched_id=info.get("matched_id"),
                    iou=info.get("iou"),
                    is_override=override_label is not None,
                )
            )

        return AnnotationTriageResponse(items=items)
    finally:
        cursor.close()


@router.patch("/set-annotation-triage")
def set_annotation_triage(
    request: SetAnnotationTriageRequest,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Persist a manual triage override for a single annotation.

    Replaces any existing override for the same annotation.
    Also sets a sample-level triage:annotated tag so highlight mode works.
    """
    if request.label not in VALID_ANNOTATION_TRIAGE_LABELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid label '{request.label}'. Must be one of: {sorted(VALID_ANNOTATION_TRIAGE_LABELS)}",
        )

    cursor = db.connection.cursor()
    try:
        # Delete existing override for this annotation
        cursor.execute(
            "DELETE FROM annotation_triage WHERE annotation_id = ? AND dataset_id = ?",
            [request.annotation_id, request.dataset_id],
        )

        # Insert new override
        cursor.execute(
            "INSERT INTO annotation_triage (annotation_id, dataset_id, sample_id, label) "
            "VALUES (?, ?, ?, ?)",
            [request.annotation_id, request.dataset_id, request.sample_id, request.label],
        )

        # Set sample-level triage:annotated tag (atomic replace pattern from triage.py)
        cursor.execute(
            "UPDATE samples SET tags = list_distinct(list_append("
            "list_filter(COALESCE(tags, []), x -> NOT starts_with(x, 'triage:ann')), "
            "'triage:annotated')) WHERE dataset_id = ? AND id = ?",
            [request.dataset_id, request.sample_id],
        )
    finally:
        cursor.close()

    return {"annotation_id": request.annotation_id, "label": request.label}


@router.delete("/{sample_id}/annotation-triage/{annotation_id}")
def delete_annotation_triage(
    sample_id: str,
    annotation_id: str,
    dataset_id: str = Query(..., description="Dataset ID"),
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Remove a manual triage override for a single annotation.

    If no overrides remain for the sample, remove the triage:annotated tag.
    """
    cursor = db.connection.cursor()
    try:
        # Delete the override
        cursor.execute(
            "DELETE FROM annotation_triage WHERE annotation_id = ? AND dataset_id = ?",
            [annotation_id, dataset_id],
        )

        # Check if sample still has remaining overrides
        remaining = cursor.execute(
            "SELECT COUNT(*) FROM annotation_triage "
            "WHERE dataset_id = ? AND sample_id = ?",
            [dataset_id, sample_id],
        ).fetchone()

        if remaining and remaining[0] == 0:
            # No overrides left -- remove triage:annotated tag
            cursor.execute(
                "UPDATE samples SET tags = list_filter(COALESCE(tags, []), "
                "x -> NOT starts_with(x, 'triage:ann')) "
                "WHERE dataset_id = ? AND id = ?",
                [dataset_id, sample_id],
            )
    finally:
        cursor.close()

    return {"annotation_id": annotation_id, "cleared": True}
