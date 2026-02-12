"""Application configuration using Pydantic Settings."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """VisionLens application settings.

    All fields can be overridden via environment variables with
    the VISIONLENS_ prefix (e.g., VISIONLENS_DB_PATH).
    """

    db_path: Path = Path("data/visionlens.duckdb")
    thumbnail_cache_dir: Path = Path("data/thumbnails")
    thumbnail_default_size: str = "medium"
    thumbnail_webp_quality: int = 80
    qdrant_path: Path = Path("data/qdrant")
    plugin_dir: Path = Path("plugins")
    host: str = "0.0.0.0"
    port: int = 8000
    gcs_credentials_path: str | None = None
    agent_model: str = "openai:gpt-4o"
    vlm_device: str = "cpu"

    model_config = {
        "env_prefix": "VISIONLENS_",
        "env_file": ".env",
    }


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings (singleton)."""
    return Settings()
