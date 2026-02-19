"""Classification evaluation service.

Computes accuracy, F1, confusion matrix, and per-class precision/recall/F1
by comparing ground-truth labels to predicted labels per sample.
No IoU matching is needed -- classification is a direct label comparison.
"""

from __future__ import annotations

from collections import defaultdict

from app.models.classification_evaluation import (
    ClassificationEvaluationResponse,
    ClassificationPerClassMetrics,
)
from app.models.evaluation import ConfusionCellSamplesResponse


def compute_classification_evaluation(
    cursor,
    dataset_id: str,
    source: str,
    conf_threshold: float,
    split: str | None = None,
) -> ClassificationEvaluationResponse:
    """Compute classification evaluation metrics.

    Parameters
    ----------
    cursor:
        DuckDB cursor.
    dataset_id:
        The dataset to evaluate.
    source:
        Prediction source (run name).
    conf_threshold:
        Minimum confidence for predictions.
    split:
        Optional split filter (train/val/test).

    Returns
    -------
    ClassificationEvaluationResponse
        Accuracy, F1 scores, per-class metrics, and confusion matrix.
    """
    # Query GT and prediction labels per sample.
    # For multi-label GT, take MIN(gt.category_name) to get one label per sample.
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

    # Build confusion counts: (gt_label, pred_label) -> count
    confusion_counts: dict[tuple[str, str | None], int] = defaultdict(int)
    all_classes: set[str] = set()

    for _sample_id, gt_label, pred_label, _confidence in rows:
        all_classes.add(gt_label)
        if pred_label is not None:
            all_classes.add(pred_label)
        confusion_counts[(gt_label, pred_label)] += 1

    labels = sorted(all_classes)
    label_to_idx = {lbl: i for i, lbl in enumerate(labels)}
    n = len(labels)

    # Build confusion matrix (rows=actual, cols=predicted)
    matrix = [[0] * n for _ in range(n)]
    # Track missing predictions (pred_label is None)
    missing_per_class: dict[str, int] = defaultdict(int)

    for (gt_label, pred_label), count in confusion_counts.items():
        if pred_label is None:
            missing_per_class[gt_label] += count
        else:
            gt_idx = label_to_idx[gt_label]
            pred_idx = label_to_idx[pred_label]
            matrix[gt_idx][pred_idx] += count

    # Compute metrics from confusion matrix
    total = sum(sum(row) for row in matrix)
    correct = sum(matrix[i][i] for i in range(n))
    accuracy = correct / total if total > 0 else 0.0

    per_class: list[ClassificationPerClassMetrics] = []
    f1_scores: list[float] = []
    supports: list[int] = []

    for i, class_name in enumerate(labels):
        tp = matrix[i][i]
        # Support = total GT samples for this class (row sum + missing)
        row_sum = sum(matrix[i])
        support = row_sum + missing_per_class.get(class_name, 0)

        # Precision: tp / (tp + fp), where fp = column sum - tp
        col_sum = sum(matrix[r][i] for r in range(n))
        precision = tp / col_sum if col_sum > 0 else 0.0

        # Recall: tp / (tp + fn), where fn = row_sum - tp + missing
        total_actual = row_sum + missing_per_class.get(class_name, 0)
        recall = tp / total_actual if total_actual > 0 else 0.0

        # F1
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) > 0
            else 0.0
        )

        per_class.append(
            ClassificationPerClassMetrics(
                class_name=class_name,
                precision=round(precision, 4),
                recall=round(recall, 4),
                f1=round(f1, 4),
                support=support,
            )
        )
        f1_scores.append(f1)
        supports.append(support)

    # Macro F1: unweighted mean of per-class F1
    macro_f1 = sum(f1_scores) / len(f1_scores) if f1_scores else 0.0

    # Weighted F1: weighted by support
    total_support = sum(supports)
    weighted_f1 = (
        sum(f * s for f, s in zip(f1_scores, supports)) / total_support
        if total_support > 0
        else 0.0
    )

    return ClassificationEvaluationResponse(
        accuracy=round(accuracy, 4),
        macro_f1=round(macro_f1, 4),
        weighted_f1=round(weighted_f1, 4),
        per_class_metrics=per_class,
        confusion_matrix=matrix,
        confusion_matrix_labels=labels,
        conf_threshold=conf_threshold,
    )


def get_classification_confusion_cell_samples(
    cursor,
    dataset_id: str,
    source: str,
    actual_class: str,
    predicted_class: str,
    conf_threshold: float,
    split: str | None = None,
) -> list[str]:
    """Return sample IDs for a (gt_class, pred_class) confusion matrix cell.

    No IoU matching needed -- simple label comparison.
    """
    split_clause = "AND s.split = ?" if split else ""
    params: list = [source, conf_threshold, actual_class, predicted_class, dataset_id]
    if split:
        params.append(split)

    query = f"""
        SELECT DISTINCT s.id
        FROM samples s
        JOIN annotations gt
            ON gt.sample_id = s.id
            AND gt.dataset_id = s.dataset_id
            AND gt.source = 'ground_truth'
        JOIN annotations pred
            ON pred.sample_id = s.id
            AND pred.dataset_id = s.dataset_id
            AND pred.source = ?
            AND (pred.confidence >= ? OR pred.confidence IS NULL)
        WHERE gt.category_name = ?
            AND pred.category_name = ?
            AND s.dataset_id = ?
            {split_clause}
    """

    rows = cursor.execute(query, params).fetchall()
    return [r[0] for r in rows]
