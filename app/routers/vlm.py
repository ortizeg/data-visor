"""VLM (Vision-Language Model) auto-tagging API router.

Stub endpoints for Plan 02 to fill in with Moondream2 implementation.

Endpoints:
- POST /datasets/{dataset_id}/auto-tag -- trigger VLM auto-tagging (stub)
- GET /datasets/{dataset_id}/auto-tag/progress -- tagging progress (stub)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/datasets", tags=["vlm"])


@router.post("/{dataset_id}/auto-tag")
def auto_tag(dataset_id: str) -> dict:
    """Trigger VLM auto-tagging for all samples in a dataset.

    Not yet implemented -- will use Moondream2 to generate descriptive
    tags (lighting, clarity, setting, weather, density) for each sample.
    """
    raise HTTPException(
        status_code=501, detail="VLM auto-tagging not yet implemented"
    )


@router.get("/{dataset_id}/auto-tag/progress")
def auto_tag_progress(dataset_id: str) -> dict:
    """Get progress of VLM auto-tagging for a dataset.

    Returns idle status until auto-tagging is implemented.
    """
    return {"status": "idle", "processed": 0, "total": 0}
