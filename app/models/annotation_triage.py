"""Pydantic models for per-annotation triage.

- AnnotationTriageResult: single annotation classification (auto or override)
- AnnotationTriageResponse: list of per-annotation results for GET endpoint
- SetAnnotationTriageRequest: body for PATCH /samples/set-annotation-triage
"""

from pydantic import BaseModel

# Valid labels for annotation-level triage
VALID_ANNOTATION_TRIAGE_LABELS: set[str] = {"tp", "fp", "fn", "mistake"}


class AnnotationTriageResult(BaseModel):
    """Classification result for a single annotation."""

    annotation_id: str
    auto_label: str  # "tp" | "fp" | "fn" | "label_error"
    label: str  # final label after override merge
    matched_id: str | None = None
    iou: float | None = None
    is_override: bool = False


class AnnotationTriageResponse(BaseModel):
    """Response for GET /samples/{sample_id}/annotation-triage."""

    items: list[AnnotationTriageResult]


class SetAnnotationTriageRequest(BaseModel):
    """Request body for PATCH /samples/set-annotation-triage."""

    annotation_id: str
    dataset_id: str
    sample_id: str
    label: str
