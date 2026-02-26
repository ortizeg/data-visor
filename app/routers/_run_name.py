"""Auto-derive a prediction run name from the source files.

Called by the prediction import endpoint when ``run_name`` is not supplied.

- **detection_annotation** — reads the first JSON file's ``info`` block and
  combines ``annotations_source`` with the date portion of ``created_at``.
- **coco** — uses the file stem (e.g. ``yolov8_results.json`` →
  ``yolov8_results``).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def derive_run_name(prediction_path: Path, fmt: str) -> str:
    """Return a human-readable run name derived from prediction file metadata.

    Falls back to ``"prediction"`` when metadata cannot be extracted.
    """
    if fmt == "classification_jsonl":
        return _from_coco(prediction_path)
    if fmt == "detection_annotation":
        return _from_detection_annotation(prediction_path)
    return _from_coco(prediction_path)


def _from_detection_annotation(dir_path: Path) -> str:
    """Extract ``info.annotations_source`` + date from the first JSON file."""
    json_files = sorted(dir_path.glob("*.json"))
    first_json = json_files[0] if json_files else None
    if first_json is None:
        return "prediction"

    try:
        data = json.loads(first_json.read_bytes())
    except (json.JSONDecodeError, OSError):
        return "prediction"

    info = data.get("info")
    if not isinstance(info, dict):
        return "prediction"

    source = info.get("annotations_source", "")
    created_at = info.get("created_at", "")

    # Take just the date portion (YYYY-MM-DD) if it looks like a timestamp
    date_part = str(created_at).split("T")[0].split(" ")[0] if created_at else ""

    if source and date_part:
        return f"{source}_{date_part}"
    if source:
        return source
    if date_part:
        return f"prediction_{date_part}"
    return "prediction"


def _from_coco(file_path: Path) -> str:
    """Use the file stem as the run name."""
    stem = file_path.stem
    return stem if stem else "prediction"
