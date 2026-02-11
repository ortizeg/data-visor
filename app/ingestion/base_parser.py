"""Abstract base parser interface for format-agnostic dataset ingestion."""

from abc import ABC, abstractmethod
from collections.abc import Iterator
from pathlib import Path

import pandas as pd


class BaseParser(ABC):
    """Extension point for dataset format parsers (COCO, YOLO, VOC, ...).

    Subclasses implement streaming parse methods that yield pandas
    DataFrames in configurable batches -- ready for DuckDB bulk insert
    via ``INSERT INTO table SELECT * FROM df``.
    """

    def __init__(self, batch_size: int = 1000) -> None:
        self.batch_size = batch_size

    @property
    @abstractmethod
    def format_name(self) -> str:
        """Short identifier for the format, e.g. ``'coco'``, ``'yolo'``."""
        ...

    @abstractmethod
    def parse_categories(self, file_path: Path) -> dict[int, str]:
        """Return a mapping of category-id to category-name.

        Should handle missing category information gracefully (return
        empty dict rather than raising).
        """
        ...

    @abstractmethod
    def build_image_batches(
        self, file_path: Path, dataset_id: str
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of image/sample records in batches.

        Column order **must** match the ``samples`` DuckDB table:
        ``id, dataset_id, file_name, width, height, thumbnail_path,
        split, metadata``.
        """
        ...

    @abstractmethod
    def build_annotation_batches(
        self,
        file_path: Path,
        dataset_id: str,
        categories: dict[int, str],
    ) -> Iterator[pd.DataFrame]:
        """Yield DataFrames of annotation records in batches.

        Column order **must** match the ``annotations`` DuckDB table:
        ``id, dataset_id, sample_id, category_name, bbox_x, bbox_y,
        bbox_w, bbox_h, area, is_crowd, source, confidence, metadata``.
        """
        ...
