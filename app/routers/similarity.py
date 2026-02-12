"""Similarity search API router.

Endpoints:
- GET /datasets/{dataset_id}/similarity/search  -- find visually similar images
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_db, get_similarity_service
from app.models.similarity import SimilarityResponse, SimilarResult
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.similarity_service import SimilarityService

router = APIRouter(prefix="/datasets", tags=["similarity"])


@router.get("/{dataset_id}/similarity/search", response_model=SimilarityResponse)
def search_similar(
    dataset_id: str,
    sample_id: str = Query(
        ..., description="Source sample to find similar images for"
    ),
    limit: int = Query(20, ge=1, le=100),
    similarity_service: SimilarityService = Depends(get_similarity_service),
    db: DuckDBRepo = Depends(get_db),
) -> SimilarityResponse:
    """Find visually similar images ranked by embedding distance.

    Returns ranked results with cosine similarity scores.
    Empty results (no embeddings) return an empty list, not 404.
    """
    # Verify dataset exists
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
    finally:
        cursor.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Find similar images
    raw_results = similarity_service.find_similar(dataset_id, sample_id, limit)

    if not raw_results:
        return SimilarityResponse(results=[], query_sample_id=sample_id)

    # Enrich results with sample metadata (file_name, thumbnail_path)
    cursor = db.connection.cursor()
    try:
        result_ids = [r["sample_id"] for r in raw_results]
        placeholders = ",".join(["?"] * len(result_ids))
        rows = cursor.execute(
            f"SELECT id, file_name, thumbnail_path FROM samples "
            f"WHERE dataset_id = ? AND id IN ({placeholders})",
            [dataset_id, *result_ids],
        ).fetchall()
        meta = {r[0]: {"file_name": r[1], "thumbnail_path": r[2]} for r in rows}
    finally:
        cursor.close()

    enriched = [
        SimilarResult(
            sample_id=r["sample_id"],
            score=r["score"],
            file_name=meta.get(r["sample_id"], {}).get("file_name"),
            thumbnail_path=meta.get(r["sample_id"], {}).get("thumbnail_path"),
        )
        for r in raw_results
    ]

    return SimilarityResponse(results=enriched, query_sample_id=sample_id)
