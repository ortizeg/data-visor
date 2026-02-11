"""Datasets API router.

Endpoints:
- POST /datasets/ingest                     -- ingest a COCO dataset with SSE progress streaming
- GET  /datasets                            -- list all datasets
- GET  /datasets/{id}                       -- get a single dataset
- DELETE /datasets/{id}                     -- delete a dataset and all related data
- POST /datasets/{id}/predictions           -- import predictions from COCO results JSON
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.dependencies import get_db, get_ingestion_service
from app.ingestion.prediction_parser import PredictionParser
from app.models.dataset import (
    DatasetListResponse,
    DatasetResponse,
    IngestRequest,
)
from app.models.prediction import PredictionImportRequest, PredictionImportResponse
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.ingestion import IngestionService

logger = logging.getLogger(__name__)

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
            "image_count, annotation_count, category_count, "
            "prediction_count, created_at "
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
            prediction_count=row[8],
            created_at=row[9],
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
            "image_count, annotation_count, category_count, "
            "prediction_count, created_at "
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
        prediction_count=row[8],
        created_at=row[9],
    )


@router.post(
    "/{dataset_id}/predictions", response_model=PredictionImportResponse
)
def import_predictions(
    dataset_id: str,
    request: PredictionImportRequest,
    db: DuckDBRepo = Depends(get_db),
) -> PredictionImportResponse:
    """Import model predictions from a COCO detection results JSON file.

    Replaces any existing predictions for this dataset (ground truth is
    never touched).  Updates the dataset's ``prediction_count``.
    """
    cursor = db.connection.cursor()
    try:
        # 1. Verify dataset exists
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # 2. Load category mapping from categories table
        cat_rows = cursor.execute(
            "SELECT category_id, name FROM categories WHERE dataset_id = ?",
            [dataset_id],
        ).fetchall()
        category_map: dict[int, str] = {r[0]: r[1] for r in cat_rows}

        # 3. Delete existing predictions (preserve ground truth)
        cursor.execute(
            "DELETE FROM annotations "
            "WHERE dataset_id = ? AND source = 'prediction'",
            [dataset_id],
        )

        # 4. Stream-parse and insert predictions
        prediction_path = Path(request.prediction_path)
        if not prediction_path.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Prediction file not found: {request.prediction_path}",
            )

        parser = PredictionParser()
        total_inserted = 0
        total_skipped = 0

        for batch_df in parser.parse_streaming(
            file_path=prediction_path,
            category_map=category_map,
            dataset_id=dataset_id,
        ):
            cursor.execute(
                "INSERT INTO annotations SELECT * FROM batch_df"
            )
            total_inserted += len(batch_df)

        # Count skipped by comparing: file has N items, inserted M
        # Recount from file to determine total predictions in file
        import ijson

        with open(prediction_path, "rb") as f:
            file_total = sum(1 for _ in ijson.items(f, "item"))
        total_skipped = file_total - total_inserted

        # 5. Update dataset prediction_count
        cursor.execute(
            "UPDATE datasets SET prediction_count = ? WHERE id = ?",
            [total_inserted, dataset_id],
        )

    finally:
        cursor.close()

    message = f"Imported {total_inserted} predictions"
    if total_skipped > 0:
        message += f" ({total_skipped} skipped due to unmapped categories)"

    logger.info(
        "Dataset %s: %s", dataset_id, message
    )

    return PredictionImportResponse(
        dataset_id=dataset_id,
        prediction_count=total_inserted,
        skipped_count=total_skipped,
        message=message,
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
