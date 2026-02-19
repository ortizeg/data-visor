"""Streaming Classification JSONL parser with DataFrame batch output.

Parses JSONL files where each line maps an image filename to a
classification label.  Supports flexible key names for both the
filename and label fields.

Classification annotations use sentinel bbox values (all zeros)
since there is no spatial localisation.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from pathlib import Path

import pandas as pd

from app.ingestion.base_parser import BaseParser

logger = logging.getLogger(__name__)

# Flexible key lookup order for the image filename field.
_FILENAME_KEYS = ("filename", "file_name", "image", "path")

# Flexible key lookup order for the label field.
_LABEL_KEYS = ("label", "class", "category", "class_name")


def _get_field(record: dict, keys: tuple[str, ...], default: str | None = None) -> str | None:
    """Return the first matching key's value from *record*."""
    for k in keys:
        if k in record:
            return record[k]
    return default


class ClassificationJSONLParser(BaseParser):
    """Streaming parser for classification JSONL datasets.

    Each line of the JSONL file is a JSON object with at minimum a
    filename field and a label field.  The parser produces annotations
    with sentinel bbox values (``0.0``) since classification has no
    spatial localisation.
    """

    @property
    def format_name(self) -> str:  # noqa: D401
        """Format identifier."""
        return "classification_jsonl"

    # ------------------------------------------------------------------
    # Category extraction
    # ------------------------------------------------------------------

    def parse_categories(self, file_path: Path) -> dict[int, str]:
        """Single pass over JSONL to collect unique sorted labels."""
        labels: set[str] = set()
        try:
            with open(file_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    raw_label = _get_field(record, _LABEL_KEYS)
                    if raw_label is None:
                        labels.add("unknown")
                    elif isinstance(raw_label, list):
                        for lbl in raw_label:
                            labels.add(str(lbl))
                    else:
                        labels.add(str(raw_label))
        except OSError:
            logger.warning("Could not read categories from %s", file_path)
        return {i: name for i, name in enumerate(sorted(labels))}

    # ------------------------------------------------------------------
    # Image batch builder
    # ------------------------------------------------------------------

    def build_image_batches(
        self,
        file_path: Path,
        dataset_id: str,
        split: str | None = None,
        image_dir: str = "",
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of image/sample records in batches.

        Column order matches the ``samples`` DuckDB table:
        ``id, dataset_id, file_name, width, height, thumbnail_path,
        split, metadata, image_dir``.

        Width and height default to ``0`` -- resolved during thumbnail
        generation.
        """
        batch: list[dict] = []
        with open(file_path, encoding="utf-8") as f:
            idx = 0
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
                    logger.warning("Skipping line %d: no filename field", idx)
                    idx += 1
                    continue

                sample_id = f"{split}_{idx}" if split else str(idx)
                batch.append(
                    {
                        "id": sample_id,
                        "dataset_id": dataset_id,
                        "file_name": str(filename),
                        "width": 0,
                        "height": 0,
                        "thumbnail_path": None,
                        "split": split,
                        "metadata": None,
                        "image_dir": image_dir,
                    }
                )
                idx += 1

                if len(batch) >= self.batch_size:
                    yield pd.DataFrame(batch)
                    batch = []

        if batch:
            yield pd.DataFrame(batch)

    # ------------------------------------------------------------------
    # Annotation batch builder
    # ------------------------------------------------------------------

    def build_annotation_batches(
        self,
        file_path: Path,
        dataset_id: str,
        categories: dict[int, str],
        split: str | None = None,
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of annotation records with sentinel bbox values.

        Column order matches the ``annotations`` DuckDB table:
        ``id, dataset_id, sample_id, category_name, bbox_x, bbox_y,
        bbox_w, bbox_h, area, is_crowd, source, confidence, metadata``.

        If a label is a list (multi-label), one annotation row is
        emitted per label for the same sample.
        """
        batch: list[dict] = []
        ann_counter = 0
        with open(file_path, encoding="utf-8") as f:
            idx = 0
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # Skip lines without a filename (same logic as build_image_batches)
                filename = _get_field(record, _FILENAME_KEYS)
                if filename is None:
                    idx += 1
                    continue

                sample_id = f"{split}_{idx}" if split else str(idx)
                raw_label = _get_field(record, _LABEL_KEYS)

                if raw_label is None:
                    labels = ["unknown"]
                elif isinstance(raw_label, list):
                    labels = [str(lbl) for lbl in raw_label]
                else:
                    labels = [str(raw_label)]

                for lbl in labels:
                    ann_id = f"{split}_ann_{ann_counter}" if split else f"ann_{ann_counter}"
                    batch.append(
                        {
                            "id": ann_id,
                            "dataset_id": dataset_id,
                            "sample_id": sample_id,
                            "category_name": lbl,
                            "bbox_x": 0.0,
                            "bbox_y": 0.0,
                            "bbox_w": 0.0,
                            "bbox_h": 0.0,
                            "area": 0.0,
                            "is_crowd": False,
                            "source": "ground_truth",
                            "confidence": None,
                            "metadata": None,
                        }
                    )
                    ann_counter += 1

                idx += 1

                if len(batch) >= self.batch_size:
                    yield pd.DataFrame(batch)
                    batch = []

        if batch:
            yield pd.DataFrame(batch)
