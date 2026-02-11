"""Example plugin demonstrating the data-visor hook API.

This plugin subclasses :class:`BasePlugin` and overrides all ingestion
hooks to show how the plugin contract works.  It serves as both a
reference implementation and a smoke-test for the plugin system.
"""

from __future__ import annotations

import logging
from typing import Any

from app.plugins.base_plugin import BasePlugin, PluginContext

logger = logging.getLogger(__name__)


class ExamplePlugin(BasePlugin):
    """A demonstration plugin that logs ingestion events."""

    @property
    def name(self) -> str:
        return "example"

    @property
    def description(self) -> str:
        return "Example plugin demonstrating the hook API"

    # ------------------------------------------------------------------
    # Ingestion hooks
    # ------------------------------------------------------------------

    def on_ingest_start(self, *, context: PluginContext) -> None:
        logger.info(
            "Example plugin: ingestion starting for %s",
            context.dataset_id,
        )

    def on_sample_ingested(
        self, *, context: PluginContext, sample: dict[str, Any]
    ) -> dict[str, Any]:
        sample["processed_by_example"] = True
        return sample

    def on_ingest_complete(
        self, *, context: PluginContext, stats: dict[str, Any]
    ) -> None:
        logger.info(
            "Example plugin: ingestion complete for %s -- stats: %s",
            context.dataset_id,
            stats,
        )

    # ------------------------------------------------------------------
    # Lifecycle hooks
    # ------------------------------------------------------------------

    def on_activate(self) -> None:
        logger.info("Example plugin activated")

    def on_deactivate(self) -> None:
        logger.info("Example plugin deactivated")
