"""Classification error analysis service.

Categorises each sample as correct, misclassified, or missing_prediction
by comparing ground-truth labels to predicted labels.  Reuses the existing
``ErrorAnalysisResponse`` model from the detection pipeline.
"""

from __future__ import annotations

from collections import defaultdict

from app.models.error_analysis import (
    ErrorAnalysisResponse,
    ErrorSample,
    ErrorSummary,
    PerClassErrors,
)


def classify_errors(
    cursor,
    dataset_id: str,
    source: str,
    conf_threshold: float,
    split: str | None = None,
) -> ErrorAnalysisResponse:
    """Categorise classification predictions as correct/misclassified/missing.

    Parameters
    ----------
    cursor:
        DuckDB cursor.
    dataset_id:
        The dataset to analyse.
    source:
        Prediction source (run name).
    conf_threshold:
        Minimum confidence for predictions.
    split:
        Optional split filter.

    Returns
    -------
    ErrorAnalysisResponse
        Summary counts, per-class breakdown, and samples grouped by error type.
    """
    split_clause = "AND s.split = ?" if split else ""
    params: list = [source, conf_threshold, dataset_id]
    if split:
        params.append(split)

    query = f"""
        SELECT
            s.id as sample_id,
            MIN(gt.category_name) as gt_label,
            pred.category_name as pred_label,
            pred.confidence as pred_confidence
        FROM samples s
        JOIN annotations gt
            ON gt.sample_id = s.id
            AND gt.dataset_id = s.dataset_id
            AND gt.source = 'ground_truth'
        LEFT JOIN annotations pred
            ON pred.sample_id = s.id
            AND pred.dataset_id = s.dataset_id
            AND pred.source = ?
            AND (pred.confidence >= ? OR pred.confidence IS NULL)
        WHERE s.dataset_id = ?
        {split_clause}
        GROUP BY s.id, pred.category_name, pred.confidence
    """

    rows = cursor.execute(query, params).fetchall()

    # Categorise each sample
    correct_count = 0
    misclassified_count = 0
    missing_count = 0

    # Per-class tracking
    class_tp: dict[str, int] = defaultdict(int)
    class_label_error: dict[str, int] = defaultdict(int)
    class_fn: dict[str, int] = defaultdict(int)
    all_classes: set[str] = set()

    # Samples by error type
    samples_correct: list[ErrorSample] = []
    samples_misclassified: list[ErrorSample] = []
    samples_missing: list[ErrorSample] = []

    for sample_id, gt_label, pred_label, pred_confidence in rows:
        all_classes.add(gt_label)

        if pred_label is None:
            # No prediction for this sample
            missing_count += 1
            class_fn[gt_label] += 1
            samples_missing.append(
                ErrorSample(
                    sample_id=sample_id,
                    error_type="missing_prediction",
                    category_name=gt_label,
                    confidence=None,
                )
            )
        elif gt_label == pred_label:
            # Correct prediction
            correct_count += 1
            class_tp[gt_label] += 1
            all_classes.add(pred_label)
            samples_correct.append(
                ErrorSample(
                    sample_id=sample_id,
                    error_type="correct",
                    category_name=gt_label,
                    confidence=pred_confidence,
                )
            )
        else:
            # Misclassified
            misclassified_count += 1
            class_label_error[gt_label] += 1
            all_classes.add(pred_label)
            samples_misclassified.append(
                ErrorSample(
                    sample_id=sample_id,
                    error_type="misclassified",
                    category_name=gt_label,
                    confidence=pred_confidence,
                )
            )

    summary = ErrorSummary(
        true_positives=correct_count,
        hard_false_positives=0,
        label_errors=misclassified_count,
        false_negatives=missing_count,
    )

    per_class = [
        PerClassErrors(
            class_name=cls,
            tp=class_tp.get(cls, 0),
            hard_fp=0,
            label_error=class_label_error.get(cls, 0),
            fn=class_fn.get(cls, 0),
        )
        for cls in sorted(all_classes)
    ]

    samples_by_type = {
        "correct": samples_correct,
        "misclassified": samples_misclassified,
        "missing_prediction": samples_missing,
    }

    return ErrorAnalysisResponse(
        summary=summary,
        per_class=per_class,
        samples_by_type=samples_by_type,
    )
