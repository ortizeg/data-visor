"""Per-annotation IoU matching for triage classification.

Unlike error_analysis.py which works at the sample level without annotation IDs,
this module queries annotations WITH their IDs so results can be mapped back to
specific annotations in the frontend.

Reuses _compute_iou_matrix from evaluation.py (no duplicate IoU code).
"""

from __future__ import annotations

import numpy as np
from duckdb import DuckDBPyConnection

from app.services.evaluation import _compute_iou_matrix


def match_sample_annotations(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    sample_id: str,
    source: str,
    iou_threshold: float = 0.45,
    conf_threshold: float = 0.25,
) -> dict[str, dict]:
    """Compute per-annotation TP/FP/FN classifications for a single sample.

    Returns a dict mapping annotation_id to:
        {"label": str, "matched_id": str|None, "iou": float|None}

    Labels:
        - "tp": prediction matched a same-class GT box (or GT matched by prediction)
        - "label_error": prediction matched a different-class GT box
        - "fp": prediction with no matching GT
        - "fn": GT with no matching prediction
    """
    # Query GT annotations WITH IDs
    gt_rows = cursor.execute(
        "SELECT id, category_name, bbox_x, bbox_y, bbox_w, bbox_h, confidence "
        "FROM annotations "
        "WHERE dataset_id = ? AND sample_id = ? AND source = 'ground_truth'",
        [dataset_id, sample_id],
    ).fetchall()

    # Query prediction annotations WITH IDs
    pred_rows = cursor.execute(
        "SELECT id, category_name, bbox_x, bbox_y, bbox_w, bbox_h, confidence "
        "FROM annotations "
        "WHERE dataset_id = ? AND sample_id = ? AND source = ?",
        [dataset_id, sample_id, source],
    ).fetchall()

    # Filter predictions by confidence threshold
    filtered_preds = []
    for row in pred_rows:
        ann_id, cat, bx, by, bw, bh, conf = row
        effective_conf = conf if conf is not None else 1.0
        if effective_conf >= conf_threshold:
            filtered_preds.append(row)

    # Sort predictions by confidence descending (greedy matching)
    filtered_preds.sort(
        key=lambda r: -(r[6] if r[6] is not None else 1.0)
    )

    results: dict[str, dict] = {}

    # Build GT xyxy array and metadata
    if gt_rows:
        gt_ids = [r[0] for r in gt_rows]
        gt_cats = [r[1] for r in gt_rows]
        gt_xyxy = np.array(
            [[r[2], r[3], r[2] + r[4], r[3] + r[5]] for r in gt_rows],
            dtype=np.float64,
        )
    else:
        gt_ids = []
        gt_cats = []
        gt_xyxy = np.empty((0, 4), dtype=np.float64)

    matched_gt: set[int] = set()

    # Process each prediction via greedy matching
    for row in filtered_preds:
        pred_id, pred_cat, px, py, pw, ph, conf = row
        pred_xyxy = np.array([[px, py, px + pw, py + ph]], dtype=np.float64)

        label = "fp"
        matched_id: str | None = None
        best_iou: float | None = None

        if len(gt_xyxy) > 0:
            ious = _compute_iou_matrix(pred_xyxy, gt_xyxy)[0]
            best_idx = int(np.argmax(ious))
            best_iou_val = float(ious[best_idx])

            if best_iou_val >= iou_threshold and best_idx not in matched_gt:
                if gt_cats[best_idx] == pred_cat:
                    label = "tp"
                else:
                    label = "label_error"
                matched_gt.add(best_idx)
                matched_id = gt_ids[best_idx]
                best_iou = best_iou_val

        results[pred_id] = {
            "label": label,
            "matched_id": matched_id,
            "iou": best_iou,
        }

    # Mark unmatched GT as fn, matched GT as tp
    for gi, gt_id in enumerate(gt_ids):
        if gi in matched_gt:
            # Find the prediction that matched this GT
            matched_pred_id: str | None = None
            matched_iou: float | None = None
            for pid, info in results.items():
                if info.get("matched_id") == gt_id:
                    matched_pred_id = pid
                    matched_iou = info.get("iou")
                    break
            results[gt_id] = {
                "label": "tp",
                "matched_id": matched_pred_id,
                "iou": matched_iou,
            }
        else:
            results[gt_id] = {
                "label": "fn",
                "matched_id": None,
                "iou": None,
            }

    return results
