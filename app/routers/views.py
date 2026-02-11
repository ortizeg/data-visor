"""Saved views API router.

Endpoints:
- POST /views                -- create a named saved view
- GET /views                 -- list saved views for a dataset
- DELETE /views/{view_id}    -- delete a saved view
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, Query, Response

from app.dependencies import get_db
from app.models.view import (
    SavedViewCreate,
    SavedViewListResponse,
    SavedViewResponse,
)
from app.repositories.duckdb_repo import DuckDBRepo

router = APIRouter(prefix="/views", tags=["views"])


@router.post("", response_model=SavedViewResponse, status_code=201)
def create_view(
    request: SavedViewCreate,
    db: DuckDBRepo = Depends(get_db),
) -> SavedViewResponse:
    """Save a named filter configuration."""
    view_id = str(uuid.uuid4())
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            "INSERT INTO saved_views (id, dataset_id, name, filters) "
            "VALUES (?, ?, ?, ?::JSON)",
            [view_id, request.dataset_id, request.name, json.dumps(request.filters)],
        )
        # Fetch the created view to return with timestamps
        row = cursor.execute(
            "SELECT id, dataset_id, name, filters, created_at, updated_at "
            "FROM saved_views WHERE id = ?",
            [view_id],
        ).fetchone()
    finally:
        cursor.close()

    return SavedViewResponse(
        id=row[0],
        dataset_id=row[1],
        name=row[2],
        filters=json.loads(row[3]) if isinstance(row[3], str) else row[3],
        created_at=row[4],
        updated_at=row[5],
    )


@router.get("", response_model=SavedViewListResponse)
def list_views(
    dataset_id: str = Query(..., description="Dataset ID"),
    db: DuckDBRepo = Depends(get_db),
) -> SavedViewListResponse:
    """List all saved views for a dataset."""
    cursor = db.connection.cursor()
    try:
        rows = cursor.execute(
            "SELECT id, dataset_id, name, filters, created_at, updated_at "
            "FROM saved_views WHERE dataset_id = ? ORDER BY created_at DESC",
            [dataset_id],
        ).fetchall()
    finally:
        cursor.close()

    views = [
        SavedViewResponse(
            id=row[0],
            dataset_id=row[1],
            name=row[2],
            filters=json.loads(row[3]) if isinstance(row[3], str) else row[3],
            created_at=row[4],
            updated_at=row[5],
        )
        for row in rows
    ]

    return SavedViewListResponse(views=views)


@router.delete("/{view_id}", status_code=204)
def delete_view(
    view_id: str,
    db: DuckDBRepo = Depends(get_db),
) -> Response:
    """Delete a saved view."""
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            "DELETE FROM saved_views WHERE id = ?",
            [view_id],
        )
    finally:
        cursor.close()

    return Response(status_code=204)
