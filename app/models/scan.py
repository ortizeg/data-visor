"""Pydantic models for folder scanning and multi-split import."""

from pydantic import BaseModel


class DetectedSplit(BaseModel):
    """A single importable split detected by FolderScanner."""

    name: str
    """Canonical split name: ``"train"``, ``"val"``, or ``"test"``."""

    annotation_path: str
    """Absolute path to the COCO JSON annotation file."""

    image_dir: str
    """Absolute path to the image directory."""

    image_count: int
    """Number of image files found in *image_dir*."""

    annotation_file_size: int
    """Size in bytes of the annotation file."""


class ScanRequest(BaseModel):
    """Request body for the ``POST /ingestion/scan`` endpoint."""

    root_path: str
    """Folder path to scan for COCO datasets."""


class ScanResult(BaseModel):
    """Response from the ``POST /ingestion/scan`` endpoint."""

    root_path: str
    """Resolved absolute path that was scanned."""

    dataset_name: str
    """Inferred dataset name (root directory name)."""

    format: str
    """Detected annotation format (currently always ``"coco"``)."""

    splits: list[DetectedSplit]
    """Detected importable splits (may be empty)."""

    warnings: list[str]
    """Non-fatal issues encountered during scanning."""


class ImportSplit(BaseModel):
    """A single split to import, as provided by the user."""

    name: str
    """Split name: ``"train"``, ``"val"``, ``"test"``, or custom."""

    annotation_path: str
    """Absolute path to the COCO JSON annotation file."""

    image_dir: str
    """Absolute path to the image directory."""


class ImportRequest(BaseModel):
    """Request body for the ``POST /ingestion/import`` endpoint."""

    dataset_name: str
    """Name for the imported dataset."""

    splits: list[ImportSplit]
    """Splits to import (user may have deselected some from scan results)."""

    format: str = "coco"
    """Annotation format: ``"coco"`` or ``"classification_jsonl"``."""


class BrowseRequest(BaseModel):
    """Request body for the ``POST /ingestion/browse`` endpoint."""

    path: str
    """Directory path to browse (local or ``gs://...``)."""


class BrowseEntry(BaseModel):
    """A single entry in a directory listing."""

    name: str
    """Entry name (basename only)."""

    type: str
    """``"directory"`` or ``"file"``."""

    size: int | None = None
    """Size in bytes (``None`` for directories)."""


class BrowseResponse(BaseModel):
    """Response from the ``POST /ingestion/browse`` endpoint."""

    path: str
    """Resolved absolute path that was browsed."""

    entries: list[BrowseEntry]
    """Directory contents (directories and JSON files only)."""
