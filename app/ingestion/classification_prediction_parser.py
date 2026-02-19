"""Streaming Classification JSONL prediction parser.

Parses JSONL files where each line maps an image filename to a
predicted classification label with confidence score.  Uses sentinel
bbox values (all zeros) since classification has no spatial localisation.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterator
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# Flexible key lookup order for the image filename field.
_FILENAME_KEYS = ("filename", "file_name", "image", "path")

# Flexible key lookup order for the predicted label field.
_LABEL_KEYS = (
    "label",
    "class",
    "category",
    "class_name",
    "predicted_label",
    "prediction",
)

# Flexible key lookup order for the confidence/score field.
_CONFIDENCE_KEYS = ("confidence", "score", "probability", "prob")


def _get_field(
    record: dict, keys: tuple[str, ...], default: str | float | None = None
) -> str | float | None:
    """Return the first matching key's value from *record*."""
    for k in keys:
        if k in record:
            return record[k]
    return default


class ClassificationPredictionParser:
    """Stream-parse classification JSONL predictions and yield annotation DataFrames.

    Each line of the JSONL file is a JSON object with at minimum a
    filename field, a label field, and an optional confidence field.
    """

    def __init__(self, batch_size: int = 5000) -> None:
        self.batch_size = batch_size

    def parse_streaming(
        self,
        file_path: Path,
        sample_lookup: dict[str, str],
        dataset_id: str,
        source: str = "prediction",
        batch_size: int | None = None,
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of prediction rows matching the annotations schema.

        Parameters
        ----------
        file_path:
            Path to a classification JSONL predictions file.
        sample_lookup:
            Mapping of ``filename`` -> ``sample_id`` built from the samples table.
        dataset_id:
            The dataset these predictions belong to.
        source:
            The run name / source label for these predictions.
        batch_size:
            Override instance batch_size if provided.

        Yields
        ------
        pd.DataFrame
            Batches with columns matching the annotations table:
            ``id, dataset_id, sample_id, category_name, bbox_x, bbox_y,
            bbox_w, bbox_h, area, is_crowd, source, confidence, metadata``.
        """
        effective_batch_size = batch_size or self.batch_size
        batch: list[dict] = []
        skipped = 0

        with open(file_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                filename = _get_field(record, _FILENAME_KEYS)
                if filename is None:
                    skipped += 1
                    continue

                sample_id = sample_lookup.get(str(filename))
                if sample_id is None:
                    skipped += 1
                    continue

                label = _get_field(record, _LABEL_KEYS)
                if label is None:
                    skipped += 1
                    continue

                confidence = _get_field(record, _CONFIDENCE_KEYS)
                try:
                    confidence = float(confidence) if confidence is not None else None
                except (ValueError, TypeError):
                    confidence = None

                batch.append(
                    {
                        "id": str(uuid.uuid4()),
                        "dataset_id": dataset_id,
                        "sample_id": sample_id,
                        "category_name": str(label),
                        "bbox_x": 0.0,
                        "bbox_y": 0.0,
                        "bbox_w": 0.0,
                        "bbox_h": 0.0,
                        "area": 0.0,
                        "is_crowd": False,
                        "source": source,
                        "confidence": confidence,
                        "metadata": None,
                    }
                )

                if len(batch) >= effective_batch_size:
                    yield pd.DataFrame(batch)
                    batch = []

        if batch:
            yield pd.DataFrame(batch)

        if skipped > 0:
            logger.info(
                "Classification prediction import: skipped %d lines "
                "(no filename, no sample match, or no label)",
                skipped,
            )
