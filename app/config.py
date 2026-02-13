"""DataVisor application configuration using Pydantic Settings."""

from functools import lru_cache
from pathlib import Path

import torch
from pydantic_settings import BaseSettings


def _detect_device() -> str:
    """Auto-detect best available device (MPS > CUDA > CPU)."""
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class Settings(BaseSettings):
    """DataVisor application settings.

    All fields can be overridden via environment variables with
    the DATAVISOR_ prefix (e.g., DATAVISOR_DB_PATH).
    """

    db_path: Path = Path("data/datavisor.duckdb")
    thumbnail_cache_dir: Path = Path("data/thumbnails")
    thumbnail_default_size: str = "medium"
    thumbnail_webp_quality: int = 80
    qdrant_path: Path = Path("data/qdrant")
    plugin_dir: Path = Path("plugins")
    host: str = "0.0.0.0"
    port: int = 8000
    gcs_credentials_path: str | None = None
    agent_model: str = "openai:gpt-4o"
    vlm_device: str = _detect_device()
    behind_proxy: bool = False  # Set DATAVISOR_BEHIND_PROXY=true in Docker

    model_config = {
        "env_prefix": "DATAVISOR_",
        "env_file": ".env",
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings (singleton)."""
    return Settings()
