"""Statistics API router.

Endpoints:
- GET /datasets/{dataset_id}/statistics -- aggregated dataset statistics
- GET /datasets/{dataset_id}/evaluation -- model evaluation metrics
- GET /datasets/{dataset_id}/error-analysis -- per-detection error categorization
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_db
from app.models.classification_evaluation import ClassificationEvaluationResponse
from app.models.error_analysis import ErrorAnalysisResponse
from app.models.evaluation import ConfusionCellSamplesResponse, EvaluationResponse
from app.services.classification_error_analysis import classify_errors as classify_classification_errors
from app.services.classification_evaluation import (
    compute_classification_evaluation,
    get_classification_confusion_cell_samples,
)
from app.models.statistics import (
    ClassDistribution,
    DatasetStatistics,
    SplitBreakdown,
    SummaryStats,
)
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.error_analysis import categorize_errors
from app.services.evaluation import compute_evaluation, get_confusion_cell_samples

router = APIRouter(prefix="/datasets", tags=["statistics"])


@router.get("/{dataset_id}/statistics", response_model=DatasetStatistics)
def get_dataset_statistics(
    dataset_id: str,
    split: str | None = Query(None),
    db: DuckDBRepo = Depends(get_db),
) -> DatasetStatistics:
    """Return aggregated statistics for a dataset.

    Computes server-side via DuckDB GROUP BY queries:
    - Class distribution: GT and prediction annotation counts per category
    - Split breakdown: sample counts per split (train/val/test)
    - Summary: totals for images, GT annotations, predictions, categories
    """
    cursor = db.connection.cursor()
    try:
        # Verify dataset exists and get dataset_type
        row = cursor.execute(
            "SELECT id, dataset_type FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        dataset_type = row[1] or "detection"

        # Class distribution: GT and prediction counts per category
        if split is not None:
            class_rows = cursor.execute(
                "SELECT a.category_name, "
                "COUNT(*) FILTER (WHERE a.source = 'ground_truth') as gt_count, "
                "COUNT(*) FILTER (WHERE a.source != 'ground_truth') as pred_count "
                "FROM annotations a JOIN samples s ON a.sample_id = s.id AND a.dataset_id = s.dataset_id "
                "WHERE a.dataset_id = ? AND s.split = ? "
                "GROUP BY a.category_name ORDER BY gt_count DESC",
                [dataset_id, split],
            ).fetchall()
        else:
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

        # Split breakdown: always show all splits (informational, never filtered)
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
        # For classification datasets, gt_annotations = distinct labeled images
        if dataset_type == "classification":
            gt_agg = "COUNT(DISTINCT a.sample_id)"
        else:
            gt_agg = "COUNT(*)"

        if split is not None:
            summary_row = cursor.execute(
                f"SELECT "
                f"(SELECT COUNT(*) FROM samples WHERE dataset_id = ? AND split = ?) as total_images, "
                f"(SELECT {gt_agg} FROM annotations a JOIN samples s ON a.sample_id = s.id AND a.dataset_id = s.dataset_id "
                f"WHERE a.dataset_id = ? AND a.source = 'ground_truth' AND s.split = ?) as gt_annotations, "
                f"(SELECT COUNT(*) FROM annotations a JOIN samples s ON a.sample_id = s.id AND a.dataset_id = s.dataset_id "
                f"WHERE a.dataset_id = ? AND a.source != 'ground_truth' AND s.split = ?) as pred_annotations, "
                f"(SELECT COUNT(DISTINCT a.category_name) FROM annotations a JOIN samples s ON a.sample_id = s.id AND a.dataset_id = s.dataset_id "
                f"WHERE a.dataset_id = ? AND s.split = ?) as total_categories",
                [dataset_id, split, dataset_id, split, dataset_id, split, dataset_id, split],
            ).fetchone()
        else:
            summary_row = cursor.execute(
                f"SELECT "
                f"(SELECT COUNT(*) FROM samples WHERE dataset_id = ?) as total_images, "
                f"(SELECT {gt_agg} FROM annotations a WHERE a.dataset_id = ? AND a.source = 'ground_truth') as gt_annotations, "
                f"(SELECT COUNT(*) FROM annotations WHERE dataset_id = ? AND source != 'ground_truth') as pred_annotations, "
                f"(SELECT COUNT(DISTINCT category_name) FROM annotations WHERE dataset_id = ?) as total_categories",
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


@router.get("/{dataset_id}/evaluation")
def get_evaluation(
    dataset_id: str,
    source: str = Query("prediction"),
    iou_threshold: float = Query(0.5, ge=0.1, le=1.0),
    conf_threshold: float = Query(0.25, ge=0.0, le=1.0),
    split: str | None = Query(None),
    db: DuckDBRepo = Depends(get_db),
) -> EvaluationResponse | ClassificationEvaluationResponse:
    """Return evaluation metrics comparing predictions to ground truth.

    For detection datasets: PR curves, mAP@50/75/50:95, confusion matrix.
    For classification datasets: accuracy, F1, confusion matrix, per-class P/R/F1.
    """
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id, dataset_type FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        dataset_type = row[1] or "detection"

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

        if dataset_type == "classification":
            return compute_classification_evaluation(
                cursor, dataset_id, source, conf_threshold, split=split
            )

        return compute_evaluation(
            cursor, dataset_id, source, iou_threshold, conf_threshold, split=split
        )
    finally:
        cursor.close()


@router.get(
    "/{dataset_id}/confusion-cell-samples",
    response_model=ConfusionCellSamplesResponse,
)
def get_confusion_cell_samples_endpoint(
    dataset_id: str,
    actual_class: str = Query(...),
    predicted_class: str = Query(...),
    source: str = Query("prediction"),
    iou_threshold: float = Query(0.5, ge=0.1, le=1.0),
    conf_threshold: float = Query(0.25, ge=0.0, le=1.0),
    split: str | None = Query(None),
    db: DuckDBRepo = Depends(get_db),
) -> ConfusionCellSamplesResponse:
    """Return sample IDs that contributed to a specific confusion matrix cell.

    Given an (actual_class, predicted_class) pair from the confusion matrix,
    re-runs IoU matching to find all samples with detections in that cell.
    """
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id, dataset_type FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        dataset_type = row[1] or "detection"

        if dataset_type == "classification":
            sample_ids = get_classification_confusion_cell_samples(
                cursor,
                dataset_id,
                source,
                actual_class,
                predicted_class,
                conf_threshold,
                split=split,
            )
        else:
            sample_ids = get_confusion_cell_samples(
                cursor,
                dataset_id,
                source,
                actual_class,
                predicted_class,
                iou_threshold,
                conf_threshold,
                split=split,
            )

        return ConfusionCellSamplesResponse(
            actual_class=actual_class,
            predicted_class=predicted_class,
            sample_ids=sample_ids,
            count=len(sample_ids),
        )
    finally:
        cursor.close()


@router.get("/{dataset_id}/error-analysis", response_model=ErrorAnalysisResponse)
def get_error_analysis(
    dataset_id: str,
    source: str = Query("prediction"),
    iou_threshold: float = Query(0.5, ge=0.1, le=1.0),
    conf_threshold: float = Query(0.25, ge=0.0, le=1.0),
    split: str | None = Query(None),
    db: DuckDBRepo = Depends(get_db),
) -> ErrorAnalysisResponse:
    """Return per-detection error categorization comparing predictions to GT.

    Classifies each prediction as True Positive, Hard False Positive,
    Label Error, or False Negative using IoU matching with greedy assignment.
    """
    cursor = db.connection.cursor()
    try:
        row = cursor.execute(
            "SELECT id, dataset_type FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        dataset_type = row[1] or "detection"

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

        if dataset_type == "classification":
            return classify_classification_errors(
                cursor, dataset_id, source, conf_threshold, split=split
            )

        return categorize_errors(
            cursor, dataset_id, source, iou_threshold, conf_threshold, split=split
        )
    finally:
        cursor.close()
