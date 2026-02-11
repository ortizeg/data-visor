"""Tests for ImageService thumbnail generation and disk cache."""

import time
from pathlib import Path

import pytest
from PIL import Image

from app.repositories.storage import StorageBackend
from app.services.image_service import (
    THUMBNAIL_SIZES,
    ImageService,
)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _make_jpeg(path: Path, size: tuple[int, int] = (800, 600), color: str = "red") -> Path:
    """Create a minimal JPEG test image on disk."""
    img = Image.new("RGB", size, color=color)
    img.save(path, "JPEG")
    return path


def _make_rgba_png(path: Path, size: tuple[int, int] = (400, 300)) -> Path:
    """Create an RGBA PNG test image on disk."""
    img = Image.new("RGBA", size, color=(255, 0, 0, 128))
    img.save(path, "PNG")
    return path


@pytest.fixture()
def image_service(tmp_path: Path) -> ImageService:
    cache_dir = tmp_path / "thumb_cache"
    storage = StorageBackend()
    return ImageService(cache_dir, storage)


@pytest.fixture()
def test_image(tmp_path: Path) -> Path:
    return _make_jpeg(tmp_path / "test_image.jpg")


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------


def test_thumbnail_generation(image_service: ImageService, test_image: Path) -> None:
    """Generate a thumbnail and verify the WebP file exists."""
    thumb = image_service.get_or_generate_thumbnail("sample-1", str(test_image), "medium")
    assert thumb.exists()
    assert thumb.suffix == ".webp"
    # Verify it's a valid image
    img = Image.open(thumb)
    assert img.format == "WEBP"


def test_thumbnail_cache_hit(image_service: ImageService, test_image: Path) -> None:
    """Second call returns cached file without regeneration."""
    thumb1 = image_service.get_or_generate_thumbnail("sample-1", str(test_image), "medium")
    mtime1 = thumb1.stat().st_mtime

    # Small sleep to ensure mtime would differ if regenerated
    time.sleep(0.05)

    thumb2 = image_service.get_or_generate_thumbnail("sample-1", str(test_image), "medium")
    mtime2 = thumb2.stat().st_mtime

    assert thumb1 == thumb2
    assert mtime1 == mtime2


def test_thumbnail_sizes(image_service: ImageService, test_image: Path) -> None:
    """Different size names produce thumbnails with different dimensions."""
    dimensions = {}
    for size_name in ("small", "medium", "large"):
        thumb = image_service.get_or_generate_thumbnail(
            f"sample-{size_name}", str(test_image), size_name
        )
        img = Image.open(thumb)
        dimensions[size_name] = img.size  # (width, height)

    # Each size should have a different max dimension
    max_dims = {name: max(dim) for name, dim in dimensions.items()}
    assert max_dims["small"] <= THUMBNAIL_SIZES["small"]
    assert max_dims["medium"] <= THUMBNAIL_SIZES["medium"]
    assert max_dims["large"] <= THUMBNAIL_SIZES["large"]
    assert max_dims["small"] < max_dims["medium"] < max_dims["large"]


def test_thumbnail_rgb_conversion(image_service: ImageService, tmp_path: Path) -> None:
    """RGBA PNG input is converted to valid RGB WebP output."""
    rgba_path = _make_rgba_png(tmp_path / "rgba_test.png")
    thumb = image_service.get_or_generate_thumbnail("sample-rgba", str(rgba_path), "medium")
    assert thumb.exists()
    img = Image.open(thumb)
    assert img.format == "WEBP"
    assert img.mode == "RGB"


def test_batch_generation(image_service: ImageService, tmp_path: Path) -> None:
    """Batch generation succeeds for multiple valid images."""
    samples = []
    for i in range(3):
        img_path = _make_jpeg(tmp_path / f"batch_{i}.jpg", color="blue")
        samples.append({"id": f"batch-{i}", "image_path": str(img_path)})

    generated, errors = image_service.generate_thumbnails_batch(samples)
    assert generated == 3
    assert errors == 0


def test_batch_error_isolation(image_service: ImageService, tmp_path: Path) -> None:
    """Bad images in a batch don't prevent others from generating."""
    good_path = _make_jpeg(tmp_path / "good.jpg")
    samples = [
        {"id": "good-1", "image_path": str(good_path)},
        {"id": "bad-1", "image_path": "/nonexistent/path/to/image.jpg"},
        {"id": "good-2", "image_path": str(good_path)},
    ]

    generated, errors = image_service.generate_thumbnails_batch(samples)
    assert generated == 2
    assert errors == 1


def test_cache_path_deterministic(image_service: ImageService) -> None:
    """Same sample_id + size always produces the same cache path."""
    path1 = image_service.get_cache_path("abc-123", "small")
    path2 = image_service.get_cache_path("abc-123", "small")
    assert path1 == path2

    # Different size -> different path
    path3 = image_service.get_cache_path("abc-123", "large")
    assert path1 != path3
