"""Samples API router.

Endpoints:
- GET /samples                        -- paginated samples with filtering
- GET /samples/{sample_id}/annotations -- annotations for a sample
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_db
from app.models.annotation import AnnotationResponse
from app.models.sample import PaginatedSamples, SampleResponse
from app.repositories.duckdb_repo import DuckDBRepo

router = APIRouter(prefix="/samples", tags=["samples"])


@router.get("", response_model=PaginatedSamples)
def list_samples(
    dataset_id: str = Query(..., description="Filter by dataset ID"),
    category: str | None = Query(None, description="Filter by category name"),
    split: str | None = Query(None, description="Filter by split"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=200, description="Page size"),
    db: DuckDBRepo = Depends(get_db),
) -> PaginatedSamples:
    """Return paginated samples filtered by dataset, category, and split."""
    cursor = db.connection.cursor()
    try:
        # Build WHERE clause
        conditions = ["s.dataset_id = ?"]
        params: list = [dataset_id]

        if split is not None:
            conditions.append("s.split = ?")
            params.append(split)

        where = " AND ".join(conditions)

        if category is not None:
            # JOIN with annotations for category filter
            count_sql = (
                "SELECT COUNT(DISTINCT s.id) FROM samples s "
                "JOIN annotations a ON s.id = a.sample_id "
                f"AND a.dataset_id = s.dataset_id WHERE {where} "
                "AND a.category_name = ?"
            )
            data_sql = (
                "SELECT DISTINCT s.id, s.dataset_id, s.file_name, "
                "s.width, s.height, s.thumbnail_path, s.split "
                "FROM samples s "
                "JOIN annotations a ON s.id = a.sample_id "
                f"AND a.dataset_id = s.dataset_id WHERE {where} "
                "AND a.category_name = ? "
                "ORDER BY s.id LIMIT ? OFFSET ?"
            )
            count_params = params + [category]
            data_params = params + [category, limit, offset]
        else:
            count_sql = f"SELECT COUNT(*) FROM samples s WHERE {where}"
            data_sql = (
                "SELECT s.id, s.dataset_id, s.file_name, s.width, "
                "s.height, s.thumbnail_path, s.split "
                f"FROM samples s WHERE {where} "
                "ORDER BY s.id LIMIT ? OFFSET ?"
            )
            count_params = params
            data_params = params + [limit, offset]

        total = cursor.execute(count_sql, count_params).fetchone()[0]
        rows = cursor.execute(data_sql, data_params).fetchall()
    finally:
        cursor.close()

    items = [
        SampleResponse(
            id=row[0],
            dataset_id=row[1],
            file_name=row[2],
            width=row[3],
            height=row[4],
            thumbnail_path=row[5],
            split=row[6],
        )
        for row in rows
    ]

    return PaginatedSamples(
        items=items, total=total, offset=offset, limit=limit
    )


@router.get(
    "/{sample_id}/annotations",
    response_model=list[AnnotationResponse],
)
def get_sample_annotations(
    sample_id: str,
    dataset_id: str = Query(..., description="Dataset ID"),
    db: DuckDBRepo = Depends(get_db),
) -> list[AnnotationResponse]:
    """Return all annotations for a given sample."""
    cursor = db.connection.cursor()
    try:
        rows = cursor.execute(
            "SELECT id, dataset_id, sample_id, category_name, "
            "bbox_x, bbox_y, bbox_w, bbox_h, area, is_crowd, "
            "source, confidence "
            "FROM annotations "
            "WHERE sample_id = ? AND dataset_id = ?",
            [sample_id, dataset_id],
        ).fetchall()
    finally:
        cursor.close()

    if not rows:
        # Verify sample exists
        check_cursor = db.connection.cursor()
        try:
            sample = check_cursor.execute(
                "SELECT id FROM samples WHERE id = ? AND dataset_id = ?",
                [sample_id, dataset_id],
            ).fetchone()
        finally:
            check_cursor.close()

        if sample is None:
            raise HTTPException(
                status_code=404, detail="Sample not found"
            )
        # Sample exists but has no annotations -- return empty list
        return []

    return [
        AnnotationResponse(
            id=row[0],
            dataset_id=row[1],
            sample_id=row[2],
            category_name=row[3],
            bbox_x=row[4],
            bbox_y=row[5],
            bbox_w=row[6],
            bbox_h=row[7],
            area=row[8],
            is_crowd=row[9],
            source=row[10],
            confidence=row[11],
        )
        for row in rows
    ]
