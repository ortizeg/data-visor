"""Statistics API router.

Endpoints:
- GET /datasets/{dataset_id}/statistics -- aggregated dataset statistics
- GET /datasets/{dataset_id}/evaluation -- model evaluation metrics
- GET /datasets/{dataset_id}/error-analysis -- per-detection error categorization
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_db
from app.models.error_analysis import ErrorAnalysisResponse
from app.models.evaluation import EvaluationResponse
from app.models.statistics import (
    ClassDistribution,
    DatasetStatistics,
    SplitBreakdown,
    SummaryStats,
)
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.error_analysis import categorize_errors
from app.services.evaluation import compute_evaluation

router = APIRouter(prefix="/datasets", tags=["statistics"])


@router.get("/{dataset_id}/statistics", response_model=DatasetStatistics)
def get_dataset_statistics(
    dataset_id: str, db: DuckDBRepo = Depends(get_db)
) -> DatasetStatistics:
    """Return aggregated statistics for a dataset.

    Computes server-side via DuckDB GROUP BY queries:
    - Class distribution: GT and prediction annotation counts per category
    - Split breakdown: sample counts per split (train/val/test)
    - Summary: totals for images, GT annotations, predictions, categories
    """
    cursor = db.connection.cursor()
    try:
        # Verify dataset exists
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Class distribution: GT and prediction counts per category
        class_rows = cursor.execute(
            "SELECT category_name, "
            "COUNT(*) FILTER (WHERE source = 'ground_truth') as gt_count, "
            "COUNT(*) FILTER (WHERE source != 'ground_truth') as pred_count "
            "FROM annotations WHERE dataset_id = ? "
            "GROUP BY category_name ORDER BY gt_count DESC",
            [dataset_id],
        ).fetchall()

        class_distribution = [
            ClassDistribution(
                category_name=r[0], gt_count=r[1], pred_count=r[2]
            )
            for r in class_rows
        ]

        # Split breakdown: sample counts per split
        split_rows = cursor.execute(
            "SELECT COALESCE(split, 'unassigned') as split_name, "
            "COUNT(*) as count "
            "FROM samples WHERE dataset_id = ? "
            "GROUP BY split_name ORDER BY count DESC",
            [dataset_id],
        ).fetchall()

        split_breakdown = [
            SplitBreakdown(split_name=r[0], count=r[1]) for r in split_rows
        ]

        # Summary counts
        summary_row = cursor.execute(
            "SELECT "
            "(SELECT COUNT(*) FROM samples WHERE dataset_id = ?) as total_images, "
            "(SELECT COUNT(*) FROM annotations WHERE dataset_id = ? AND source = 'ground_truth') as gt_annotations, "
            "(SELECT COUNT(*) FROM annotations WHERE dataset_id = ? AND source != 'ground_truth') as pred_annotations, "
            "(SELECT COUNT(DISTINCT category_name) FROM annotations WHERE dataset_id = ?) as total_categories",
            [dataset_id, dataset_id, dataset_id, dataset_id],
        ).fetchone()

        summary = SummaryStats(
            total_images=summary_row[0],
            gt_annotations=summary_row[1],
            pred_annotations=summary_row[2],
            total_categories=summary_row[3],
        )

    finally:
        cursor.close()

    return DatasetStatistics(
        class_distribution=class_distribution,
        split_breakdown=split_breakdown,
        summary=summary,
    )


@router.get("/{dataset_id}/evaluation", response_model=EvaluationResponse)
def get_evaluation(
    dataset_id: str,
    source: str = Query("prediction"),
    iou_threshold: float = Query(0.5, ge=0.1, le=1.0),
    conf_threshold: float = Query(0.25, ge=0.0, le=1.0),
    db: DuckDBRepo = Depends(get_db),
) -> EvaluationResponse:
    """Return evaluation metrics comparing predictions to ground truth.

    Computes PR curves, mAP@50/75/50:95, confusion matrix, and per-class
    precision/recall at the given IoU and confidence thresholds.
    """
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Verify that the requested source has annotations
        source_count = cursor.execute(
            "SELECT COUNT(*) FROM annotations WHERE dataset_id = ? AND source = ?",
            [dataset_id, source],
        ).fetchone()[0]
        if source_count == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No annotations found for source '{source}'",
            )

        return compute_evaluation(
            cursor, dataset_id, source, iou_threshold, conf_threshold
        )
    finally:
        cursor.close()


@router.get("/{dataset_id}/error-analysis", response_model=ErrorAnalysisResponse)
def get_error_analysis(
    dataset_id: str,
    source: str = Query("prediction"),
    iou_threshold: float = Query(0.5, ge=0.1, le=1.0),
    conf_threshold: float = Query(0.25, ge=0.0, le=1.0),
    db: DuckDBRepo = Depends(get_db),
) -> ErrorAnalysisResponse:
    """Return per-detection error categorization comparing predictions to GT.

    Classifies each prediction as True Positive, Hard False Positive,
    Label Error, or False Negative using IoU matching with greedy assignment.
    """
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Verify that the requested source has annotations
        source_count = cursor.execute(
            "SELECT COUNT(*) FROM annotations WHERE dataset_id = ? AND source = ?",
            [dataset_id, source],
        ).fetchone()[0]
        if source_count == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No annotations found for source '{source}'",
            )

        return categorize_errors(
            cursor, dataset_id, source, iou_threshold, conf_threshold
        )
    finally:
        cursor.close()
