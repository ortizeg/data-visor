"""Datasets API router.

Endpoints:
- POST /datasets/ingest -- ingest a COCO dataset with SSE progress streaming
- GET  /datasets        -- list all datasets
- GET  /datasets/{id}   -- get a single dataset
- DELETE /datasets/{id} -- delete a dataset and all related data
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.dependencies import get_db, get_ingestion_service
from app.models.dataset import (
    DatasetListResponse,
    DatasetResponse,
    IngestRequest,
)
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.ingestion import IngestionService

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.post("/ingest")
def ingest_dataset(
    request: IngestRequest,
    ingestion_service: IngestionService = Depends(get_ingestion_service),
) -> StreamingResponse:
    """Ingest a COCO dataset with real-time progress via SSE.

    Streams ``text/event-stream`` events, each containing a JSON payload
    with ``stage``, ``current``, ``total``, and ``message`` fields.
    """

    def progress_stream():
        for progress in ingestion_service.ingest_with_progress(
            annotation_path=request.annotation_path,
            image_dir=request.image_dir,
            dataset_name=request.dataset_name,
            format=request.format,
        ):
            event_data = json.dumps(
                {
                    "stage": progress.stage,
                    "current": progress.current,
                    "total": progress.total,
                    "message": progress.message,
                }
            )
            yield f"data: {event_data}\n\n"

    return StreamingResponse(
        progress_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("", response_model=DatasetListResponse)
def list_datasets(db: DuckDBRepo = Depends(get_db)) -> DatasetListResponse:
    """Return all datasets ordered by creation date (newest first)."""
    cursor = db.connection.cursor()
    try:
        rows = cursor.execute(
            "SELECT id, name, format, source_path, image_dir, "
            "image_count, annotation_count, category_count, created_at "
            "FROM datasets ORDER BY created_at DESC"
        ).fetchall()
    finally:
        cursor.close()

    datasets = [
        DatasetResponse(
            id=row[0],
            name=row[1],
            format=row[2],
            source_path=row[3],
            image_dir=row[4],
            image_count=row[5],
            annotation_count=row[6],
            category_count=row[7],
            created_at=row[8],
        )
        for row in rows
    ]
    return DatasetListResponse(datasets=datasets)


@router.get("/{dataset_id}", response_model=DatasetResponse)
def get_dataset(
    dataset_id: str, db: DuckDBRepo = Depends(get_db)
) -> DatasetResponse:
    """Return a single dataset by ID, or 404."""
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id, name, format, source_path, image_dir, "
            "image_count, annotation_count, category_count, created_at "
            "FROM datasets WHERE id = ?",
            [dataset_id],
        ).fetchone()
    finally:
        cursor.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return DatasetResponse(
        id=row[0],
        name=row[1],
        format=row[2],
        source_path=row[3],
        image_dir=row[4],
        image_count=row[5],
        annotation_count=row[6],
        category_count=row[7],
        created_at=row[8],
    )


@router.delete("/{dataset_id}", status_code=204)
def delete_dataset(
    dataset_id: str, db: DuckDBRepo = Depends(get_db)
) -> None:
    """Delete a dataset and all associated samples, annotations, categories."""
    cursor = db.connection.cursor()
    try:
        # Verify dataset exists
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        cursor.execute(
            "DELETE FROM annotations WHERE dataset_id = ?", [dataset_id]
        )
        cursor.execute(
            "DELETE FROM samples WHERE dataset_id = ?", [dataset_id]
        )
        cursor.execute(
            "DELETE FROM categories WHERE dataset_id = ?", [dataset_id]
        )
        cursor.execute("DELETE FROM datasets WHERE id = ?", [dataset_id])
    finally:
        cursor.close()
