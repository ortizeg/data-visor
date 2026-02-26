"""Response models for the classification evaluation endpoint."""

from pydantic import BaseModel


class ClassificationPerClassMetrics(BaseModel):
    """Per-class precision, recall, F1, and support for classification."""

    class_name: str
    precision: float
    recall: float
    f1: float
    support: int


class ClassificationEvaluationResponse(BaseModel):
    """Full classification evaluation payload.

    Returned by GET /datasets/{id}/evaluation when dataset_type is
    ``classification``.
    """

    accuracy: float
    macro_f1: float
    weighted_f1: float
    per_class_metrics: list[ClassificationPerClassMetrics]
    confusion_matrix: list[list[int]]
    confusion_matrix_labels: list[str]
    conf_threshold: float
    evaluation_type: str = "classification"
