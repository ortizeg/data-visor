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


class AnnotationUpdate(BaseModel):
    """Request body for PUT /annotations/{id} -- update bbox position/size."""

    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float


class AnnotationCreate(BaseModel):
    """Request body for POST /annotations -- create a new ground_truth annotation."""

    dataset_id: str
    sample_id: str
    category_name: str
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float


class CategoryUpdateRequest(BaseModel):
    """Request body for PATCH /annotations/{id}/category -- update classification label."""

    category_name: str
