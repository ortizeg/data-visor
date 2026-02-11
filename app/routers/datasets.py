"""Datasets API router -- POST /datasets/ingest (SSE), GET /datasets, etc."""

from fastapi import APIRouter

router = APIRouter(prefix="/datasets", tags=["datasets"])
