"""Unified storage abstraction using fsspec for local and GCS access."""

from pathlib import Path

import fsspec


class StorageBackend:
    """Filesystem abstraction that provides identical API for local and GCS paths.

    Uses fsspec internally.  Filesystem instances are lazily created and
    cached per protocol (``file`` for local, ``gcs`` for Cloud Storage).
    """

    def __init__(self) -> None:
        self._filesystems: dict[str, fsspec.AbstractFileSystem] = {}

    def _get_fs(self, path: str) -> tuple[fsspec.AbstractFileSystem, str]:
        """Resolve the fsspec filesystem and normalised path for *path*.

        GCS paths (``gs://...``) use the ``gcs`` protocol.  Everything else
        is treated as a local file and resolved to an absolute path.
        """
        if path.startswith("gs://"):
            protocol = "gcs"
            norm_path = path
        else:
            protocol = "file"
            norm_path = str(Path(path).resolve())

        if protocol not in self._filesystems:
            self._filesystems[protocol] = fsspec.filesystem(protocol)

        return self._filesystems[protocol], norm_path

    def exists(self, path: str) -> bool:
        """Return ``True`` if *path* exists on the resolved filesystem."""
        fs, norm_path = self._get_fs(path)
        return fs.exists(norm_path)

    def read_bytes(self, path: str) -> bytes:
        """Read the entire contents of *path* as bytes."""
        fs, norm_path = self._get_fs(path)
        return fs.cat(norm_path)

    def open(self, path: str, mode: str = "rb"):
        """Return an open file-like object for *path*."""
        fs, norm_path = self._get_fs(path)
        return fs.open(norm_path, mode)

    def list_dir(self, path: str) -> list[str]:
        """List entries in *path*."""
        fs, norm_path = self._get_fs(path)
        return fs.ls(norm_path)

    def resolve_image_path(self, base_path: str, file_name: str) -> str:
        """Construct a full image path from a dataset base directory and filename."""
        if base_path.startswith("gs://"):
            return f"{base_path.rstrip('/')}/{file_name}"
        return str(Path(base_path) / file_name)
