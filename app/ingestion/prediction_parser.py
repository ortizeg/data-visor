"""Streaming COCO detection results parser for prediction import.

Parses a flat COCO results JSON array (list of prediction dicts) using
ijson in binary mode -- the same streaming pattern as coco_parser.py.
Yields DataFrame batches ready for bulk insert into the annotations table
with ``source='prediction'``.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator
from pathlib import Path

import ijson
import pandas as pd

logger = logging.getLogger(__name__)


class PredictionParser:
    """Stream-parse COCO detection results and yield annotation DataFrames.

    Each prediction dict is expected to have:
    ``image_id``, ``category_id``, ``bbox`` (4-element list), ``score``.
    """

    def __init__(self, batch_size: int = 5000) -> None:
        self.batch_size = batch_size

    def parse_streaming(
        self,
        file_path: Path,
        category_map: dict[int, str],
        dataset_id: str,
        batch_size: int | None = None,
        source: str = "prediction",
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of prediction rows matching the annotations schema.

        Parameters
        ----------
        file_path:
            Path to a COCO detection results JSON file (flat array).
        category_map:
            Mapping of ``category_id`` -> ``category_name`` from the dataset's
            categories table.
        dataset_id:
            The dataset these predictions belong to.
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

        with open(file_path, "rb") as f:
            for pred in ijson.items(f, "item", use_float=True):
                cat_id = pred.get("category_id")
                category_name = category_map.get(cat_id) if cat_id is not None else None

                if category_name is None:
                    skipped += 1
                    if skipped <= 10:
                        logger.warning(
                            "Skipping prediction with unmapped category_id=%s "
                            "(image_id=%s)",
                            cat_id,
                            pred.get("image_id"),
                        )
                    elif skipped == 11:
                        logger.warning(
                            "Suppressing further unmapped category warnings..."
                        )
                    continue

                bbox = pred.get("bbox", [0, 0, 0, 0])
                if len(bbox) < 4:
                    bbox = [0, 0, 0, 0]

                bbox_x = float(bbox[0])
                bbox_y = float(bbox[1])
                bbox_w = float(bbox[2])
                bbox_h = float(bbox[3])

                batch.append(
                    {
                        "id": str(uuid.uuid4()),
                        "dataset_id": dataset_id,
                        "sample_id": str(int(pred["image_id"])),
                        "category_name": category_name,
                        "bbox_x": bbox_x,
                        "bbox_y": bbox_y,
                        "bbox_w": bbox_w,
                        "bbox_h": bbox_h,
                        "area": bbox_w * bbox_h,
                        "is_crowd": False,
                        "source": source,
                        "confidence": float(pred["score"]),
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
                "Prediction import: skipped %d predictions with unmapped categories",
                skipped,
            )
