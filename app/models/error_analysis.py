"""Response models for the error analysis endpoint."""

from pydantic import BaseModel


class ErrorSample(BaseModel):
    """A sample associated with a specific error type."""

    sample_id: str
    error_type: str
    category_name: str
    confidence: float | None


class PerClassErrors(BaseModel):
    """Error breakdown for a single class."""

    class_name: str
    tp: int
    hard_fp: int
    label_error: int
    fn: int


class ErrorSummary(BaseModel):
    """Aggregated error counts across all classes."""

    true_positives: int
    hard_false_positives: int
    label_errors: int
    false_negatives: int


class ErrorAnalysisResponse(BaseModel):
    """Full error analysis payload returned by GET /datasets/{id}/error-analysis."""

    summary: ErrorSummary
    per_class: list[PerClassErrors]
    samples_by_type: dict[str, list[ErrorSample]]
