"""Pydantic models for triage operations.

- SetTriageTagRequest: body for PATCH /samples/set-triage-tag
- TriageScore: per-sample composite error score
- WorstImagesResponse: ranked list of worst images
"""

from pydantic import BaseModel

# Triage tag constants
TRIAGE_PREFIX = "triage:"
VALID_TRIAGE_TAGS = {"triage:fp", "triage:tp", "triage:fn", "triage:mistake"}


class SetTriageTagRequest(BaseModel):
    """Request body for setting a triage tag on a single sample."""

    dataset_id: str
    sample_id: str
    tag: str


class TriageScore(BaseModel):
    """Per-sample composite error score for worst-image ranking."""

    sample_id: str
    error_count: int
    confidence_spread: float
    score: float


class WorstImagesResponse(BaseModel):
    """Ranked list of samples by composite error score."""

    items: list[TriageScore]
