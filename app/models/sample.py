"""Pydantic models for sample records and filtering."""

from pydantic import BaseModel


class SampleResponse(BaseModel):
    """Single sample record returned by the API."""

    id: str
    dataset_id: str
    file_name: str
    width: int
    height: int
    thumbnail_path: str | None = None
    split: str | None = None


class SampleFilter(BaseModel):
    """Filter criteria for sample queries."""

    dataset_id: str
    category: str | None = None
    split: str | None = None
    min_width: int | None = None
    min_height: int | None = None


class PaginatedSamples(BaseModel):
    """Paginated response for sample listings."""

    items: list[SampleResponse]
    total: int
    offset: int
    limit: int
