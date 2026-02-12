"""Ingestion API router.

Endpoints:
- POST /ingestion/scan    -- scan a folder for COCO datasets
- POST /ingestion/import  -- import detected splits with SSE progress
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.dependencies import get_ingestion_service
from app.models.scan import ImportRequest, ScanRequest, ScanResult
from app.services.folder_scanner import FolderScanner
from app.services.ingestion import IngestionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


@router.post("/scan", response_model=ScanResult)
def scan_folder(request: ScanRequest) -> ScanResult:
    """Scan a directory for importable COCO datasets.

    Returns detected annotation files, image directories, and splits
    as a suggestion for the user to confirm before import.
    """
    root = Path(request.root_path)
    if not root.exists():
        raise HTTPException(
            status_code=400,
            detail=(
                "Directory not found. If running in Docker, ensure "
                "the directory is volume-mounted."
            ),
        )

    scanner = FolderScanner()
    try:
        result = scanner.scan(request.root_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not result.splits:
        raise HTTPException(
            status_code=404,
            detail="No COCO datasets detected in this directory",
        )

    return result


@router.post("/import")
def import_splits(
    request: ImportRequest,
    ingestion_service: IngestionService = Depends(get_ingestion_service),
) -> StreamingResponse:
    """Import multiple COCO splits as a single dataset with SSE progress.

    Streams ``text/event-stream`` events, each containing a JSON payload
    with ``stage``, ``current``, ``total``, ``message``, and ``split``
    fields.
    """

    def progress_stream():
        current_split: str | None = None
        for progress in ingestion_service.ingest_splits_with_progress(
            splits=request.splits,
            dataset_name=request.dataset_name,
        ):
            if progress.stage == "split_start":
                # Extract split name from message for the SSE event.
                current_split = request.splits[progress.current - 1].name

            event_data = json.dumps(
                {
                    "stage": progress.stage,
                    "current": progress.current,
                    "total": progress.total,
                    "message": progress.message,
                    "split": current_split,
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
