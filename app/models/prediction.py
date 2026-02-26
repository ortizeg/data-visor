"""Pydantic models for prediction import requests and responses."""

from typing import Literal

from pydantic import BaseModel


class PredictionImportRequest(BaseModel):
    """Request body for importing predictions.

    Supports two formats:

    - ``coco``: Single COCO detection results JSON file (flat array of dicts).
    - ``detection_annotation``: Directory of per-image JSON files, each a
      self-contained DetectionAnnotation with normalised bboxes.

    If ``run_name`` is omitted the server derives it automatically:

    - **detection_annotation** — from ``info.annotations_source`` +
      ``info.created_at`` in the first JSON file.
    - **coco** — from the file stem (e.g. ``yolov8_results.json`` →
      ``yolov8_results``).
    """

    prediction_path: str
    format: Literal["coco", "detection_annotation", "classification_jsonl"] = "coco"
    run_name: str | None = None


class PredictionImportResponse(BaseModel):
    """Response after importing predictions into a dataset."""

    dataset_id: str
    run_name: str
    prediction_count: int
    skipped_count: int
    message: str
