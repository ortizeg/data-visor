"""Ingestion orchestration service with streaming progress.

Coordinates COCO parsing, DuckDB bulk inserts, thumbnail generation,
and plugin hooks.  Exposed to the API layer as an SSE-compatible
synchronous generator via :meth:`ingest_with_progress`.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from app.ingestion.coco_parser import COCOParser
from app.plugins.base_plugin import PluginContext
from app.plugins.hooks import HOOK_INGEST_COMPLETE, HOOK_INGEST_START
from app.plugins.registry import PluginRegistry
from app.repositories.duckdb_repo import DuckDBRepo
from app.repositories.storage import StorageBackend
from app.services.image_service import ImageService

logger = logging.getLogger(__name__)


@dataclass
class IngestionProgress:
    """Progress update emitted during dataset ingestion.

    *stage* is one of ``"categories"``, ``"parsing_images"``,
    ``"parsing_annotations"``, ``"thumbnails"``, ``"complete"``.
    *total* may be ``None`` when the total is not yet known (streaming).
    """

    stage: str
    current: int
    total: int | None
    message: str


class IngestionService:
    """Orchestrates streaming parse -> bulk insert -> thumbnails -> plugins.

    All four collaborators are injected:

    * *db* -- DuckDB repository for schema access and bulk inserts.
    * *storage* -- fsspec-based storage for resolving image paths.
    * *image_service* -- thumbnail generation and disk cache.
    * *plugin_registry* -- hook dispatch for ingestion lifecycle events.
    """

    def __init__(
        self,
        db: DuckDBRepo,
        storage: StorageBackend,
        image_service: ImageService,
        plugin_registry: PluginRegistry,
    ) -> None:
        self.db = db
        self.storage = storage
        self.image_service = image_service
        self.plugins = plugin_registry

    # ------------------------------------------------------------------
    # Single-split ingestion
    # ------------------------------------------------------------------

    def ingest_with_progress(
        self,
        annotation_path: str,
        image_dir: str,
        dataset_name: str | None = None,
        format: str = "coco",
        split: str | None = None,
        dataset_id: str | None = None,
    ) -> Iterator[IngestionProgress]:
        """Ingest a COCO dataset, yielding progress events.

        This is a **synchronous** generator -- FastAPI wraps it in a
        :class:`StreamingResponse` for SSE delivery.

        Parameters
        ----------
        split:
            Optional split name (``"train"``, ``"val"``, ``"test"``) to
            populate the ``samples.split`` column.
        dataset_id:
            Optional pre-generated dataset ID.  When ``None`` a new UUID
            is created.  Pass the same ID across multiple calls to
            import several splits into one dataset.

        Steps:
        1. Parse categories.
        2. Stream and insert image batches.
        3. Stream and insert annotation batches.
        4. Insert or update the dataset record and category records.
        5. Generate thumbnails for the first 500 images.
        6. Fire plugin hooks.
        7. Yield final ``complete`` event.
        """
        dataset_id = dataset_id or str(uuid.uuid4())
        name = dataset_name or Path(annotation_path).stem
        context = PluginContext(dataset_id=dataset_id)

        # -- Plugin: on_ingest_start ----------------------------------------
        self.plugins.trigger_hook(HOOK_INGEST_START, context=context)

        # -- Step 1: Parse categories ----------------------------------------
        parser = COCOParser(batch_size=1000)
        categories = parser.parse_categories(Path(annotation_path))

        yield IngestionProgress(
            stage="categories",
            current=len(categories),
            total=len(categories),
            message=f"Loaded {len(categories)} categories",
        )

        # -- Step 2: Stream and insert images --------------------------------
        cursor = self.db.connection.cursor()
        image_count = 0
        ann_count = 0

        try:
            for batch_df in parser.build_image_batches(
                Path(annotation_path), dataset_id, split=split
            ):
                cursor.execute(
                    "INSERT INTO samples "
                    "(id, dataset_id, file_name, width, height, "
                    "thumbnail_path, split, metadata) "
                    "SELECT * FROM batch_df"
                )
                image_count += len(batch_df)
                yield IngestionProgress(
                    stage="parsing_images",
                    current=image_count,
                    total=None,
                    message=f"Parsed {image_count} images",
                )

            # -- Step 3: Stream and insert annotations -----------------------
            for batch_df in parser.build_annotation_batches(
                Path(annotation_path), dataset_id, categories, split=split
            ):
                cursor.execute(
                    "INSERT INTO annotations SELECT * FROM batch_df"
                )
                ann_count += len(batch_df)
                yield IngestionProgress(
                    stage="parsing_annotations",
                    current=ann_count,
                    total=None,
                    message=f"Parsed {ann_count} annotations",
                )

            # -- Step 4: Insert or update dataset record ---------------------
            existing = cursor.execute(
                "SELECT id FROM datasets WHERE id = ?", [dataset_id]
            ).fetchone()

            if existing is None:
                cursor.execute(
                    "INSERT INTO datasets VALUES "
                    "(?, ?, ?, ?, ?, ?, ?, ?, 0, current_timestamp, NULL)",
                    [
                        dataset_id,
                        name,
                        format,
                        annotation_path,
                        image_dir,
                        image_count,
                        ann_count,
                        len(categories),
                    ],
                )
            else:
                # Accumulate counts for subsequent splits.
                cursor.execute(
                    "UPDATE datasets SET "
                    "image_count = image_count + ?, "
                    "annotation_count = annotation_count + ?, "
                    "category_count = GREATEST(category_count, ?) "
                    "WHERE id = ?",
                    [image_count, ann_count, len(categories), dataset_id],
                )

            # -- Insert category records (skip duplicates) -------------------
            if categories:
                cat_records = [
                    {
                        "dataset_id": dataset_id,
                        "category_id": cid,
                        "name": cname,
                        "supercategory": None,
                    }
                    for cid, cname in categories.items()
                ]
                cat_df = pd.DataFrame(cat_records)
                if existing is None:
                    cursor.execute(
                        "INSERT INTO categories SELECT * FROM cat_df"
                    )
                else:
                    # For subsequent splits, only insert categories that
                    # don't already exist for this dataset.
                    cursor.execute(
                        "INSERT INTO categories "
                        "SELECT * FROM cat_df "
                        "WHERE (dataset_id, category_id) NOT IN "
                        "(SELECT dataset_id, category_id FROM categories "
                        " WHERE dataset_id = ?)",
                        [dataset_id],
                    )

        finally:
            cursor.close()

        # -- Step 5: Generate thumbnails for first batch --------------------
        thumb_limit = min(500, image_count)
        if thumb_limit > 0:
            thumb_cursor = self.db.connection.cursor()
            try:
                rows = thumb_cursor.execute(
                    "SELECT id, file_name FROM samples "
                    "WHERE dataset_id = ? AND thumbnail_path IS NULL "
                    "LIMIT ?",
                    [dataset_id, thumb_limit],
                ).fetchall()
            finally:
                thumb_cursor.close()

            samples_for_thumbs = [
                {
                    "id": row[0],
                    "image_path": self.storage.resolve_image_path(
                        image_dir, row[1]
                    ),
                }
                for row in rows
            ]

            generated, errors = self.image_service.generate_thumbnails_batch(
                samples_for_thumbs, "medium"
            )

            yield IngestionProgress(
                stage="thumbnails",
                current=generated,
                total=thumb_limit,
                message=(
                    f"Generated {generated} thumbnails"
                    f" ({errors} errors)"
                ),
            )
        else:
            yield IngestionProgress(
                stage="thumbnails",
                current=0,
                total=0,
                message="No images to generate thumbnails for",
            )

        # -- Step 6: Plugin: on_ingest_complete -----------------------------
        self.plugins.trigger_hook(
            HOOK_INGEST_COMPLETE,
            context=context,
            stats={
                "images": image_count,
                "annotations": ann_count,
                "categories": len(categories),
            },
        )

        # -- Step 7: Final progress event -----------------------------------
        yield IngestionProgress(
            stage="complete",
            current=image_count,
            total=image_count,
            message=(
                f"Ingestion complete: {image_count} images, "
                f"{ann_count} annotations"
            ),
        )

    # ------------------------------------------------------------------
    # Multi-split ingestion
    # ------------------------------------------------------------------

    def ingest_splits_with_progress(
        self,
        splits: list,
        dataset_name: str,
    ) -> Iterator[IngestionProgress]:
        """Ingest multiple splits as a single dataset, yielding per-split progress.

        Parameters
        ----------
        splits:
            List of objects with ``name``, ``annotation_path``, and
            ``image_dir`` attributes (e.g. :class:`ImportSplit` instances).
        dataset_name:
            Name for the combined dataset.
        """
        dataset_id = str(uuid.uuid4())

        for i, split_config in enumerate(splits):
            yield IngestionProgress(
                stage="split_start",
                current=i + 1,
                total=len(splits),
                message=f"Starting split: {split_config.name} ({i + 1}/{len(splits)})",
            )

            yield from self.ingest_with_progress(
                annotation_path=split_config.annotation_path,
                image_dir=split_config.image_dir,
                dataset_name=dataset_name,
                split=split_config.name,
                dataset_id=dataset_id,
            )
