"""Annotations CRUD router.

Endpoints:
- PUT /annotations/{annotation_id}   -- update bbox for a ground_truth annotation
- POST /annotations                  -- create a new ground_truth annotation
- DELETE /annotations/{annotation_id} -- delete a ground_truth annotation
"""

from __future__ import annotations

import uuid

import duckdb
from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_cursor
from app.models.annotation import AnnotationCreate, AnnotationUpdate

router = APIRouter(prefix="/annotations", tags=["annotations"])


def _update_dataset_counts(
    cursor: duckdb.DuckDBPyConnection, dataset_id: str
) -> None:
    """Refresh annotation_count and category_count on the datasets table."""
    cursor.execute(
        "UPDATE datasets SET "
        "annotation_count = (SELECT COUNT(*) FROM annotations WHERE dataset_id = ?), "
        "category_count = (SELECT COUNT(DISTINCT category_name) FROM annotations WHERE dataset_id = ?) "
        "WHERE id = ?",
        [dataset_id, dataset_id, dataset_id],
    )


@router.put("/{annotation_id}")
def update_annotation(
    annotation_id: str,
    body: AnnotationUpdate,
    cursor: duckdb.DuckDBPyConnection = Depends(get_cursor),
) -> dict:
    """Update bbox position and size for a ground_truth annotation."""
    area = body.bbox_w * body.bbox_h
    row = cursor.execute(
        "UPDATE annotations "
        "SET bbox_x = ?, bbox_y = ?, bbox_w = ?, bbox_h = ?, area = ? "
        "WHERE id = ? AND source = 'ground_truth' "
        "RETURNING id",
        [body.bbox_x, body.bbox_y, body.bbox_w, body.bbox_h, area, annotation_id],
    ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Annotation not found or not editable",
        )

    return {"updated": annotation_id}


@router.post("")
def create_annotation(
    body: AnnotationCreate,
    cursor: duckdb.DuckDBPyConnection = Depends(get_cursor),
) -> dict:
    """Create a new ground_truth annotation with auto-generated UUID."""
    ann_id = str(uuid.uuid4())
    area = body.bbox_w * body.bbox_h

    cursor.execute(
        "INSERT INTO annotations "
        "(id, dataset_id, sample_id, category_name, bbox_x, bbox_y, bbox_w, bbox_h, "
        "area, is_crowd, source, confidence) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, false, 'ground_truth', NULL)",
        [
            ann_id,
            body.dataset_id,
            body.sample_id,
            body.category_name,
            body.bbox_x,
            body.bbox_y,
            body.bbox_w,
            body.bbox_h,
            area,
        ],
    )

    _update_dataset_counts(cursor, body.dataset_id)

    return {"id": ann_id}


@router.delete("/{annotation_id}")
def delete_annotation(
    annotation_id: str,
    cursor: duckdb.DuckDBPyConnection = Depends(get_cursor),
) -> dict:
    """Delete a ground_truth annotation."""
    row = cursor.execute(
        "DELETE FROM annotations "
        "WHERE id = ? AND source = 'ground_truth' "
        "RETURNING id, dataset_id",
        [annotation_id],
    ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Annotation not found or not editable",
        )

    dataset_id = row[1]
    _update_dataset_counts(cursor, dataset_id)

    return {"deleted": annotation_id}
