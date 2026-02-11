"""Images API router -- GET /images/{dataset_id}/{sample_id} for thumbnails."""

from fastapi import APIRouter

router = APIRouter(prefix="/images", tags=["images"])
