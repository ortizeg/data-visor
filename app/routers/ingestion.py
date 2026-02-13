"""Ingestion API router.

Endpoints:
- POST /ingestion/scan    -- scan a folder for COCO datasets
- POST /ingestion/import  -- import detected splits with SSE progress
- POST /ingestion/browse  -- browse a directory for file system navigation
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.dependencies import get_ingestion_service, get_storage
from app.models.scan import BrowseEntry, BrowseRequest, BrowseResponse, ImportRequest, ScanRequest, ScanResult
from app.repositories.storage import StorageBackend
from app.services.folder_scanner import FolderScanner
from app.services.ingestion import IngestionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


@router.post("/scan", response_model=ScanResult)
def scan_folder(
    request: ScanRequest,
    storage: StorageBackend = Depends(get_storage),
) -> ScanResult:
    """Scan a directory for importable COCO datasets.

    Returns detected annotation files, image directories, and splits
    as a suggestion for the user to confirm before import.
    Supports both local paths and ``gs://`` GCS URIs.
    """
    if not request.root_path.startswith("gs://"):
        root = Path(request.root_path)
        if not root.exists():
            raise HTTPException(
                status_code=400,
                detail=(
                    "Directory not found. If running in Docker, ensure "
                    "the directory is volume-mounted."
                ),
            )

    scanner = FolderScanner(storage)
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


# Allowed file extensions shown in the browser (directories always shown).
_BROWSE_EXTENSIONS = {".json"}


@router.post("/browse", response_model=BrowseResponse)
def browse_directory(
    request: BrowseRequest,
    storage: StorageBackend = Depends(get_storage),
) -> BrowseResponse:
    """List directory contents for file system navigation.

    Returns directories and JSON files only (images/binary files hidden
    to reduce noise).  Supports both local paths and ``gs://`` URIs.
    """
    raw_path = request.path.strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="Path is required")

    is_gcs = raw_path.startswith("gs://")

    if is_gcs:
        if not storage.isdir(raw_path):
            raise HTTPException(status_code=400, detail="Directory not found")
        resolved = raw_path.rstrip("/")
    else:
        resolved_path = Path(raw_path).resolve()
        if not resolved_path.is_dir():
            raise HTTPException(status_code=400, detail="Directory not found")
        resolved = str(resolved_path)

    try:
        raw_entries = storage.list_dir_detail(resolved)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot list directory: {e}")

    entries = []
    for e in sorted(raw_entries, key=lambda x: (x["type"] != "directory", x["name"])):
        if e["type"] == "directory":
            entries.append(BrowseEntry(name=e["name"], type="directory"))
        else:
            ext = "." + e["name"].rsplit(".", 1)[-1].lower() if "." in e["name"] else ""
            if ext in _BROWSE_EXTENSIONS:
                entries.append(BrowseEntry(name=e["name"], type="file", size=e.get("size")))

    return BrowseResponse(path=resolved, entries=entries)
