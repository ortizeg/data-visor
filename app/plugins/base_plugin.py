"""BasePlugin abstract class and PluginContext dataclass.

Defines the plugin contract for data-visor. All plugins subclass BasePlugin
and override hooks they care about. Hooks use keyword-only arguments to
prevent breakage when new parameters are added in future versions.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PluginContext:
    """Extensible context object passed to all plugin hooks.

    Future phases add fields (with defaults) without breaking existing plugins.
    """

    dataset_id: str
    metadata: dict[str, Any] | None = field(default=None)


class BasePlugin(ABC):
    """Abstract base class for all data-visor plugins.

    Subclass this and override the hooks you need. All hooks use keyword-only
    arguments (the ``*`` separator) so new parameters can be added without
    breaking existing plugins.

    Class Variables:
        api_version: Protocol version for future compatibility checks.
    """

    api_version: int = 1

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique plugin name. Must be implemented by subclasses."""
        ...

    @property
    def description(self) -> str:
        """Optional human-readable description."""
        return ""

    # ------------------------------------------------------------------
    # Ingestion hooks (keyword-only arguments)
    # ------------------------------------------------------------------

    def on_ingest_start(self, *, context: PluginContext) -> None:
        """Called when ingestion begins for a dataset."""

    def on_sample_ingested(
        self, *, context: PluginContext, sample: dict[str, Any]
    ) -> dict[str, Any]:
        """Called for each sample during ingestion.

        Return the (possibly modified) sample dict. Default returns
        the sample unchanged.
        """
        return sample

    def on_ingest_complete(
        self, *, context: PluginContext, stats: dict[str, Any]
    ) -> None:
        """Called when ingestion finishes for a dataset."""

    # ------------------------------------------------------------------
    # Lifecycle hooks
    # ------------------------------------------------------------------

    def on_activate(self) -> None:
        """Called when the plugin is registered/activated."""

    def on_deactivate(self) -> None:
        """Called when the plugin is being shut down."""
