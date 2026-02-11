"""Pydantic models for prediction import requests and responses."""

from pydantic import BaseModel


class PredictionImportRequest(BaseModel):
    """Request body for importing predictions from a COCO results JSON file."""

    prediction_path: str


class PredictionImportResponse(BaseModel):
    """Response after importing predictions into a dataset."""

    dataset_id: str
    prediction_count: int
    skipped_count: int
    message: str
