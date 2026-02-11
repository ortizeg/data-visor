"""Thumbnail generation and disk cache service using Pillow.

Generates WebP thumbnails at configurable sizes (128/256/512) with
LANCZOS resampling.  Cached thumbnails are served directly on subsequent
requests without regeneration.
"""

from __future__ import annotations

import logging
from io import BytesIO
from pathlib import Path

from PIL import Image

from app.repositories.storage import StorageBackend

logger = logging.getLogger(__name__)

THUMBNAIL_SIZES: dict[str, int] = {"small": 128, "medium": 256, "large": 512}
DEFAULT_THUMBNAIL_SIZE: str = "medium"
WEBP_QUALITY: int = 80


class ImageService:
    """Generate, cache, and serve WebP thumbnails for dataset images.

    Thumbnails are stored on disk under *cache_dir* with deterministic
    filenames (``{sample_id}_{width}.webp``).  A cache hit skips all
    image processing entirely.
    """

    def __init__(self, cache_dir: Path, storage: StorageBackend) -> None:
        self.cache_dir = cache_dir
        self.storage = storage
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def get_cache_path(self, sample_id: str, size: str) -> Path:
        """Return the deterministic cache file path for a given sample + size."""
        width = THUMBNAIL_SIZES.get(size, THUMBNAIL_SIZES[DEFAULT_THUMBNAIL_SIZE])
        return self.cache_dir / f"{sample_id}_{width}.webp"

    def get_or_generate_thumbnail(
        self,
        sample_id: str,
        image_path: str,
        size: str = "medium",
    ) -> Path:
        """Return the cached thumbnail path, generating it if missing.

        1. Check disk cache -- return immediately on hit.
        2. Read original image bytes via :pyclass:`StorageBackend`.
        3. Resize with LANCZOS and convert to RGB if necessary.
        4. Save as WebP (quality=80, method=4) and return the path.
        """
        cache_path = self.get_cache_path(sample_id, size)
        if cache_path.exists():
            return cache_path

        # Read original image
        image_bytes = self.storage.read_bytes(image_path)
        img = Image.open(BytesIO(image_bytes))

        # Resize
        width = THUMBNAIL_SIZES.get(size, THUMBNAIL_SIZES[DEFAULT_THUMBNAIL_SIZE])
        img.thumbnail((width, width), Image.Resampling.LANCZOS)

        # Convert colour mode for WebP compatibility
        if img.mode in ("RGBA", "P", "LA", "PA"):
            img = img.convert("RGB")

        # Save
        img.save(cache_path, format="WEBP", quality=WEBP_QUALITY, method=4)
        return cache_path

    def generate_thumbnails_batch(
        self,
        samples: list[dict],
        size: str = "medium",
    ) -> tuple[int, int]:
        """Pre-generate thumbnails for a list of samples.

        Each *sample* dict must contain ``"id"`` and ``"image_path"`` keys.

        Returns ``(generated_count, error_count)``.  Individual failures
        are logged but never propagated -- a missing thumbnail is
        recoverable at serve time.
        """
        generated = 0
        errors = 0
        for sample in samples:
            try:
                cache_path = self.get_cache_path(sample["id"], size)
                if not cache_path.exists():
                    self.get_or_generate_thumbnail(
                        sample["id"], sample["image_path"], size
                    )
                    generated += 1
            except Exception:
                logger.warning(
                    "Failed to generate thumbnail for sample %s",
                    sample.get("id", "unknown"),
                    exc_info=True,
                )
                errors += 1
        return generated, errors
