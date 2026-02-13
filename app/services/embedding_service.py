"""Embedding generation service using vision models (Hugging Face Transformers).

Supports SigLIP (default) and DINOv2 model families. Loads the model once
at app startup, extracts embeddings in batches with torch.no_grad(), stores
FLOAT[768] vectors in DuckDB, and tracks progress in memory for SSE streaming.
"""

from __future__ import annotations

import logging
import traceback
from io import BytesIO

import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

from app.models.embedding import EmbeddingProgress
from app.repositories.duckdb_repo import DuckDBRepo
from app.repositories.storage import StorageBackend

logger = logging.getLogger(__name__)

# Map model short names to HuggingFace model IDs and extraction family.
# "siglip" family: use model.get_image_features(pixel_values=...)
# "dinov2" family: use model(**inputs).last_hidden_state[:, 0, :] (CLS token)
MODEL_REGISTRY: dict[str, dict[str, str]] = {
    "siglip-base": {"hf_id": "google/siglip-base-patch16-224", "family": "siglip"},
    "dinov2-base": {"hf_id": "facebook/dinov2-base", "family": "dinov2"},
    "dinov2-small": {"hf_id": "facebook/dinov2-small", "family": "dinov2"},
}

BATCH_SIZE = 32


class EmbeddingService:
    """Manages vision model lifecycle and batch embedding generation.

    The model is loaded once at startup via :meth:`load_model` and kept
    in memory.  Embedding generation runs as a background task, writing
    vectors to DuckDB in batches and updating an in-memory progress dict
    that SSE endpoints poll.
    """

    def __init__(self, db: DuckDBRepo, storage: StorageBackend) -> None:
        self.db = db
        self.storage = storage
        self._model: AutoModel | None = None
        self._processor: AutoImageProcessor | None = None
        self._device: torch.device | None = None
        self._model_name: str = ""
        self._family: str = ""
        self._tasks: dict[str, EmbeddingProgress] = {}

    def load_model(self, model_name: str = "siglip-base") -> None:
        """Load a pretrained vision model at startup.

        Called from the FastAPI lifespan context manager so the model is
        downloaded and ready before the first request.
        """
        model_info = MODEL_REGISTRY.get(model_name)
        if model_info is None:
            raise ValueError(
                f"Unknown model '{model_name}'. "
                f"Available: {list(MODEL_REGISTRY.keys())}"
            )

        hf_model_id = model_info["hf_id"]
        self._family = model_info["family"]

        logger.info("Loading embedding model: %s (%s)", model_name, hf_model_id)
        self._processor = AutoImageProcessor.from_pretrained(hf_model_id)
        self._model = AutoModel.from_pretrained(hf_model_id)
        self._model.eval()

        # Detect best available device
        if torch.backends.mps.is_available():
            self._device = torch.device("mps")
        elif torch.cuda.is_available():
            self._device = torch.device("cuda")
        else:
            self._device = torch.device("cpu")

        self._model.to(self._device)
        self._model_name = model_name
        logger.info(
            "Embedding model loaded: %s (%s) on %s",
            model_name,
            self._family,
            self._device,
        )

    def get_progress(self, dataset_id: str) -> EmbeddingProgress:
        """Return the current progress for a dataset's embedding task."""
        return self._tasks.get(
            dataset_id,
            EmbeddingProgress(status="idle", processed=0, total=0),
        )

    def is_running(self, dataset_id: str) -> bool:
        """Check whether embedding generation is currently running."""
        task = self._tasks.get(dataset_id)
        return task is not None and task.status == "running"

    def generate_embeddings(self, dataset_id: str) -> None:
        """Background task: generate embeddings for all samples in a dataset.

        Processes images in batches of 32, extracting CLS token embeddings
        from the last hidden state.  Existing embeddings for this dataset
        are deleted first (idempotent re-generation).
        """
        self._tasks[dataset_id] = EmbeddingProgress(
            status="running", processed=0, total=0
        )

        cursor = self.db.connection.cursor()
        try:
            # Count total samples
            total = cursor.execute(
                "SELECT COUNT(*) FROM samples WHERE dataset_id = ?",
                [dataset_id],
            ).fetchone()[0]
            self._tasks[dataset_id].total = total

            if total == 0:
                self._tasks[dataset_id].status = "complete"
                self._tasks[dataset_id].message = "No samples to embed"
                return

            # Delete existing embeddings for idempotent re-generation
            cursor.execute(
                "DELETE FROM embeddings WHERE dataset_id = ?", [dataset_id]
            )

            # Process in batches
            offset = 0
            while offset < total:
                rows = cursor.execute(
                    "SELECT id, file_name, image_dir FROM samples "
                    "WHERE dataset_id = ? ORDER BY id LIMIT ? OFFSET ?",
                    [dataset_id, BATCH_SIZE, offset],
                ).fetchall()

                if not rows:
                    break

                batch_ids: list[str] = []
                pil_images: list[Image.Image] = []

                for sample_id, file_name, image_dir in rows:
                    try:
                        image_path = self.storage.resolve_image_path(
                            image_dir, file_name
                        )
                        image_bytes = self.storage.read_bytes(image_path)
                        img = Image.open(BytesIO(image_bytes)).convert("RGB")
                        pil_images.append(img)
                        batch_ids.append(sample_id)
                    except Exception:
                        logger.warning(
                            "Skipping sample %s: image not loadable",
                            sample_id,
                            exc_info=True,
                        )

                if pil_images:
                    # Preprocess and extract embeddings
                    inputs = self._processor(
                        images=pil_images, return_tensors="pt"
                    ).to(self._device)

                    with torch.no_grad():
                        if self._family == "siglip":
                            # SigLIP: pooler_output from the vision encoder
                            vision_out = self._model.vision_model(
                                pixel_values=inputs["pixel_values"]
                            )
                            cls = vision_out.pooler_output.cpu().numpy()
                        else:
                            # DINOv2: CLS token is first token of last hidden state
                            outputs = self._model(**inputs)
                            cls = outputs.last_hidden_state[:, 0, :].cpu().numpy()

                    # Build insert rows
                    insert_rows = [
                        (
                            sample_id,
                            dataset_id,
                            self._model_name,
                            vec.tolist(),
                            None,
                            None,
                        )
                        for sample_id, vec in zip(batch_ids, cls)
                    ]
                    cursor.executemany(
                        "INSERT INTO embeddings VALUES (?, ?, ?, ?, ?, ?)",
                        insert_rows,
                    )

                offset += BATCH_SIZE
                self._tasks[dataset_id].processed = min(offset, total)

            self._tasks[dataset_id].status = "complete"
            self._tasks[dataset_id].processed = total
            self._tasks[dataset_id].message = (
                f"Generated {total} embeddings"
            )
            logger.info(
                "Embedding generation complete for dataset %s: %d embeddings",
                dataset_id,
                total,
            )

        except Exception as e:
            self._tasks[dataset_id].status = "error"
            self._tasks[dataset_id].message = str(e)
            logger.error(
                "Embedding generation failed for dataset %s:\n%s",
                dataset_id,
                traceback.format_exc(),
            )
        finally:
            cursor.close()
