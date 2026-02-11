"""Plugin registry for discovering, loading, and invoking plugins.

PluginRegistry is the central manager that discovers BasePlugin subclasses
from a directory, registers them, and dispatches hook calls with full error
isolation -- a failing plugin never crashes the application.
"""

from __future__ import annotations

import importlib.util
import inspect
import logging
import sys
from pathlib import Path
from typing import Any

from app.plugins.base_plugin import BasePlugin

logger = logging.getLogger(__name__)


class PluginRegistry:
    """Discovers, registers, and invokes plugin hooks.

    Plugins are stored by their ``name`` property. Hook invocations are
    wrapped in try/except so that a misbehaving plugin cannot crash the
    host application.
    """

    def __init__(self) -> None:
        self._plugins: dict[str, BasePlugin] = {}

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def discover_plugins(self, plugin_dir: Path) -> list[str]:
        """Discover and load plugins from *plugin_dir*.

        Each immediate sub-directory that contains an ``__init__.py`` is
        treated as a candidate plugin package.  The module is loaded and
        scanned for :class:`BasePlugin` subclasses which are then
        instantiated, activated, and registered.

        Returns the names of successfully discovered plugins.
        """
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            return []

        discovered: list[str] = []

        for child in sorted(plugin_dir.iterdir()):
            if not child.is_dir():
                continue
            init_file = child / "__init__.py"
            if not init_file.exists():
                continue

            try:
                module_name = f"plugins.{child.name}"
                spec = importlib.util.spec_from_file_location(
                    module_name, str(init_file)
                )
                if spec is None or spec.loader is None:
                    logger.warning(
                        "Could not create module spec for %s", child.name
                    )
                    continue

                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)

                for _attr_name, attr_value in inspect.getmembers(
                    module, inspect.isclass
                ):
                    if (
                        issubclass(attr_value, BasePlugin)
                        and attr_value is not BasePlugin
                    ):
                        instance = attr_value()
                        self._plugins[instance.name] = instance
                        instance.on_activate()
                        discovered.append(instance.name)
                        logger.info("Discovered plugin: %s", instance.name)

            except Exception:
                logger.exception(
                    "Failed to load plugin from %s", child.name
                )

        return discovered

    # ------------------------------------------------------------------
    # Manual registration
    # ------------------------------------------------------------------

    def register_plugin(self, plugin: BasePlugin) -> None:
        """Manually register a plugin instance (useful for testing)."""
        self._plugins[plugin.name] = plugin
        try:
            plugin.on_activate()
        except Exception:
            logger.exception(
                "Plugin %s raised during on_activate", plugin.name
            )

    # ------------------------------------------------------------------
    # Hook invocation
    # ------------------------------------------------------------------

    def trigger_hook(self, hook_name: str, **kwargs: Any) -> list[Any]:
        """Invoke *hook_name* on every registered plugin.

        Each call is wrapped in try/except -- a failing plugin is logged
        but never propagates its exception.  Returns a list of return
        values (one per plugin, in registration order).
        """
        results: list[Any] = []

        for plugin_name, plugin in self._plugins.items():
            method = getattr(plugin, hook_name, None)
            if method is None:
                continue
            try:
                result = method(**kwargs)
                results.append(result)
            except Exception:
                logger.exception(
                    "Plugin %s raised in hook %s",
                    plugin_name,
                    hook_name,
                )

        return results

    # ------------------------------------------------------------------
    # Lookup helpers
    # ------------------------------------------------------------------

    def get_plugin(self, name: str) -> BasePlugin | None:
        """Return a registered plugin by *name*, or ``None``."""
        return self._plugins.get(name)

    def list_plugins(self) -> list[str]:
        """Return the names of all registered plugins."""
        return list(self._plugins.keys())

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    def shutdown(self) -> None:
        """Deactivate all registered plugins.

        Each ``on_deactivate`` call is individually wrapped so that one
        plugin's failure does not prevent others from shutting down.
        """
        for plugin_name, plugin in self._plugins.items():
            try:
                plugin.on_deactivate()
            except Exception:
                logger.exception(
                    "Plugin %s raised during on_deactivate", plugin_name
                )
