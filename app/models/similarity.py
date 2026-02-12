"""Pydantic models for similarity search request/response."""

from pydantic import BaseModel


class SimilarResult(BaseModel):
    """A single similar image result with cosine similarity score."""

    sample_id: str
    score: float
    file_name: str | None = None
    thumbnail_path: str | None = None


class SimilarityResponse(BaseModel):
    """Response for a similarity search query."""

    results: list[SimilarResult]
    query_sample_id: str
