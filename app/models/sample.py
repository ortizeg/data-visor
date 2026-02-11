"""Pydantic models for sample records and filtering."""

from typing import Literal

from pydantic import BaseModel, Field


class SampleResponse(BaseModel):
    """Single sample record returned by the API."""

    id: str
    dataset_id: str
    file_name: str
    width: int
    height: int
    thumbnail_path: str | None = None
    split: str | None = None
    tags: list[str] = []


class SampleFilter(BaseModel):
    """Filter criteria for sample queries."""

    dataset_id: str
    category: str | None = None
    split: str | None = None
    min_width: int | None = None
    min_height: int | None = None


class SampleFilterParams(BaseModel):
    """Extended query parameters for filtered sample listing."""

    dataset_id: str
    category: str | None = None
    split: str | None = None
    search: str | None = None
    tags: str | None = None  # Comma-separated tag list
    sort_by: str = "id"
    sort_dir: Literal["asc", "desc"] = "asc"
    offset: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=200)


class PaginatedSamples(BaseModel):
    """Paginated response for sample listings."""

    items: list[SampleResponse]
    total: int
    offset: int
    limit: int
