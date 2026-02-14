"""Evaluation service: computes PR curves, mAP, and confusion matrices.

Uses a hybrid approach:
- Custom numpy code for PR curve data points (supervision doesn't expose these)
- supervision.MeanAveragePrecision for mAP@50/75/50:95
- supervision.ConfusionMatrix for confusion matrix
- Custom numpy for per-class precision/recall at a given confidence threshold
"""

from __future__ import annotations

import numpy as np
import supervision as sv
from duckdb import DuckDBPyConnection
from supervision.metrics.mean_average_precision import (
    MeanAveragePrecision as MAPMetric,
)

from app.models.evaluation import (
    APMetrics,
    EvaluationResponse,
    PRCurve,
    PRPoint,
    PerClassMetrics,
)


def get_confusion_cell_samples(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str,
    actual_class: str,
    predicted_class: str,
    iou_threshold: float,
    conf_threshold: float,
    split: str | None = None,
) -> list[str]:
    """Return sample IDs that contributed to a specific confusion matrix cell.

    Re-runs IoU matching per sample to determine which samples have detections
    mapping to the given (actual_class, predicted_class) pair.

    Handles the "background" class:
    - actual_class="background": false positive predictions of predicted_class
    - predicted_class="background": false negative GTs of actual_class
    - Both non-background: matched pair where GT=actual_class, pred=predicted_class
    """
    gt_by_sample, pred_by_sample, class_names = _load_detections(
        cursor, dataset_id, source, split=split
    )

    if not class_names:
        return []

    class_name_to_id = {name: i for i, name in enumerate(class_names)}
    sample_ids = sorted(set(gt_by_sample) | set(pred_by_sample))
    matching_samples: list[str] = []

    for sid in sample_ids:
        gt_det = _build_detections(gt_by_sample.get(sid, []), class_name_to_id)
        pred_det = _build_detections(pred_by_sample.get(sid, []), class_name_to_id)

        # Filter predictions by confidence threshold
        if len(pred_det) > 0 and pred_det.confidence is not None:
            conf_mask = pred_det.confidence >= conf_threshold
            pred_det = pred_det[conf_mask]

        # Greedy IoU matching: sort predictions by confidence descending
        matched_gt_indices: set[int] = set()
        matched_pred_indices: set[int] = set()
        # Track (gt_class, pred_class) pairs for this sample
        match_pairs: list[tuple[str, str]] = []

        if len(pred_det) > 0 and len(gt_det) > 0:
            conf = (
                pred_det.confidence
                if pred_det.confidence is not None
                else np.ones(len(pred_det))
            )
            order = np.argsort(-conf)

            iou_matrix = _compute_iou_matrix(pred_det.xyxy, gt_det.xyxy)

            for pi in order:
                pi = int(pi)
                pred_cid = int(pred_det.class_id[pi])

                # Find GT boxes of the same class that haven't been matched
                best_iou = 0.0
                best_gi = -1
                for gi in range(len(gt_det)):
                    if gi in matched_gt_indices:
                        continue
                    if int(gt_det.class_id[gi]) != pred_cid:
                        continue
                    if iou_matrix[pi, gi] > best_iou:
                        best_iou = iou_matrix[pi, gi]
                        best_gi = gi

                if best_iou >= iou_threshold and best_gi >= 0:
                    # Matched: GT class -> pred class
                    matched_gt_indices.add(best_gi)
                    matched_pred_indices.add(pi)
                    gt_name = class_names[int(gt_det.class_id[best_gi])]
                    pred_name = class_names[pred_cid]
                    match_pairs.append((gt_name, pred_name))

        # Unmatched predictions -> (background, pred_class)  -- false positives
        if len(pred_det) > 0:
            for pi in range(len(pred_det)):
                if pi not in matched_pred_indices:
                    pred_name = class_names[int(pred_det.class_id[pi])]
                    match_pairs.append(("background", pred_name))

        # Unmatched GTs -> (gt_class, background)  -- false negatives
        if len(gt_det) > 0:
            for gi in range(len(gt_det)):
                if gi not in matched_gt_indices:
                    gt_name = class_names[int(gt_det.class_id[gi])]
                    match_pairs.append((gt_name, "background"))

        # Check if this sample has the requested (actual, predicted) pair
        if (actual_class, predicted_class) in match_pairs:
            matching_samples.append(sid)

    return matching_samples


def compute_evaluation(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str,
    iou_threshold: float,
    conf_threshold: float,
    split: str | None = None,
) -> EvaluationResponse:
    """Compute full evaluation metrics for a dataset's predictions vs GT."""
    gt_by_sample, pred_by_sample, class_names = _load_detections(
        cursor, dataset_id, source, split=split
    )

    if not class_names:
        return _empty_response(iou_threshold, conf_threshold)

    class_name_to_id = {name: i for i, name in enumerate(class_names)}
    n_classes = len(class_names)

    # Build supervision Detections per sample
    gt_det_list: list[sv.Detections] = []
    pred_det_list: list[sv.Detections] = []

    sample_ids = sorted(set(gt_by_sample) | set(pred_by_sample))
    for sid in sample_ids:
        gt_det_list.append(
            _build_detections(gt_by_sample.get(sid, []), class_name_to_id)
        )
        pred_det_list.append(
            _build_detections(pred_by_sample.get(sid, []), class_name_to_id)
        )

    # PR curves (custom numpy)
    pr_curves = _compute_pr_curves(
        gt_det_list, pred_det_list, class_names, iou_threshold
    )

    # mAP via supervision
    ap_metrics, per_class_ap = _compute_map(
        gt_det_list, pred_det_list, class_names
    )

    # Confusion matrix via supervision
    cm, cm_labels = _compute_confusion_matrix(
        gt_det_list, pred_det_list, class_names, conf_threshold, iou_threshold
    )

    # Per-class precision/recall: derive from PR curve points at conf_threshold
    # so table values match the PR curve operating point exactly.
    pr_at_conf: dict[str, dict[str, float]] = {}
    for curve in pr_curves:
        if curve.class_name == "all":
            continue
        if not curve.points:
            pr_at_conf[curve.class_name] = {"precision": 0.0, "recall": 0.0}
            continue
        # Find the point closest to conf_threshold
        closest = min(curve.points, key=lambda p: abs(p.confidence - conf_threshold))
        pr_at_conf[curve.class_name] = {
            "precision": closest.precision,
            "recall": closest.recall,
        }

    # Merge per-class AP and P/R
    per_class_metrics = []
    for i, name in enumerate(class_names):
        ap50 = per_class_ap.get(name, {}).get("ap50", 0.0)
        ap75 = per_class_ap.get(name, {}).get("ap75", 0.0)
        ap50_95 = per_class_ap.get(name, {}).get("ap50_95", 0.0)
        pr_data = pr_at_conf.get(name, {"precision": 0.0, "recall": 0.0})
        per_class_metrics.append(
            PerClassMetrics(
                class_name=name,
                ap50=ap50,
                ap75=ap75,
                ap50_95=ap50_95,
                precision=pr_data["precision"],
                recall=pr_data["recall"],
            )
        )

    return EvaluationResponse(
        pr_curves=pr_curves,
        ap_metrics=ap_metrics,
        per_class_metrics=per_class_metrics,
        confusion_matrix=cm,
        confusion_matrix_labels=cm_labels,
        iou_threshold=iou_threshold,
        conf_threshold=conf_threshold,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_BoxRow = tuple[str, float, float, float, float, float | None]  # cat, x,y,w,h, conf


def _load_detections(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str,
    *,
    split: str | None = None,
) -> tuple[dict[str, list[_BoxRow]], dict[str, list[_BoxRow]], list[str]]:
    """Query GT and prediction annotations, grouped by sample_id."""
    if split is not None:
        gt_rows = cursor.execute(
            "SELECT a.sample_id, a.category_name, a.bbox_x, a.bbox_y, a.bbox_w, a.bbox_h, a.confidence "
            "FROM annotations a JOIN samples s ON a.sample_id = s.id AND a.dataset_id = s.dataset_id "
            "WHERE a.dataset_id = ? AND a.source = 'ground_truth' AND s.split = ?",
            [dataset_id, split],
        ).fetchall()

        pred_rows = cursor.execute(
            "SELECT a.sample_id, a.category_name, a.bbox_x, a.bbox_y, a.bbox_w, a.bbox_h, a.confidence "
            "FROM annotations a JOIN samples s ON a.sample_id = s.id AND a.dataset_id = s.dataset_id "
            "WHERE a.dataset_id = ? AND a.source = ? AND s.split = ?",
            [dataset_id, source, split],
        ).fetchall()
    else:
        gt_rows = cursor.execute(
            "SELECT sample_id, category_name, bbox_x, bbox_y, bbox_w, bbox_h, confidence "
            "FROM annotations WHERE dataset_id = ? AND source = 'ground_truth'",
            [dataset_id],
        ).fetchall()

        pred_rows = cursor.execute(
            "SELECT sample_id, category_name, bbox_x, bbox_y, bbox_w, bbox_h, confidence "
            "FROM annotations WHERE dataset_id = ? AND source = ?",
            [dataset_id, source],
        ).fetchall()

    gt_by_sample: dict[str, list[_BoxRow]] = {}
    for row in gt_rows:
        sid = row[0]
        gt_by_sample.setdefault(sid, []).append(row[1:])

    pred_by_sample: dict[str, list[_BoxRow]] = {}
    for row in pred_rows:
        sid = row[0]
        pred_by_sample.setdefault(sid, []).append(row[1:])

    # Collect all class names from both GT and predictions
    all_cats: set[str] = set()
    for rows in gt_by_sample.values():
        for r in rows:
            all_cats.add(r[0])
    for rows in pred_by_sample.values():
        for r in rows:
            all_cats.add(r[0])

    class_names = sorted(all_cats)
    return gt_by_sample, pred_by_sample, class_names


def _build_detections(
    rows: list[_BoxRow], class_name_to_id: dict[str, int]
) -> sv.Detections:
    """Convert raw annotation rows to a supervision Detections object."""
    if not rows:
        return sv.Detections.empty()

    xyxy = []
    class_ids = []
    confidences = []
    has_confidence = False

    for cat, bx, by, bw, bh, conf in rows:
        # Convert xywh -> xyxy
        xyxy.append([bx, by, bx + bw, by + bh])
        class_ids.append(class_name_to_id.get(cat, 0))
        if conf is not None:
            has_confidence = True
            confidences.append(conf)
        else:
            confidences.append(1.0)

    det = sv.Detections(
        xyxy=np.array(xyxy, dtype=np.float64),
        class_id=np.array(class_ids, dtype=int),
    )
    if has_confidence:
        det.confidence = np.array(confidences, dtype=np.float64)

    return det


def _compute_iou_matrix(
    boxes_a: np.ndarray, boxes_b: np.ndarray
) -> np.ndarray:
    """Vectorized IoU between two sets of xyxy boxes. Returns (M, N) matrix."""
    x1 = np.maximum(boxes_a[:, 0:1], boxes_b[:, 0])
    y1 = np.maximum(boxes_a[:, 1:2], boxes_b[:, 1])
    x2 = np.minimum(boxes_a[:, 2:3], boxes_b[:, 2])
    y2 = np.minimum(boxes_a[:, 3:4], boxes_b[:, 3])

    inter = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)

    area_a = (boxes_a[:, 2] - boxes_a[:, 0]) * (boxes_a[:, 3] - boxes_a[:, 1])
    area_b = (boxes_b[:, 2] - boxes_b[:, 0]) * (boxes_b[:, 3] - boxes_b[:, 1])

    union = area_a[:, None] + area_b[None, :] - inter
    return np.where(union > 0, inter / union, 0.0)


def _interpolated_ap(recall: np.ndarray, precision: np.ndarray) -> float:
    """101-point COCO-style interpolated AP."""
    recall_interp = np.linspace(0, 1, 101)
    # Make precision monotonically decreasing from right
    precision_interp = np.zeros_like(recall_interp)
    for i, r in enumerate(recall_interp):
        precs = precision[recall >= r]
        precision_interp[i] = precs.max() if len(precs) > 0 else 0.0
    return float(precision_interp.mean())


def _compute_pr_curves(
    gt_list: list[sv.Detections],
    pred_list: list[sv.Detections],
    class_names: list[str],
    iou_threshold: float,
) -> list[PRCurve]:
    """Compute PR curves per class and overall, using custom numpy logic."""
    # Collect all predictions with (confidence, is_tp, class_id, sample_idx)
    all_preds: list[tuple[float, bool, int, int]] = []
    gt_counts_per_class: dict[int, int] = {i: 0 for i in range(len(class_names))}

    for sample_idx, (gt, pred) in enumerate(zip(gt_list, pred_list)):
        # Count GT per class
        if len(gt) > 0:
            for cid in gt.class_id:
                gt_counts_per_class[cid] = gt_counts_per_class.get(cid, 0) + 1

        if len(pred) == 0:
            continue

        conf = pred.confidence if pred.confidence is not None else np.ones(len(pred))
        matched_gt: set[tuple[int, int]] = set()  # (sample_idx, gt_box_idx)

        # Sort predictions by confidence descending
        order = np.argsort(-conf)
        for pi in order:
            pred_class = pred.class_id[pi]
            pred_conf = float(conf[pi])

            is_tp = False
            if len(gt) > 0:
                # Find GT boxes of the same class
                gt_mask = gt.class_id == pred_class
                gt_indices = np.where(gt_mask)[0]
                if len(gt_indices) > 0:
                    ious = _compute_iou_matrix(
                        pred.xyxy[pi : pi + 1], gt.xyxy[gt_indices]
                    )[0]
                    best_idx = int(np.argmax(ious))
                    if (
                        ious[best_idx] >= iou_threshold
                        and (sample_idx, int(gt_indices[best_idx]))
                        not in matched_gt
                    ):
                        is_tp = True
                        matched_gt.add((sample_idx, int(gt_indices[best_idx])))

            all_preds.append((pred_conf, is_tp, pred_class, sample_idx))

    # Sort all predictions by confidence descending
    all_preds.sort(key=lambda x: -x[0])

    curves: list[PRCurve] = []

    # Per-class curves
    for class_id, class_name in enumerate(class_names):
        class_preds = [(c, tp) for c, tp, cid, _ in all_preds if cid == class_id]
        n_gt = gt_counts_per_class.get(class_id, 0)
        if n_gt == 0 and len(class_preds) == 0:
            continue

        curve_points, ap = _build_pr_curve(class_preds, n_gt)
        curves.append(PRCurve(class_name=class_name, points=curve_points, ap=ap))

    # Overall "all" curve
    overall_preds = [(c, tp) for c, tp, _, _ in all_preds]
    total_gt = sum(gt_counts_per_class.values())
    if total_gt > 0 or len(overall_preds) > 0:
        overall_points, overall_ap = _build_pr_curve(overall_preds, total_gt)
        curves.insert(
            0, PRCurve(class_name="all", points=overall_points, ap=overall_ap)
        )

    return curves


def _build_pr_curve(
    preds: list[tuple[float, bool]], n_gt: int, max_points: int = 200
) -> tuple[list[PRPoint], float]:
    """Build PR curve points from sorted (confidence, is_tp) pairs."""
    if not preds or n_gt == 0:
        return [PRPoint(recall=0.0, precision=1.0, confidence=1.0)], 0.0

    tp_cumsum = 0
    fp_cumsum = 0
    recalls = []
    precisions = []
    confidences_out = []

    for conf, is_tp in preds:
        if is_tp:
            tp_cumsum += 1
        else:
            fp_cumsum += 1
        r = tp_cumsum / n_gt
        p = tp_cumsum / (tp_cumsum + fp_cumsum)
        recalls.append(r)
        precisions.append(p)
        confidences_out.append(conf)

    recall_arr = np.array(recalls)
    precision_arr = np.array(precisions)
    ap = _interpolated_ap(recall_arr, precision_arr)

    # Subsample to max_points
    n = len(recalls)
    if n > max_points:
        indices = np.linspace(0, n - 1, max_points, dtype=int)
    else:
        indices = np.arange(n)

    points = [
        PRPoint(
            recall=recalls[i],
            precision=precisions[i],
            confidence=confidences_out[i],
        )
        for i in indices
    ]

    return points, ap


def _compute_map(
    gt_list: list[sv.Detections],
    pred_list: list[sv.Detections],
    class_names: list[str],
) -> tuple[APMetrics, dict[str, dict[str, float]]]:
    """Compute mAP@50, mAP@75, mAP@50:95 using the new supervision Metrics API."""
    metric = MAPMetric()
    result = metric.update(pred_list, gt_list).compute()

    map50 = float(result.map50)
    map75 = float(result.map75)
    map50_95 = float(result.map50_95)

    # ap_per_class: shape (num_matched_classes, num_iou_thresholds)
    # iou_thresholds: [0.5, 0.55, 0.6, ..., 0.95] (10 values)
    # matched_classes: array of class_ids that were matched
    # Index 0 = IoU 0.5, index 5 = IoU 0.75
    ap_matrix = result.ap_per_class  # (C, 10)
    matched_cids = result.matched_classes  # array of class_ids

    # Build a class_id -> row index mapping
    cid_to_row: dict[int, int] = {}
    for row_idx, cid in enumerate(matched_cids):
        cid_to_row[int(cid)] = row_idx

    per_class_ap: dict[str, dict[str, float]] = {}
    for class_id, name in enumerate(class_names):
        row = cid_to_row.get(class_id)
        if row is not None:
            ap50_val = float(ap_matrix[row, 0])
            ap75_val = float(ap_matrix[row, 5])
            ap50_95_val = float(np.mean(ap_matrix[row]))
        else:
            ap50_val = 0.0
            ap75_val = 0.0
            ap50_95_val = 0.0

        per_class_ap[name] = {
            "ap50": ap50_val,
            "ap75": ap75_val,
            "ap50_95": ap50_95_val,
        }

    return APMetrics(map50=map50, map75=map75, map50_95=map50_95), per_class_ap


def _compute_confusion_matrix(
    gt_list: list[sv.Detections],
    pred_list: list[sv.Detections],
    class_names: list[str],
    conf_threshold: float,
    iou_threshold: float,
) -> tuple[list[list[int]], list[str]]:
    """Compute confusion matrix using supervision."""
    # Filter predictions by confidence threshold
    filtered_preds = []
    for det in pred_list:
        if len(det) == 0:
            filtered_preds.append(det)
            continue
        if det.confidence is not None:
            mask = det.confidence >= conf_threshold
            filtered_preds.append(det[mask])
        else:
            filtered_preds.append(det)

    n_classes = len(class_names)
    cm_result = sv.ConfusionMatrix.from_detections(
        predictions=filtered_preds,
        targets=gt_list,
        classes=class_names,
        iou_threshold=iou_threshold,
    )

    matrix = cm_result.matrix.astype(int).tolist()
    # Labels include class names + "background" for the last row/col
    labels = class_names + ["background"]

    return matrix, labels


def _empty_response(
    iou_threshold: float, conf_threshold: float
) -> EvaluationResponse:
    """Return an empty evaluation response when no data is available."""
    return EvaluationResponse(
        pr_curves=[],
        ap_metrics=APMetrics(map50=0.0, map75=0.0, map50_95=0.0),
        per_class_metrics=[],
        confusion_matrix=[],
        confusion_matrix_labels=[],
        iou_threshold=iou_threshold,
        conf_threshold=conf_threshold,
    )
