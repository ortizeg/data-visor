"""DetectionAnnotation format parser for prediction import.

Parses a directory of per-image JSON files where each file is a
self-contained DetectionAnnotation:

    {
        "filename": "image.jpg",
        "categories": {0: "ball", 1: "player", ...},
        "annotations": [
            {"bbox": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
             "confidence": 0.95, "class_id": 1},
            ...
        ]
    }

Bounding boxes are normalised to [0, 1] and converted to absolute pixel
coordinates using image dimensions from the samples table.  Yields DataFrame
batches ready for bulk insert into the annotations table with
``source='prediction'``.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterator
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)


class DetectionAnnotationParser:
    """Parse a directory of DetectionAnnotation JSON files into annotation rows.

    Parameters
    ----------
    batch_size:
        Number of annotation rows to accumulate before yielding a DataFrame.
    """

    def __init__(self, batch_size: int = 5000) -> None:
        self.batch_size = batch_size

    def parse_directory(
        self,
        dir_path: Path,
        sample_lookup: dict[str, tuple[str, int, int]],
        dataset_id: str,
        source: str = "prediction",
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of prediction rows matching the annotations schema.

        Parameters
        ----------
        dir_path:
            Directory containing per-image ``*.json`` DetectionAnnotation files.
        sample_lookup:
            Mapping of ``filename`` -> ``(sample_id, width, height)`` built
            from the samples table.  Used for matching and coordinate conversion.
        dataset_id:
            The dataset these predictions belong to.

        Yields
        ------
        pd.DataFrame
            Batches with columns matching the annotations table.
        """
        batch: list[dict] = []
        skipped_files = 0
        skipped_no_sample = 0
        total_annotations = 0

        json_files = sorted(dir_path.glob("*.json"))
        if not json_files:
            logger.warning("No JSON files found in %s", dir_path)
            return

        for json_path in json_files:
            try:
                data = json.loads(json_path.read_bytes())
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Skipping unreadable file %s: %s", json_path.name, exc)
                skipped_files += 1
                continue

            filename = data.get("filename", "")
            categories: dict = data.get("categories", {})
            annotations: list = data.get("annotations", [])

            # Look up sample by filename
            lookup = sample_lookup.get(filename)
            if lookup is None:
                skipped_no_sample += 1
                if skipped_no_sample <= 10:
                    logger.warning(
                        "No matching sample for filename=%s, skipping %d predictions",
                        filename,
                        len(annotations),
                    )
                elif skipped_no_sample == 11:
                    logger.warning("Suppressing further unmatched filename warnings...")
                continue

            sample_id, img_width, img_height = lookup

            for ann in annotations:
                bbox = ann.get("bbox", {})
                norm_x = float(bbox.get("x", 0))
                norm_y = float(bbox.get("y", 0))
                norm_w = float(bbox.get("w", 0))
                norm_h = float(bbox.get("h", 0))

                # Convert normalised [0,1] to absolute pixel coordinates
                abs_x = norm_x * img_width
                abs_y = norm_y * img_height
                abs_w = norm_w * img_width
                abs_h = norm_h * img_height

                class_id = ann.get("class_id", -1)
                # categories keys may be int or str depending on JSON parsing
                category_name = categories.get(class_id) or categories.get(str(class_id), f"class_{class_id}")

                batch.append(
                    {
                        "id": str(uuid.uuid4()),
                        "dataset_id": dataset_id,
                        "sample_id": sample_id,
                        "category_name": category_name,
                        "bbox_x": abs_x,
                        "bbox_y": abs_y,
                        "bbox_w": abs_w,
                        "bbox_h": abs_h,
                        "area": abs_w * abs_h,
                        "is_crowd": False,
                        "source": source,
                        "confidence": float(ann.get("confidence", 0.0)),
                        "metadata": None,
                    }
                )
                total_annotations += 1

                if len(batch) >= self.batch_size:
                    yield pd.DataFrame(batch)
                    batch = []

        if batch:
            yield pd.DataFrame(batch)

        logger.info(
            "DetectionAnnotation import: %d files processed, %d annotations, "
            "%d files skipped (unreadable), %d files skipped (no matching sample)",
            len(json_files) - skipped_files - skipped_no_sample,
            total_annotations,
            skipped_files,
            skipped_no_sample,
        )
