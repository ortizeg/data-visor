"""Heuristic-based COCO dataset folder scanner.

Detects three common COCO layouts:

- **Layout B (Roboflow):** Split directories containing both annotation
  JSON and images co-located.
- **Layout A (Standard COCO):** An ``annotations/`` directory with per-split
  JSON files paired with image directories.
- **Layout C (Flat):** A single annotation file at root with an ``images/``
  directory or co-located images.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import ijson

from app.models.scan import DetectedSplit, ScanResult

logger = logging.getLogger(__name__)

# Maximum annotation file size (bytes) to inspect during scanning.
_MAX_PEEK_SIZE = 500 * 1024 * 1024  # 500 MB

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}

SPLIT_DIR_NAMES: dict[str, str] = {
    "train": "train",
    "train2017": "train",
    "train2014": "train",
    "training": "train",
    "val": "val",
    "val2017": "val",
    "val2014": "val",
    "valid": "val",
    "validation": "val",
    "test": "test",
    "test2017": "test",
    "test2014": "test",
    "testing": "test",
}


class FolderScanner:
    """Walk a directory tree and detect importable COCO datasets.

    Usage::

        scanner = FolderScanner()
        result = scanner.scan("/path/to/dataset")
        for split in result.splits:
            print(split.name, split.annotation_path, split.image_count)
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scan(self, root_path: str) -> ScanResult:
        """Scan *root_path* for COCO annotation files and image directories.

        Returns a :class:`ScanResult` with all detected splits.  Raises
        :class:`ValueError` if the path is not a directory.
        """
        root = Path(root_path).resolve()
        if not root.is_dir():
            raise ValueError(f"Path is not a directory: {root_path}")

        warnings: list[str] = []

        # Try layouts in priority order (most specific first).
        splits = self._try_layout_b(root, warnings)
        if not splits:
            splits = self._try_layout_a(root, warnings)
        if not splits:
            splits = self._try_layout_c(root, warnings)

        return ScanResult(
            root_path=str(root),
            dataset_name=root.name,
            format="coco",
            splits=splits,
            warnings=warnings,
        )

    # ------------------------------------------------------------------
    # Layout detectors
    # ------------------------------------------------------------------

    def _try_layout_b(
        self, root: Path, warnings: list[str]
    ) -> list[DetectedSplit]:
        """Layout B (Roboflow): split dirs with co-located JSON + images."""
        split_dirs = self._detect_split_dirs(root)
        if not split_dirs:
            return []

        splits: list[DetectedSplit] = []
        for canonical_name, dir_path in sorted(split_dirs.items()):
            # Look for JSON files inside the split directory.
            json_files = [
                f
                for f in dir_path.iterdir()
                if f.is_file() and f.suffix.lower() == ".json"
            ]
            for jf in json_files:
                if self._is_coco_annotation(jf):
                    img_count = self._count_images(dir_path)
                    if img_count > 0:
                        splits.append(
                            DetectedSplit(
                                name=canonical_name,
                                annotation_path=str(jf),
                                image_dir=str(dir_path),
                                image_count=img_count,
                                annotation_file_size=jf.stat().st_size,
                            )
                        )
                    break  # Use the first valid COCO JSON per split dir.
                else:
                    warnings.append(
                        f"Found JSON but not valid COCO: {jf}"
                    )

        return splits

    def _try_layout_a(
        self, root: Path, warnings: list[str]
    ) -> list[DetectedSplit]:
        """Layout A (Standard COCO): annotations/ dir + images/ dir."""
        annotations_dir = root / "annotations"
        if not annotations_dir.is_dir():
            return []

        # Gather all COCO JSON files inside annotations/.
        coco_files: list[Path] = []
        for entry in annotations_dir.iterdir():
            if entry.is_file() and entry.suffix.lower() == ".json":
                if self._is_coco_annotation(entry):
                    coco_files.append(entry)
                else:
                    warnings.append(
                        f"Found JSON but not valid COCO: {entry}"
                    )

        if not coco_files:
            return []

        # Build image directory candidates: images/<subdir> or root/<subdir>.
        images_root = root / "images"
        image_dirs: dict[str, Path] = {}
        if images_root.is_dir():
            for sub in images_root.iterdir():
                if sub.is_dir():
                    norm = sub.name.lower()
                    if norm in SPLIT_DIR_NAMES:
                        image_dirs[SPLIT_DIR_NAMES[norm]] = sub
            # If images/ has no split subdirs, use images/ itself.
            if not image_dirs:
                image_dirs["_flat"] = images_root

        # Also check root-level split dirs (e.g. root/train2017/).
        for sub in root.iterdir():
            if sub.is_dir() and sub.name.lower() != "annotations":
                norm = sub.name.lower()
                if norm in SPLIT_DIR_NAMES:
                    canonical = SPLIT_DIR_NAMES[norm]
                    if canonical not in image_dirs:
                        image_dirs[canonical] = sub

        # Match annotation files to image directories by split keyword.
        splits: list[DetectedSplit] = []
        for coco_file in sorted(coco_files, key=lambda p: p.name):
            stem_lower = coco_file.stem.lower()
            matched_split: str | None = None
            matched_dir: Path | None = None

            # Check if the filename contains a known split keyword.
            for keyword, canonical in SPLIT_DIR_NAMES.items():
                if keyword in stem_lower:
                    if canonical in image_dirs:
                        matched_split = canonical
                        matched_dir = image_dirs[canonical]
                        break

            # Fallback: if only one annotation file and a flat images dir.
            if matched_split is None and "_flat" in image_dirs:
                matched_split = root.name
                matched_dir = image_dirs["_flat"]

            if matched_split is not None and matched_dir is not None:
                img_count = self._count_images(matched_dir)
                splits.append(
                    DetectedSplit(
                        name=matched_split,
                        annotation_path=str(coco_file),
                        image_dir=str(matched_dir),
                        image_count=img_count,
                        annotation_file_size=coco_file.stat().st_size,
                    )
                )

        return splits

    def _try_layout_c(
        self, root: Path, warnings: list[str]
    ) -> list[DetectedSplit]:
        """Layout C (Flat): single COCO JSON at root + images dir or co-located."""
        # Scan root for JSON files (do NOT recurse).
        json_files = [
            f
            for f in root.iterdir()
            if f.is_file() and f.suffix.lower() == ".json"
        ]

        coco_file: Path | None = None
        for jf in sorted(json_files, key=lambda p: p.name):
            if self._is_coco_annotation(jf):
                coco_file = jf
                break
            else:
                warnings.append(f"Found JSON but not valid COCO: {jf}")

        if coco_file is None:
            return []

        # Determine image directory: prefer images/ subdir, else root itself.
        images_dir = root / "images"
        if images_dir.is_dir():
            img_count = self._count_images(images_dir)
            img_dir_path = images_dir
        else:
            img_count = self._count_images(root)
            img_dir_path = root

        if img_count == 0:
            warnings.append(
                f"COCO annotation found ({coco_file.name}) but no images in {img_dir_path}"
            )
            return []

        return [
            DetectedSplit(
                name=root.name,
                annotation_path=str(coco_file),
                image_dir=str(img_dir_path),
                image_count=img_count,
                annotation_file_size=coco_file.stat().st_size,
            )
        ]

    # ------------------------------------------------------------------
    # Helper methods
    # ------------------------------------------------------------------

    @staticmethod
    def _is_coco_annotation(file_path: Path) -> bool:
        """Return ``True`` if *file_path* looks like a COCO annotation file.

        Uses :mod:`ijson` to peek at top-level keys.  Returns ``True`` when
        an ``"images"`` key is found among the first 10 top-level keys.
        Files larger than 500 MB are skipped.
        """
        try:
            if file_path.stat().st_size > _MAX_PEEK_SIZE:
                return False
            keys_seen = 0
            with open(file_path, "rb") as f:
                for prefix, event, value in ijson.parse(f):
                    if prefix == "" and event == "map_key":
                        if value == "images":
                            return True
                        keys_seen += 1
                        if keys_seen >= 10:
                            return False
            return False
        except (ijson.IncompleteJSONError, OSError, ijson.common.IncompleteJSONError):
            return False

    @staticmethod
    def _count_images(dir_path: Path) -> int:
        """Count image files in *dir_path* (non-recursive) using ``os.scandir``."""
        count = 0
        try:
            with os.scandir(dir_path) as it:
                for entry in it:
                    if entry.is_file(follow_symlinks=False):
                        ext = os.path.splitext(entry.name)[1].lower()
                        if ext in IMAGE_EXTENSIONS:
                            count += 1
        except OSError:
            pass
        return count

    @staticmethod
    def _detect_split_dirs(root: Path) -> dict[str, Path]:
        """Map canonical split names to directory paths found under *root*."""
        splits: dict[str, Path] = {}
        try:
            for entry in root.iterdir():
                if entry.is_dir():
                    normalized = entry.name.lower()
                    if normalized in SPLIT_DIR_NAMES:
                        canonical = SPLIT_DIR_NAMES[normalized]
                        # First match wins (e.g., prefer train/ over training/).
                        if canonical not in splits:
                            splits[canonical] = entry
        except OSError:
            pass
        return splits
