"""Per-detection error categorization for object detection evaluation.

Extends the IoU matching logic from evaluation.py to classify each
detection into: True Positive, Hard False Positive, Label Error,
or False Negative.

Uses greedy matching (predictions sorted by confidence descending)
to assign each prediction to its best-matching GT box.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np
from duckdb import DuckDBPyConnection

from app.models.error_analysis import (
    ErrorAnalysisResponse,
    ErrorSample,
    ErrorSummary,
    PerClassErrors,
)
from app.services.evaluation import _compute_iou_matrix, _load_detections

# Maximum number of samples to return per error type (avoid huge payloads)
_MAX_SAMPLES_PER_TYPE = 50


def categorize_errors(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str,
    iou_threshold: float,
    conf_threshold: float,
    split: str | None = None,
) -> ErrorAnalysisResponse:
    """Categorize all detections into error types.

    Algorithm (per sample):
    1. Filter predictions by confidence >= conf_threshold
    2. Sort predictions by confidence descending (greedy matching)
    3. For each prediction, compute IoU with all GT boxes:
       - TP: IoU >= threshold AND class matches AND GT not already matched
       - Label Error: IoU >= threshold AND class mismatch
       - Hard FP: IoU < threshold for all GT (or no GT exists)
    4. Unmatched GT boxes after all predictions processed => False Negatives
    """
    gt_by_sample, pred_by_sample, class_names = _load_detections(
        cursor, dataset_id, source, split=split
    )

    if not class_names and not gt_by_sample and not pred_by_sample:
        return _empty_response()

    # Aggregate counters
    total_tp = 0
    total_hard_fp = 0
    total_label_error = 0
    total_fn = 0

    # Per-class counters: class_name -> {tp, hard_fp, label_error, fn}
    per_class_counts: dict[str, dict[str, int]] = defaultdict(
        lambda: {"tp": 0, "hard_fp": 0, "label_error": 0, "fn": 0}
    )

    # Samples grouped by error type, capped at _MAX_SAMPLES_PER_TYPE
    samples_by_type: dict[str, list[ErrorSample]] = {
        "tp": [],
        "hard_fp": [],
        "label_error": [],
        "false_negative": [],
    }

    sample_ids = sorted(set(gt_by_sample) | set(pred_by_sample))

    for sid in sample_ids:
        gt_rows = gt_by_sample.get(sid, [])
        pred_rows = pred_by_sample.get(sid, [])

        # Filter predictions by confidence threshold
        # _BoxRow format: (cat, x, y, w, h, conf)
        filtered_preds = [
            r for r in pred_rows if (r[4] if r[4] is not None else 1.0) >= conf_threshold
        ]

        # Sort by confidence descending
        filtered_preds.sort(key=lambda r: -(r[4] if r[4] is not None else 1.0))

        # Build GT boxes as xyxy numpy array
        if gt_rows:
            gt_xyxy = np.array(
                [[r[1], r[2], r[1] + r[3], r[2] + r[4]] for r in gt_rows],
                dtype=np.float64,
            )
            gt_classes = [r[0] for r in gt_rows]
        else:
            gt_xyxy = np.empty((0, 4), dtype=np.float64)
            gt_classes = []

        matched_gt: set[int] = set()

        for pred in filtered_preds:
            pred_cat, px, py, pw, ph, conf = pred
            pred_xyxy = np.array([[px, py, px + pw, py + ph]], dtype=np.float64)

            error_type: str

            if len(gt_xyxy) > 0:
                ious = _compute_iou_matrix(pred_xyxy, gt_xyxy)[0]
                best_idx = int(np.argmax(ious))
                best_iou = float(ious[best_idx])

                if best_iou >= iou_threshold and best_idx not in matched_gt:
                    if gt_classes[best_idx] == pred_cat:
                        error_type = "tp"
                        matched_gt.add(best_idx)
                    else:
                        error_type = "label_error"
                        matched_gt.add(best_idx)
                else:
                    error_type = "hard_fp"
            else:
                error_type = "hard_fp"

            # Update counters
            if error_type == "tp":
                total_tp += 1
                per_class_counts[pred_cat]["tp"] += 1
            elif error_type == "label_error":
                total_label_error += 1
                per_class_counts[pred_cat]["label_error"] += 1
            else:
                total_hard_fp += 1
                per_class_counts[pred_cat]["hard_fp"] += 1

            # Collect sample (capped)
            if len(samples_by_type[error_type]) < _MAX_SAMPLES_PER_TYPE:
                samples_by_type[error_type].append(
                    ErrorSample(
                        sample_id=sid,
                        error_type=error_type,
                        category_name=pred_cat,
                        confidence=conf,
                    )
                )

        # False negatives: unmatched GT
        for gi, gt in enumerate(gt_rows):
            if gi not in matched_gt:
                gt_cat = gt[0]
                total_fn += 1
                per_class_counts[gt_cat]["fn"] += 1

                if len(samples_by_type["false_negative"]) < _MAX_SAMPLES_PER_TYPE:
                    samples_by_type["false_negative"].append(
                        ErrorSample(
                            sample_id=sid,
                            error_type="false_negative",
                            category_name=gt_cat,
                            confidence=None,
                        )
                    )

    # Build per-class list sorted by class name
    per_class = sorted(
        [
            PerClassErrors(
                class_name=cls,
                tp=counts["tp"],
                hard_fp=counts["hard_fp"],
                label_error=counts["label_error"],
                fn=counts["fn"],
            )
            for cls, counts in per_class_counts.items()
        ],
        key=lambda x: x.class_name,
    )

    return ErrorAnalysisResponse(
        summary=ErrorSummary(
            true_positives=total_tp,
            hard_false_positives=total_hard_fp,
            label_errors=total_label_error,
            false_negatives=total_fn,
        ),
        per_class=per_class,
        samples_by_type=samples_by_type,
    )


def _empty_response() -> ErrorAnalysisResponse:
    """Return an empty error analysis response when no data is available."""
    return ErrorAnalysisResponse(
        summary=ErrorSummary(
            true_positives=0,
            hard_false_positives=0,
            label_errors=0,
            false_negatives=0,
        ),
        per_class=[],
        samples_by_type={
            "tp": [],
            "hard_fp": [],
            "label_error": [],
            "false_negative": [],
        },
    )
