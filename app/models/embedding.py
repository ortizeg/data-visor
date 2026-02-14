"""Pydantic models for embedding generation, progress, and status."""

from pydantic import BaseModel


class EmbeddingGenerateRequest(BaseModel):
    """Request body for triggering embedding generation."""

    model_name: str = "siglip-base"


class EmbeddingGenerateResponse(BaseModel):
    """Response returned when embedding generation is triggered."""

    dataset_id: str
    status: str
    message: str


class EmbeddingProgress(BaseModel):
    """Progress update for embedding generation (used in SSE streaming)."""

    status: str = "idle"
    processed: int = 0
    total: int = 0
    message: str = ""


class EmbeddingStatus(BaseModel):
    """Current embedding status for a dataset."""

    dataset_id: str
    has_embeddings: bool
    embedding_count: int
    model_name: str | None = None
    has_reduction: bool


class ReductionProgress(BaseModel):
    """Progress update for dimensionality reduction (used in SSE streaming).

    Statuses:
    - ``idle``: No reduction has been started.
    - ``running``: Loading embeddings from the database.
    - ``fitting``: UMAP fit_transform in progress (can take 10-60s).
    - ``complete``: Reduction finished, 2D coordinates stored.
    - ``error``: An error occurred during reduction.
    """

    status: str = "idle"
    message: str = ""


class EmbeddingPoint(BaseModel):
    """A single 2D point for the scatter-plot visualization.

    Returned by GET /coordinates, one per embedded sample.
    """

    sample_id: str
    x: float
    y: float
    file_name: str
    thumbnail_path: str | None
