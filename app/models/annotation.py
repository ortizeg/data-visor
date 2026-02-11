"""Pydantic models for annotation records."""

from pydantic import BaseModel


class BBox(BaseModel):
    """Bounding box utility model (x, y, width, height)."""

    x: float
    y: float
    w: float
    h: float


class AnnotationResponse(BaseModel):
    """Single annotation record returned by the API."""

    id: str
    dataset_id: str
    sample_id: str
    category_name: str
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    area: float
    is_crowd: bool
    source: str
    confidence: float | None = None


class BatchAnnotationsResponse(BaseModel):
    """Batch annotation response grouping annotations by sample_id."""

    annotations: dict[str, list[AnnotationResponse]]
