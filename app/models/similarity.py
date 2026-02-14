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


# ---------------------------------------------------------------------------
# Near-duplicate detection models
# ---------------------------------------------------------------------------


class NearDuplicateGroup(BaseModel):
    """A group of near-duplicate samples."""

    sample_ids: list[str]
    size: int


class NearDuplicateResponse(BaseModel):
    """Response containing all near-duplicate groups found."""

    groups: list[NearDuplicateGroup]
    total_groups: int
    total_duplicates: int  # total samples across all groups
    threshold: float


class NearDuplicateProgress(BaseModel):
    """Progress update for near-duplicate detection."""

    status: str  # "idle" | "scanning" | "grouping" | "complete" | "error"
    progress: float  # 0.0 to 1.0
    scanned: int
    total: int
    groups_found: int
    message: str
