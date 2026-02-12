"""Streaming COCO JSON parser using ijson with DataFrame batch output.

Always opens files in **binary mode** (``"rb"``) because ijson's
``yajl2_c`` backend operates on raw bytes.  Uses ``use_float=True`` to
avoid ``Decimal`` overhead for coordinate values.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path

import ijson
import pandas as pd

from app.ingestion.base_parser import BaseParser

logger = logging.getLogger(__name__)


class COCOParser(BaseParser):
    """Streaming parser for the COCO annotation format.

    Yields :class:`pandas.DataFrame` batches whose column order matches the
    DuckDB ``samples`` and ``annotations`` tables -- ready for
    ``INSERT INTO table SELECT * FROM df``.
    """

    @property
    def format_name(self) -> str:  # noqa: D401
        """Format identifier."""
        return "coco"

    # ------------------------------------------------------------------
    # Low-level streaming helpers
    # ------------------------------------------------------------------

    def parse_categories(self, file_path: Path) -> dict[int, str]:
        """Extract ``{category_id: category_name}`` from the COCO file.

        Returns an empty dict if the ``categories`` key is missing (e.g.
        a malformed file) rather than raising.
        """
        categories: dict[int, str] = {}
        try:
            with open(file_path, "rb") as f:
                for cat in ijson.items(f, "categories.item"):
                    categories[cat["id"]] = cat["name"]
        except (ijson.IncompleteJSONError, KeyError):
            logger.warning("Could not parse categories from %s", file_path)
        return categories

    def parse_images_streaming(self, file_path: Path) -> Iterator[dict]:
        """Yield raw image dicts one at a time from the COCO file."""
        with open(file_path, "rb") as f:
            yield from ijson.items(f, "images.item", use_float=True)

    def parse_annotations_streaming(self, file_path: Path) -> Iterator[dict]:
        """Yield raw annotation dicts one at a time from the COCO file."""
        with open(file_path, "rb") as f:
            yield from ijson.items(f, "annotations.item", use_float=True)

    # ------------------------------------------------------------------
    # DataFrame batch builders (column order matches DuckDB schema)
    # ------------------------------------------------------------------

    def build_image_batches(
        self, file_path: Path, dataset_id: str, split: str | None = None
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of image/sample records.

        Column order: ``id, dataset_id, file_name, width, height,
        thumbnail_path, split, metadata``  (matches ``samples`` table).
        """
        batch: list[dict] = []
        for image in self.parse_images_streaming(file_path):
            width = image.get("width", 0)
            height = image.get("height", 0)
            if width == 0 or height == 0:
                logger.warning(
                    "Image %s missing width/height, defaulting to 0",
                    image.get("id"),
                )
            batch.append(
                {
                    "id": str(image["id"]),
                    "dataset_id": dataset_id,
                    "file_name": image["file_name"],
                    "width": int(width),
                    "height": int(height),
                    "thumbnail_path": None,
                    "split": split,
                    "metadata": None,
                }
            )
            if len(batch) >= self.batch_size:
                yield pd.DataFrame(batch)
                batch = []
        if batch:
            yield pd.DataFrame(batch)

    def build_annotation_batches(
        self,
        file_path: Path,
        dataset_id: str,
        categories: dict[int, str],
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of annotation records.

        Column order: ``id, dataset_id, sample_id, category_name, bbox_x,
        bbox_y, bbox_w, bbox_h, area, is_crowd, source, confidence,
        metadata``  (matches ``annotations`` table).
        """
        batch: list[dict] = []
        for ann in self.parse_annotations_streaming(file_path):
            bbox = ann.get("bbox", [0, 0, 0, 0])
            if len(bbox) < 4:
                bbox = [0, 0, 0, 0]
            cat_id = ann.get("category_id")
            category_name = categories.get(cat_id, "unknown") if cat_id is not None else "unknown"
            batch.append(
                {
                    "id": str(ann["id"]),
                    "dataset_id": dataset_id,
                    "sample_id": str(ann["image_id"]),
                    "category_name": category_name,
                    "bbox_x": float(bbox[0]),
                    "bbox_y": float(bbox[1]),
                    "bbox_w": float(bbox[2]),
                    "bbox_h": float(bbox[3]),
                    "area": float(ann.get("area", 0.0)),
                    "is_crowd": bool(ann.get("iscrowd", 0)),
                    "source": "ground_truth",
                    "confidence": None,
                    "metadata": None,
                }
            )
            if len(batch) >= self.batch_size:
                yield pd.DataFrame(batch)
                batch = []
        if batch:
            yield pd.DataFrame(batch)
