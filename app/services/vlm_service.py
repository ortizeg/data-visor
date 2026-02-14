"""VLM (Vision-Language Model) auto-tagging service using Moondream2.

Part of DataVisor's intelligence layer. Loads Moondream2 on-demand (not at
startup) via the transformers library to avoid memory pressure when
coexisting with DINOv2.  Processes images in batches with encode-once
optimization, validates tags against a controlled vocabulary, and merges
results into the existing samples.tags column in DuckDB.
"""

from __future__ import annotations

import logging
import traceback
from io import BytesIO

import torch
from PIL import Image
from pydantic import BaseModel
from transformers import AutoModelForCausalLM
from transformers.dynamic_module_utils import get_class_from_dynamic_module

from app.repositories.duckdb_repo import DuckDBRepo
from app.repositories.storage import StorageBackend

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Controlled vocabulary: prompts and valid responses per dimension
# ---------------------------------------------------------------------------

TAG_PROMPTS: dict[str, str] = {
    "lighting": "Describe the lighting: is this image dark, dim, bright, or normal? One word only.",
    "clarity": "Is this image blurry, sharp, or noisy? One word only.",
    "setting": "Is this scene indoor or outdoor? One word only.",
    "weather": "What weather or time: sunny, cloudy, rainy, foggy, snowy, night, or day? One word.",
    "density": "How crowded is this scene: empty, sparse, moderate, or crowded? One word only.",
}

VALID_TAGS: dict[str, set[str]] = {
    "lighting": {"dark", "dim", "bright", "normal"},
    "clarity": {"blurry", "sharp", "noisy"},
    "setting": {"indoor", "outdoor"},
    "weather": {"sunny", "cloudy", "rainy", "foggy", "snowy", "night", "day"},
    "density": {"empty", "sparse", "moderate", "crowded"},
}


class TaggingProgress(BaseModel):
    """Progress update for VLM auto-tagging (used in SSE streaming)."""

    status: str = "idle"
    processed: int = 0
    total: int = 0
    message: str = ""


class VLMService:
    """Manages Moondream2 model lifecycle and batch auto-tagging.

    The model is loaded on-demand via :meth:`load_model` the first time
    tagging is requested.  This avoids competing with DINOv2 for GPU
    memory at startup (Pitfall 6 from research).

    Tags are validated against :data:`VALID_TAGS` and only valid tags
    are stored.  Invalid VLM responses are silently discarded.
    """

    def __init__(
        self,
        db: DuckDBRepo,
        storage: StorageBackend,
        device: str = "cpu",
    ) -> None:
        self.db = db
        self.storage = storage
        self._device = device
        self._model: AutoModelForCausalLM | None = None
        self._tasks: dict[str, TaggingProgress] = {}

    def load_model(self) -> None:
        """Load Moondream2 via transformers (on-demand, not at startup).

        Uses ``trust_remote_code=True`` as required by Moondream2's
        custom architecture.  Patches ``all_tied_weights_keys`` for
        compatibility with transformers 5.x.
        """
        logger.info("Loading Moondream2 VLM on device: %s", self._device)

        # Moondream2's HfMoondream class lacks `all_tied_weights_keys`
        # required by transformers 5.x — patch it before from_pretrained.
        cls = get_class_from_dynamic_module(
            "hf_moondream.HfMoondream",
            "vikhyatk/moondream2",
            revision="2025-01-09",
        )
        if not hasattr(cls, "all_tied_weights_keys"):
            cls.all_tied_weights_keys = {}

        self._model = AutoModelForCausalLM.from_pretrained(
            "vikhyatk/moondream2",
            revision="2025-01-09",
            trust_remote_code=True,
            device_map={"": self._device},
        )
        logger.info("Moondream2 loaded on %s", self._device)

    def _ensure_model(self) -> None:
        """Load the model lazily if it has not been loaded yet."""
        if self._model is None:
            self.load_model()

    def tag_image(self, image: Image.Image) -> list[str]:
        """Generate validated tags for a single image.

        Encodes the image once, then runs each tag prompt against the
        encoded representation (Pitfall 4 -- encode-once optimization).
        Only tags that appear in :data:`VALID_TAGS` are returned.
        """
        self._ensure_model()
        assert self._model is not None

        encoded = self._model.encode_image(image)
        tags: list[str] = []

        for dimension, prompt in TAG_PROMPTS.items():
            try:
                result = self._model.query(encoded, prompt)
                raw = result["answer"].strip().lower().rstrip(".")
                # Accept only controlled vocabulary
                if raw in VALID_TAGS.get(dimension, set()):
                    tags.append(raw)
            except Exception:
                logger.debug(
                    "VLM query failed for dimension %s", dimension, exc_info=True
                )

        return tags

    def get_progress(self, dataset_id: str) -> TaggingProgress:
        """Return the current progress for a dataset's tagging task."""
        return self._tasks.get(
            dataset_id,
            TaggingProgress(status="idle", processed=0, total=0),
        )

    def is_running(self, dataset_id: str) -> bool:
        """Check whether auto-tagging is currently running for a dataset."""
        task = self._tasks.get(dataset_id)
        return task is not None and task.status == "running"

    def generate_tags(self, dataset_id: str) -> None:
        """Background task: auto-tag all samples in a dataset.

        Processes images one at a time (VLM inference is per-image),
        encoding each image once and running all tag prompts.  Tags
        are merged into the existing ``samples.tags`` column using
        ``list_distinct(list_concat(...))`` to avoid overwriting
        user-applied tags.
        """
        self._tasks[dataset_id] = TaggingProgress(
            status="running", processed=0, total=0
        )

        cursor = self.db.connection.cursor()
        try:
            # Ensure model is loaded before processing
            self._ensure_model()

            # Count total samples
            total = cursor.execute(
                "SELECT COUNT(*) FROM samples WHERE dataset_id = ?",
                [dataset_id],
            ).fetchone()[0]
            self._tasks[dataset_id].total = total

            if total == 0:
                self._tasks[dataset_id].status = "complete"
                self._tasks[dataset_id].message = "No samples to tag"
                return

            # Process each sample individually (VLM inference is per-image)
            offset = 0
            batch_size = 50  # fetch rows in batches for DB efficiency
            tagged_count = 0

            while offset < total:
                rows = cursor.execute(
                    "SELECT id, file_name, image_dir FROM samples "
                    "WHERE dataset_id = ? ORDER BY id LIMIT ? OFFSET ?",
                    [dataset_id, batch_size, offset],
                ).fetchall()

                if not rows:
                    break

                for sample_id, file_name, image_dir in rows:
                    try:
                        image_path = self.storage.resolve_image_path(
                            image_dir, file_name
                        )
                        image_bytes = self.storage.read_bytes(image_path)
                        img = Image.open(BytesIO(image_bytes)).convert("RGB")

                        new_tags = self.tag_image(img)
                        if new_tags:
                            # Merge with existing tags using list_distinct(list_concat(...))
                            cursor.execute(
                                "UPDATE samples SET tags = list_distinct(list_concat(tags, ?::VARCHAR[])) "
                                "WHERE id = ? AND dataset_id = ?",
                                [new_tags, sample_id, dataset_id],
                            )
                            tagged_count += 1

                    except Exception:
                        logger.warning(
                            "Skipping sample %s: %s",
                            sample_id,
                            traceback.format_exc(),
                        )

                    self._tasks[dataset_id].processed += 1

                offset += batch_size

            self._tasks[dataset_id].status = "complete"
            self._tasks[dataset_id].processed = total
            self._tasks[dataset_id].message = (
                f"Tagged {tagged_count}/{total} samples"
            )
            logger.info(
                "VLM auto-tagging complete for dataset %s: %d/%d tagged",
                dataset_id,
                tagged_count,
                total,
            )

        except Exception as e:
            self._tasks[dataset_id].status = "error"
            self._tasks[dataset_id].message = str(e)
            logger.error(
                "VLM auto-tagging failed for dataset %s:\n%s",
                dataset_id,
                traceback.format_exc(),
            )
        finally:
            cursor.close()
