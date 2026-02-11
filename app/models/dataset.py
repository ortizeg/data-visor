"""Pydantic models for dataset ingestion and responses."""

from datetime import datetime

from pydantic import BaseModel


class IngestRequest(BaseModel):
    """Request body for dataset ingestion."""

    annotation_path: str
    image_dir: str
    dataset_name: str | None = None
    format: str = "coco"


class DatasetResponse(BaseModel):
    """Single dataset record returned by the API."""

    id: str
    name: str
    format: str
    source_path: str
    image_dir: str
    image_count: int
    annotation_count: int
    category_count: int
    created_at: datetime


class DatasetListResponse(BaseModel):
    """List of datasets returned by the API."""

    datasets: list[DatasetResponse]
