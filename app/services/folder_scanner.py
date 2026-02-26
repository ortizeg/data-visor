"""Heuristic-based dataset folder scanner.

Detects COCO and classification JSONL layouts:

- **Layout D (Classification split dirs):** Split directories with JSONL + images.
- **Layout E (Classification flat):** Flat JSONL at root with images.
- **Layout B (Roboflow):** Split directories containing both annotation
  JSON and images co-located.
- **Layout A (Standard COCO):** An ``annotations/`` directory with per-split
  JSON files paired with image directories.
- **Layout C (Flat):** A single annotation file at root with an ``images/``
  directory or co-located images.

Classification layouts are checked first since JSONL files are never COCO.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import ijson

from app.models.scan import DetectedSplit, ScanResult
from app.repositories.storage import StorageBackend

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


def _join(base: str, name: str) -> str:
    """Join a base path with a child name, handling both local and GCS paths."""
    if base.startswith("gs://"):
        return f"{base.rstrip('/')}/{name}"
    return str(Path(base) / name)


def _basename(path: str) -> str:
    """Return the last component of a path."""
    if path.startswith("gs://"):
        return path.rstrip("/").split("/")[-1]
    return Path(path).name


def _stem(path: str) -> str:
    """Return the filename without extension."""
    name = _basename(path)
    dot = name.rfind(".")
    return name[:dot] if dot > 0 else name


class FolderScanner:
    """Walk a directory tree and detect importable datasets.

    Supports COCO and classification JSONL formats.
    Supports both local and GCS paths via :class:`StorageBackend`.

    Usage::

        scanner = FolderScanner(storage)
        result = scanner.scan("/path/to/dataset")
        for split in result.splits:
            print(split.name, split.annotation_path, split.image_count)
    """

    def __init__(self, storage: StorageBackend | None = None) -> None:
        if storage is None:
            storage = StorageBackend()
        self.storage = storage

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scan(self, root_path: str) -> ScanResult:
        """Scan *root_path* for COCO annotation files and image directories.

        Returns a :class:`ScanResult` with all detected splits.  Raises
        :class:`ValueError` if the path is not a directory.
        """
        is_gcs = root_path.startswith("gs://")

        if is_gcs:
            if not self.storage.isdir(root_path):
                raise ValueError(f"Path is not a directory: {root_path}")
            resolved = root_path.rstrip("/")
        else:
            root = Path(root_path).resolve()
            if not root.is_dir():
                raise ValueError(f"Path is not a directory: {root_path}")
            resolved = str(root)

        warnings: list[str] = []

        if is_gcs:
            splits, fmt = self._scan_gcs(resolved, warnings)
        else:
            # Try classification JSONL layouts first (more specific).
            splits = self._try_layout_d(Path(resolved), warnings)
            if not splits:
                splits = self._try_layout_e(Path(resolved), warnings)
            if splits:
                return ScanResult(
                    root_path=resolved,
                    dataset_name=_basename(resolved),
                    format="classification_jsonl",
                    splits=splits,
                    warnings=warnings,
                )

            # Fall back to COCO layouts.
            splits = self._try_layout_b(Path(resolved), warnings)
            if not splits:
                splits = self._try_layout_a(Path(resolved), warnings)
            if not splits:
                splits = self._try_layout_c(Path(resolved), warnings)
            fmt = "coco"

        return ScanResult(
            root_path=resolved,
            dataset_name=_basename(resolved),
            format=fmt,
            splits=splits,
            warnings=warnings,
        )

    # ------------------------------------------------------------------
    # GCS scanner (uses StorageBackend)
    # ------------------------------------------------------------------

    def _scan_gcs(
        self, root: str, warnings: list[str]
    ) -> tuple[list[DetectedSplit], str]:
        """Detect datasets in a GCS prefix using StorageBackend.

        Returns a tuple of (splits, format_string).
        """
        entries = self.storage.list_dir_detail(root)
        dirs = [e for e in entries if e["type"] == "directory"]
        jsons = [e for e in entries if e["type"] == "file" and e["name"].lower().endswith(".json")]
        jsonls = [e for e in entries if e["type"] == "file" and e["name"].lower().endswith(".jsonl")]

        # Try classification JSONL layouts first (more specific).
        cls_splits = self._scan_gcs_classification(root, entries, dirs, jsonls, warnings)
        if cls_splits:
            return cls_splits, "classification_jsonl"

        # Try Layout B: split directories
        split_dirs: dict[str, str] = {}
        for d in dirs:
            norm = d["name"].lower()
            if norm in SPLIT_DIR_NAMES:
                canonical = SPLIT_DIR_NAMES[norm]
                if canonical not in split_dirs:
                    split_dirs[canonical] = _join(root, d["name"])

        if split_dirs:
            splits: list[DetectedSplit] = []
            for canonical_name, dir_path in sorted(split_dirs.items()):
                sub_entries = self.storage.list_dir_detail(dir_path)
                sub_jsons = sorted(
                    [e for e in sub_entries if e["type"] == "file" and e["name"].lower().endswith(".json")],
                    key=lambda e: e["name"],
                )
                for jentry in sub_jsons:
                    jpath = _join(dir_path, jentry["name"])
                    if self._is_coco_annotation_remote(jpath):
                        img_count = sum(
                            1 for e in sub_entries
                            if e["type"] == "file"
                            and os.path.splitext(e["name"])[1].lower() in IMAGE_EXTENSIONS
                        )
                        if img_count > 0:
                            splits.append(DetectedSplit(
                                name=canonical_name,
                                annotation_path=jpath,
                                image_dir=dir_path,
                                image_count=img_count,
                                annotation_file_size=jentry.get("size") or 0,
                            ))
                        break
                    else:
                        warnings.append(f"Found JSON but not valid COCO: {jpath}")
            if splits:
                return splits, "coco"

        # Try Layout A: annotations/ dir
        ann_dir = _join(root, "annotations")
        if self.storage.isdir(ann_dir):
            ann_entries = self.storage.list_dir_detail(ann_dir)
            coco_files: list[tuple[str, int]] = []
            for e in sorted(ann_entries, key=lambda e: e["name"]):
                if e["type"] == "file" and e["name"].lower().endswith(".json"):
                    fpath = _join(ann_dir, e["name"])
                    if self._is_coco_annotation_remote(fpath):
                        coco_files.append((fpath, e.get("size") or 0))
                    else:
                        warnings.append(f"Found JSON but not valid COCO: {fpath}")

            if coco_files:
                # Build image dir candidates
                image_dirs: dict[str, str] = {}
                images_root = _join(root, "images")
                if self.storage.isdir(images_root):
                    for sub in self.storage.list_dir_detail(images_root):
                        if sub["type"] == "directory":
                            norm = sub["name"].lower()
                            if norm in SPLIT_DIR_NAMES:
                                image_dirs[SPLIT_DIR_NAMES[norm]] = _join(images_root, sub["name"])
                    if not image_dirs:
                        image_dirs["_flat"] = images_root

                for d in dirs:
                    if d["name"].lower() != "annotations":
                        norm = d["name"].lower()
                        if norm in SPLIT_DIR_NAMES:
                            canonical = SPLIT_DIR_NAMES[norm]
                            if canonical not in image_dirs:
                                image_dirs[canonical] = _join(root, d["name"])

                splits = []
                for coco_path, coco_size in coco_files:
                    stem_lower = _stem(coco_path).lower()
                    matched_split: str | None = None
                    matched_dir: str | None = None
                    for keyword, canonical in SPLIT_DIR_NAMES.items():
                        if keyword in stem_lower and canonical in image_dirs:
                            matched_split = canonical
                            matched_dir = image_dirs[canonical]
                            break
                    if matched_split is None and "_flat" in image_dirs:
                        matched_split = _basename(root)
                        matched_dir = image_dirs["_flat"]
                    if matched_split and matched_dir:
                        img_count = self._count_images_remote(matched_dir)
                        splits.append(DetectedSplit(
                            name=matched_split,
                            annotation_path=coco_path,
                            image_dir=matched_dir,
                            image_count=img_count,
                            annotation_file_size=coco_size,
                        ))
                if splits:
                    return splits, "coco"

        # Try Layout C: flat JSON at root
        for jentry in sorted(jsons, key=lambda e: e["name"]):
            jpath = _join(root, jentry["name"])
            if self._is_coco_annotation_remote(jpath):
                images_dir = _join(root, "images")
                if self.storage.isdir(images_dir):
                    img_count = self._count_images_remote(images_dir)
                    img_dir_path = images_dir
                else:
                    img_count = self._count_images_remote(root)
                    img_dir_path = root
                if img_count > 0:
                    return [DetectedSplit(
                        name=_basename(root),
                        annotation_path=jpath,
                        image_dir=img_dir_path,
                        image_count=img_count,
                        annotation_file_size=jentry.get("size") or 0,
                    )], "coco"
                else:
                    warnings.append(
                        f"COCO annotation found ({jentry['name']}) but no images in {img_dir_path}"
                    )
                    return [], "coco"
            else:
                warnings.append(f"Found JSON but not valid COCO: {jpath}")

        return [], "coco"

    def _is_coco_annotation_remote(self, path: str) -> bool:
        """Check if a remote file looks like COCO annotation JSON."""
        try:
            with self.storage.open(path, "rb") as f:
                keys_seen = 0
                for prefix, event, value in ijson.parse(f):
                    if prefix == "" and event == "map_key":
                        if value == "images":
                            return True
                        keys_seen += 1
                        if keys_seen >= 10:
                            return False
            return False
        except Exception:
            return False

    def _count_images_remote(self, path: str) -> int:
        """Count image files in a remote directory."""
        try:
            entries = self.storage.list_dir_detail(path)
            return sum(
                1 for e in entries
                if e["type"] == "file"
                and os.path.splitext(e["name"])[1].lower() in IMAGE_EXTENSIONS
            )
        except Exception:
            return 0

    # ------------------------------------------------------------------
    # GCS classification detection
    # ------------------------------------------------------------------

    def _scan_gcs_classification(
        self,
        root: str,
        entries: list[dict],
        dirs: list[dict],
        jsonls: list[dict],
        warnings: list[str],
    ) -> list[DetectedSplit]:
        """Detect classification JSONL datasets in a GCS prefix."""
        # Try split directories with JSONL
        split_dirs: dict[str, str] = {}
        for d in dirs:
            norm = d["name"].lower()
            if norm in SPLIT_DIR_NAMES:
                canonical = SPLIT_DIR_NAMES[norm]
                if canonical not in split_dirs:
                    split_dirs[canonical] = _join(root, d["name"])

        if split_dirs:
            splits: list[DetectedSplit] = []
            for canonical_name, dir_path in sorted(split_dirs.items()):
                sub_entries = self.storage.list_dir_detail(dir_path)
                sub_jsonls = sorted(
                    [e for e in sub_entries if e["type"] == "file" and e["name"].lower().endswith(".jsonl")],
                    key=lambda e: e["name"],
                )
                for jentry in sub_jsonls:
                    jpath = _join(dir_path, jentry["name"])
                    if self._is_classification_jsonl_remote(jpath):
                        img_count = sum(
                            1 for e in sub_entries
                            if e["type"] == "file"
                            and os.path.splitext(e["name"])[1].lower() in IMAGE_EXTENSIONS
                        )
                        if img_count > 0:
                            splits.append(DetectedSplit(
                                name=canonical_name,
                                annotation_path=jpath,
                                image_dir=dir_path,
                                image_count=img_count,
                                annotation_file_size=jentry.get("size") or 0,
                            ))
                        break
            if splits:
                return splits

        # Try flat JSONL at root
        for jentry in sorted(jsonls, key=lambda e: e["name"]):
            jpath = _join(root, jentry["name"])
            if self._is_classification_jsonl_remote(jpath):
                images_dir = _join(root, "images")
                if self.storage.isdir(images_dir):
                    img_count = self._count_images_remote(images_dir)
                    img_dir_path = images_dir
                else:
                    img_count = self._count_images_remote(root)
                    img_dir_path = root
                if img_count > 0:
                    return [DetectedSplit(
                        name=_basename(root),
                        annotation_path=jpath,
                        image_dir=img_dir_path,
                        image_count=img_count,
                        annotation_file_size=jentry.get("size") or 0,
                    )]

        return []

    def _is_classification_jsonl_remote(self, path: str) -> bool:
        """Check if a remote JSONL file looks like classification data."""
        try:
            with self.storage.open(path, "r") as f:
                lines_checked = 0
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    record = json.loads(line)
                    has_filename = any(k in record for k in ("filename", "file_name", "image", "path"))
                    has_label = any(k in record for k in ("label", "class", "category", "class_name"))
                    has_bbox = "bbox" in record or "annotations" in record
                    if not (has_filename and has_label and not has_bbox):
                        return False
                    lines_checked += 1
                    if lines_checked >= 5:
                        break
                return lines_checked > 0
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Classification layout detectors (local-only)
    # ------------------------------------------------------------------

    def _try_layout_d(
        self, root: Path, warnings: list[str]
    ) -> list[DetectedSplit]:
        """Layout D: Split directories with co-located JSONL + images."""
        split_dirs = self._detect_split_dirs(root)
        if not split_dirs:
            return []

        splits: list[DetectedSplit] = []
        for canonical_name, dir_path in sorted(split_dirs.items()):
            jsonl_files = [
                f for f in dir_path.iterdir()
                if f.is_file() and f.suffix.lower() == ".jsonl"
            ]
            for jf in sorted(jsonl_files, key=lambda p: p.name):
                if self._is_classification_jsonl(jf):
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
                    break

        return splits

    def _try_layout_e(
        self, root: Path, warnings: list[str]
    ) -> list[DetectedSplit]:
        """Layout E: Flat JSONL at root with images/ subdir or co-located."""
        jsonl_files = [
            f for f in root.iterdir()
            if f.is_file() and f.suffix.lower() == ".jsonl"
        ]

        for jf in sorted(jsonl_files, key=lambda p: p.name):
            if self._is_classification_jsonl(jf):
                images_dir = root / "images"
                if images_dir.is_dir():
                    img_count = self._count_images(images_dir)
                    img_dir_path = images_dir
                else:
                    img_count = self._count_images(root)
                    img_dir_path = root

                if img_count > 0:
                    return [
                        DetectedSplit(
                            name=root.name,
                            annotation_path=str(jf),
                            image_dir=str(img_dir_path),
                            image_count=img_count,
                            annotation_file_size=jf.stat().st_size,
                        )
                    ]

        return []

    @staticmethod
    def _is_classification_jsonl(file_path: Path) -> bool:
        """Return ``True`` if *file_path* looks like a classification JSONL file.

        Reads the first 5 non-empty lines, parses each as JSON, and checks
        for filename + label keys without bbox/annotations keys.
        """
        try:
            lines_checked = 0
            with open(file_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    record = json.loads(line)
                    has_filename = any(k in record for k in ("filename", "file_name", "image", "path"))
                    has_label = any(k in record for k in ("label", "class", "category", "class_name"))
                    has_bbox = "bbox" in record or "annotations" in record
                    if not (has_filename and has_label and not has_bbox):
                        return False
                    lines_checked += 1
                    if lines_checked >= 5:
                        break
            return lines_checked > 0
        except Exception:
            return False

    # ------------------------------------------------------------------
    # COCO layout detectors (local-only, preserved for performance)
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
