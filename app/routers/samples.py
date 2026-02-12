"""Samples API router.

Endpoints:
- GET /samples                        -- paginated samples with filtering
- GET /samples/filter-facets          -- distinct filter values for dropdowns
- PATCH /samples/bulk-tag             -- add a tag to multiple samples
- PATCH /samples/bulk-untag           -- remove a tag from multiple samples
- GET /samples/batch-annotations      -- batch annotations for multiple samples
- GET /samples/{sample_id}/annotations -- annotations for a sample
"""

from __future__ import annotations

from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_db
from app.models.annotation import (
    AnnotationResponse,
    BatchAnnotationsResponse,
)
from app.models.sample import BulkTagRequest, PaginatedSamples, SampleResponse
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.filter_builder import SampleFilterBuilder

router = APIRouter(prefix="/samples", tags=["samples"])


@router.get("", response_model=PaginatedSamples)
def list_samples(
    dataset_id: str = Query(..., description="Filter by dataset ID"),
    category: str | None = Query(None, description="Filter by category name"),
    split: str | None = Query(None, description="Filter by split"),
    search: str | None = Query(None, description="Search by filename"),
    tags: str | None = Query(None, description="Comma-separated tags"),
    sample_ids: str | None = Query(
        None, description="Comma-separated sample IDs (for lasso selection, max 5000)"
    ),
    sort_by: str = Query("id", description="Sort column"),
    sort_dir: Literal["asc", "desc"] = Query("asc", description="Sort direction"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=200, description="Page size"),
    db: DuckDBRepo = Depends(get_db),
) -> PaginatedSamples:
    """Return paginated samples with dynamic filtering."""
    # Parse comma-separated tags into list
    tag_list = (
        [t.strip() for t in tags.split(",") if t.strip()]
        if tags
        else None
    )

    # Parse comma-separated sample IDs for lasso selection
    sample_id_list = (
        [sid.strip() for sid in sample_ids.split(",") if sid.strip()]
        if sample_ids
        else None
    )
    if sample_id_list and len(sample_id_list) > 5000:
        raise HTTPException(
            status_code=400,
            detail="Maximum 5000 sample_ids per request",
        )

    # Build query using SampleFilterBuilder
    builder = SampleFilterBuilder()
    result = (
        builder
        .add_dataset(dataset_id)
        .add_split(split)
        .add_category(category)
        .add_search(search)
        .add_tags(tag_list)
        .add_sample_ids(sample_id_list)
        .build(sort_by=sort_by, sort_dir=sort_dir)
    )

    distinct = "DISTINCT " if result.join_clause else ""

    cursor = db.connection.cursor()
    try:
        count_sql = (
            f"SELECT COUNT({distinct}s.id) FROM samples s "
            f"{result.join_clause} WHERE {result.where_clause}"
        )
        total = cursor.execute(count_sql, result.params).fetchone()[0]

        data_sql = (
            f"SELECT {distinct}s.id, s.dataset_id, s.file_name, "
            f"s.width, s.height, s.thumbnail_path, s.split, s.tags "
            f"FROM samples s {result.join_clause} "
            f"WHERE {result.where_clause} "
            f"{result.order_clause} LIMIT ? OFFSET ?"
        )
        rows = cursor.execute(
            data_sql, result.params + [limit, offset]
        ).fetchall()
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
            tags=row[7] or [],
        )
        for row in rows
    ]

    return PaginatedSamples(
        items=items, total=total, offset=offset, limit=limit
    )


@router.get("/filter-facets")
def get_filter_facets(
    dataset_id: str = Query(..., description="Dataset ID"),
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Return distinct values for all filterable fields.

    Used by the frontend to populate filter dropdown options.
    Returns categories from annotations table, splits and tags from samples.
    """
    cursor = db.connection.cursor()
    try:
        # Categories with annotation counts
        categories = [
            {"name": row[0], "count": row[1]}
            for row in cursor.execute(
                "SELECT category_name, COUNT(*) as cnt FROM annotations "
                "WHERE dataset_id = ? GROUP BY category_name ORDER BY category_name",
                [dataset_id],
            ).fetchall()
        ]

        # Splits with sample counts
        splits = [
            {"name": row[0], "count": row[1]}
            for row in cursor.execute(
                "SELECT split, COUNT(*) as cnt FROM samples "
                "WHERE dataset_id = ? AND split IS NOT NULL "
                "GROUP BY split ORDER BY split",
                [dataset_id],
            ).fetchall()
        ]

        # Tags with sample counts (unnest then count)
        tags = [
            {"name": row[0], "count": row[1]}
            for row in cursor.execute(
                "SELECT tag, COUNT(*) as cnt FROM ("
                "  SELECT UNNEST(tags) AS tag FROM samples "
                "  WHERE dataset_id = ? AND tags IS NOT NULL"
                ") GROUP BY tag ORDER BY tag",
                [dataset_id],
            ).fetchall()
        ]

        # Annotation sources with counts
        sources = [
            {"name": row[0], "count": row[1]}
            for row in cursor.execute(
                "SELECT source, COUNT(*) as cnt FROM annotations "
                "WHERE dataset_id = ? GROUP BY source ORDER BY source",
                [dataset_id],
            ).fetchall()
        ]
    finally:
        cursor.close()

    return {"categories": categories, "splits": splits, "tags": tags, "sources": sources}


@router.patch("/bulk-tag")
def bulk_add_tag(
    request: BulkTagRequest,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Add a tag to multiple samples.

    Uses DuckDB list_append + list_distinct to add the tag only if not
    already present. COALESCE handles samples with NULL tags.
    """
    if len(request.sample_ids) > 500:
        raise HTTPException(
            status_code=400,
            detail="Maximum 500 sample_ids per bulk tag request",
        )

    placeholders = ", ".join(["?"] * len(request.sample_ids))
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            f"UPDATE samples SET tags = list_distinct(list_append(COALESCE(tags, []), ?)) "
            f"WHERE dataset_id = ? AND id IN ({placeholders})",
            [request.tag, request.dataset_id] + request.sample_ids,
        )
    finally:
        cursor.close()

    return {"tagged": len(request.sample_ids)}


@router.patch("/bulk-untag")
def bulk_remove_tag(
    request: BulkTagRequest,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Remove a tag from multiple samples.

    Uses DuckDB list_filter to remove matching tag values.
    COALESCE handles samples with NULL tags.
    """
    if len(request.sample_ids) > 500:
        raise HTTPException(
            status_code=400,
            detail="Maximum 500 sample_ids per bulk untag request",
        )

    placeholders = ", ".join(["?"] * len(request.sample_ids))
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            f"UPDATE samples SET tags = list_filter(COALESCE(tags, []), x -> x != ?) "
            f"WHERE dataset_id = ? AND id IN ({placeholders})",
            [request.tag, request.dataset_id] + request.sample_ids,
        )
    finally:
        cursor.close()

    return {"untagged": len(request.sample_ids)}


@router.get(
    "/batch-annotations",
    response_model=BatchAnnotationsResponse,
)
def get_batch_annotations(
    dataset_id: str = Query(..., description="Dataset ID"),
    sample_ids: str = Query(
        ..., description="Comma-separated sample IDs (max 200)"
    ),
    sources: str | None = Query(
        None,
        description="Comma-separated annotation sources to include, or omit for all",
    ),
    db: DuckDBRepo = Depends(get_db),
) -> BatchAnnotationsResponse:
    """Return annotations for multiple samples grouped by sample_id.

    Accepts up to 200 sample IDs in a single request to avoid
    per-cell annotation request waterfalls in the grid UI.
    """
    id_list = [sid.strip() for sid in sample_ids.split(",") if sid.strip()]

    if len(id_list) > 200:
        raise HTTPException(
            status_code=400,
            detail="Maximum 200 sample_ids per batch request",
        )

    if not id_list:
        return BatchAnnotationsResponse(annotations={})

    # Build parameterized IN clause
    placeholders = ", ".join(["?"] * len(id_list))
    params: list = [dataset_id] + id_list

    # Optional multi-value source filter
    source_clause = ""
    if sources:
        source_list = [s.strip() for s in sources.split(",") if s.strip()]
        if source_list:
            src_placeholders = ", ".join(["?"] * len(source_list))
            source_clause = f" AND source IN ({src_placeholders})"
            params.extend(source_list)

    cursor = db.connection.cursor()
    try:
        rows = cursor.execute(
            "SELECT id, dataset_id, sample_id, category_name, "
            "bbox_x, bbox_y, bbox_w, bbox_h, area, is_crowd, "
            "source, confidence "
            "FROM annotations "
            f"WHERE dataset_id = ? AND sample_id IN ({placeholders})"
            f"{source_clause}",
            params,
        ).fetchall()
    finally:
        cursor.close()

    # Group annotations by sample_id
    grouped: dict[str, list[AnnotationResponse]] = defaultdict(list)
    for row in rows:
        ann = AnnotationResponse(
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
        grouped[ann.sample_id].append(ann)

    return BatchAnnotationsResponse(annotations=dict(grouped))


@router.get(
    "/{sample_id}/annotations",
    response_model=list[AnnotationResponse],
)
def get_sample_annotations(
    sample_id: str,
    dataset_id: str = Query(..., description="Dataset ID"),
    sources: str | None = Query(
        None,
        description="Comma-separated annotation sources to include, or omit for all",
    ),
    db: DuckDBRepo = Depends(get_db),
) -> list[AnnotationResponse]:
    """Return all annotations for a given sample."""
    params: list = [sample_id, dataset_id]
    source_clause = ""
    if sources:
        source_list = [s.strip() for s in sources.split(",") if s.strip()]
        if source_list:
            src_placeholders = ", ".join(["?"] * len(source_list))
            source_clause = f" AND source IN ({src_placeholders})"
            params.extend(source_list)

    cursor = db.connection.cursor()
    try:
        rows = cursor.execute(
            "SELECT id, dataset_id, sample_id, category_name, "
            "bbox_x, bbox_y, bbox_w, bbox_h, area, is_crowd, "
            "source, confidence "
            "FROM annotations "
            f"WHERE sample_id = ? AND dataset_id = ?{source_clause}",
            params,
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
