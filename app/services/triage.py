"""Triage scoring service.

Computes a composite "worst images" score from per-sample error counts
and confidence spread, using the existing error analysis pipeline.

Score formula: 0.6 * norm_errors + 0.4 * norm_confidence_spread
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np
from duckdb import DuckDBPyConnection

from app.models.triage import TriageScore
from app.services.error_analysis import categorize_errors


def compute_worst_images(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str,
    iou_threshold: float,
    conf_threshold: float,
    split: str | None = None,
    limit: int = 50,
) -> list[TriageScore]:
    """Rank samples by composite error score (worst first).

    1. Run categorize_errors to get per-detection error breakdown.
    2. Aggregate per-sample: count non-TP detections, collect confidences.
    3. Compute confidence_spread = std(confidences) per sample.
    4. Normalize and combine: 0.6 * norm_errors + 0.4 * norm_spread.
    5. Return top `limit` samples sorted by score descending.
    """
    result = categorize_errors(
        cursor, dataset_id, source, iou_threshold, conf_threshold, split=split
    )

    # Aggregate per-sample error counts and confidence values
    # from non-TP error types: hard_fp, label_error, false_negative
    sample_errors: dict[str, int] = defaultdict(int)
    sample_confidences: dict[str, list[float]] = defaultdict(list)

    for error_type in ("hard_fp", "label_error", "false_negative"):
        for sample in result.samples_by_type.get(error_type, []):
            sample_errors[sample.sample_id] += 1
            if sample.confidence is not None:
                sample_confidences[sample.sample_id].append(sample.confidence)

    if not sample_errors:
        return []

    # Compute confidence spread per sample
    sample_spread: dict[str, float] = {}
    for sid, confs in sample_confidences.items():
        if len(confs) >= 2:
            sample_spread[sid] = float(np.std(confs))
        else:
            sample_spread[sid] = 0.0

    # Find max values for normalization
    max_errors = max(sample_errors.values()) or 1
    max_spread = max(sample_spread.values()) if sample_spread else 1.0
    if max_spread == 0.0:
        max_spread = 1.0

    # Compute composite score per sample
    scored: list[TriageScore] = []
    for sid, err_count in sample_errors.items():
        spread = sample_spread.get(sid, 0.0)
        norm_errors = err_count / max_errors
        norm_spread = spread / max_spread
        score = 0.6 * norm_errors + 0.4 * norm_spread

        scored.append(
            TriageScore(
                sample_id=sid,
                error_count=err_count,
                confidence_spread=round(spread, 4),
                score=round(score, 4),
            )
        )

    # Sort descending by score, return top `limit`
    scored.sort(key=lambda s: -s.score)
    return scored[:limit]
