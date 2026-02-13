"""Response models for the evaluation endpoint."""

from pydantic import BaseModel


class PRPoint(BaseModel):
    """Single point on a precision-recall curve."""

    recall: float
    precision: float
    confidence: float


class PRCurve(BaseModel):
    """PR curve for a single class (or 'all' for the aggregate curve)."""

    class_name: str
    points: list[PRPoint]
    ap: float


class APMetrics(BaseModel):
    """Mean average precision at standard IoU thresholds."""

    map50: float
    map75: float
    map50_95: float


class PerClassMetrics(BaseModel):
    """Per-class AP breakdown and precision/recall at the operating point."""

    class_name: str
    ap50: float
    ap75: float
    ap50_95: float
    precision: float
    recall: float


class EvaluationResponse(BaseModel):
    """Full evaluation payload returned by GET /datasets/{id}/evaluation."""

    pr_curves: list[PRCurve]
    ap_metrics: APMetrics
    per_class_metrics: list[PerClassMetrics]
    confusion_matrix: list[list[int]]
    confusion_matrix_labels: list[str]
    iou_threshold: float
    conf_threshold: float


class ConfusionCellSamplesResponse(BaseModel):
    """Response for GET /datasets/{id}/confusion-cell-samples."""

    actual_class: str
    predicted_class: str
    sample_ids: list[str]
    count: int
