"""Pydantic models for prediction import requests and responses."""

from typing import Literal

from pydantic import BaseModel


class PredictionImportRequest(BaseModel):
    """Request body for importing predictions.

    Supports two formats:

    - ``coco``: Single COCO detection results JSON file (flat array of dicts).
    - ``detection_annotation``: Directory of per-image JSON files, each a
      self-contained DetectionAnnotation with normalised bboxes.
    """

    prediction_path: str
    format: Literal["coco", "detection_annotation"] = "coco"


class PredictionImportResponse(BaseModel):
    """Response after importing predictions into a dataset."""

    dataset_id: str
    prediction_count: int
    skipped_count: int
    message: str
