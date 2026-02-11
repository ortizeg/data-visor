"""Images API router.

Endpoints:
- GET /images/{dataset_id}/{sample_id} -- serve original or thumbnail
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response

from app.dependencies import get_db, get_image_service, get_storage
from app.repositories.duckdb_repo import DuckDBRepo
from app.repositories.storage import StorageBackend
from app.services.image_service import ImageService

router = APIRouter(prefix="/images", tags=["images"])


@router.get("/{dataset_id}/{sample_id}")
def get_image(
    dataset_id: str,
    sample_id: str,
    size: str = Query(
        default="medium",
        description="Thumbnail size or 'original'",
    ),
    db: DuckDBRepo = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
    image_service: ImageService = Depends(get_image_service),
) -> Response:
    """Serve an image thumbnail (WebP) or the original file.

    Sizes: ``small`` (128), ``medium`` (256), ``large`` (512), ``original``.
    Thumbnails are generated on-demand and cached to disk.
    """
    if size not in ("small", "medium", "large", "original"):
        raise HTTPException(
            status_code=400,
            detail="size must be one of: small, medium, large, original",
        )

    # Look up sample and dataset
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT s.file_name, d.image_dir "
            "FROM samples s "
            "JOIN datasets d ON s.dataset_id = d.id "
            "WHERE s.id = ? AND s.dataset_id = ?",
            [sample_id, dataset_id],
        ).fetchone()
    finally:
        cursor.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Sample not found")

    file_name, image_dir = row
    image_path = storage.resolve_image_path(image_dir, file_name)

    if size == "original":
        if image_path.startswith("gs://"):
            image_bytes = storage.read_bytes(image_path)
            return Response(content=image_bytes, media_type="image/jpeg")
        return FileResponse(image_path)

    # Serve cached or generate thumbnail
    thumbnail_path = image_service.get_or_generate_thumbnail(
        sample_id, image_path, size
    )
    return FileResponse(str(thumbnail_path), media_type="image/webp")
