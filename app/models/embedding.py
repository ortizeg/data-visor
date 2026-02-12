"""Pydantic models for embedding generation, progress, and status."""

from pydantic import BaseModel


class EmbeddingGenerateRequest(BaseModel):
    """Request body for triggering embedding generation."""

    model_name: str = "dinov2-base"


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
