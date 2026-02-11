"""Tests for the plugin system: BasePlugin, PluginContext, PluginRegistry.

Covers discovery, loading, hook invocation, error isolation, and lifecycle.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.plugins.base_plugin import BasePlugin, PluginContext
from app.plugins.hooks import (
    ALL_HOOKS,
    HOOK_ACTIVATE,
    HOOK_DEACTIVATE,
    HOOK_INGEST_COMPLETE,
    HOOK_INGEST_START,
    HOOK_SAMPLE_INGESTED,
)
from app.plugins.registry import PluginRegistry


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


class _ConcretePlugin(BasePlugin):
    """Minimal concrete plugin used only in tests."""

    @property
    def name(self) -> str:
        return "concrete"


class _FaultyPlugin(BasePlugin):
    """Plugin that raises RuntimeError in on_ingest_start."""

    @property
    def name(self) -> str:
        return "faulty"

    def on_ingest_start(self, *, context: PluginContext) -> None:
        raise RuntimeError("Intentional failure for testing")


# ------------------------------------------------------------------
# BasePlugin tests
# ------------------------------------------------------------------


class TestBasePlugin:
    def test_base_plugin_cannot_instantiate(self) -> None:
        """BasePlugin is abstract -- instantiation must raise TypeError."""
        with pytest.raises(TypeError, match="abstract"):
            BasePlugin()  # type: ignore[abstract]

    def test_concrete_plugin_instantiates(self) -> None:
        plugin = _ConcretePlugin()
        assert plugin.name == "concrete"
        assert plugin.description == ""
        assert plugin.api_version == 1

    def test_default_hooks_are_no_ops(self) -> None:
        """Non-abstract hooks have safe defaults."""
        plugin = _ConcretePlugin()
        ctx = PluginContext(dataset_id="ds-1")

        # Lifecycle no-ops return None implicitly
        assert plugin.on_activate() is None
        assert plugin.on_deactivate() is None

        # Ingestion no-ops
        assert plugin.on_ingest_start(context=ctx) is None

        sample: dict[str, Any] = {"image": "a.jpg"}
        result = plugin.on_sample_ingested(context=ctx, sample=sample)
        assert result is sample  # returns same object

        assert plugin.on_ingest_complete(context=ctx, stats={}) is None


# ------------------------------------------------------------------
# PluginContext tests
# ------------------------------------------------------------------


class TestPluginContext:
    def test_plugin_context_creation(self) -> None:
        ctx = PluginContext(dataset_id="test-dataset")
        assert ctx.dataset_id == "test-dataset"
        assert ctx.metadata is None

    def test_plugin_context_with_metadata(self) -> None:
        meta = {"source": "coco", "version": "2017"}
        ctx = PluginContext(dataset_id="coco-2017", metadata=meta)
        assert ctx.dataset_id == "coco-2017"
        assert ctx.metadata == meta


# ------------------------------------------------------------------
# ExamplePlugin tests
# ------------------------------------------------------------------


class TestExamplePlugin:
    def test_example_plugin_hooks(self) -> None:
        """ExamplePlugin overrides all ingestion hooks successfully."""
        from plugins.example_plugin import ExamplePlugin

        plugin = ExamplePlugin()
        assert plugin.name == "example"
        assert plugin.description == "Example plugin demonstrating the hook API"

        ctx = PluginContext(dataset_id="ds-ex")

        # on_ingest_start should not raise
        plugin.on_ingest_start(context=ctx)

        # on_ingest_complete should not raise
        plugin.on_ingest_complete(context=ctx, stats={"count": 42})

        # lifecycle hooks
        plugin.on_activate()
        plugin.on_deactivate()

    def test_on_sample_ingested_returns_modified(self) -> None:
        """ExamplePlugin adds 'processed_by_example' key to sample."""
        from plugins.example_plugin import ExamplePlugin

        plugin = ExamplePlugin()
        ctx = PluginContext(dataset_id="ds-mod")
        sample: dict[str, Any] = {"image": "img.jpg", "label": "cat"}

        result = plugin.on_sample_ingested(context=ctx, sample=sample)

        assert result is sample  # modifies in-place and returns
        assert result["processed_by_example"] is True
        # Original keys preserved
        assert result["image"] == "img.jpg"
        assert result["label"] == "cat"


# ------------------------------------------------------------------
# PluginRegistry tests
# ------------------------------------------------------------------


class TestPluginRegistry:
    def test_registry_discover_plugins(self) -> None:
        """Registry discovers ExamplePlugin from the plugins/ directory."""
        registry = PluginRegistry()
        plugin_dir = Path(__file__).resolve().parent.parent / "plugins"
        found = registry.discover_plugins(plugin_dir)

        assert "example" in found
        assert registry.get_plugin("example") is not None
        assert "example" in registry.list_plugins()

    def test_registry_trigger_hook(self) -> None:
        """Triggering a hook invokes the plugin and collects results."""
        from plugins.example_plugin import ExamplePlugin

        registry = PluginRegistry()
        registry.register_plugin(ExamplePlugin())

        ctx = PluginContext(dataset_id="ds-trigger")
        results = registry.trigger_hook(
            HOOK_SAMPLE_INGESTED,
            context=ctx,
            sample={"a": 1},
        )

        assert len(results) == 1
        assert results[0]["processed_by_example"] is True
        assert results[0]["a"] == 1

    def test_registry_isolates_plugin_errors(self) -> None:
        """A faulty plugin does not prevent other plugins from executing."""
        from plugins.example_plugin import ExamplePlugin

        registry = PluginRegistry()
        registry.register_plugin(_FaultyPlugin())
        registry.register_plugin(ExamplePlugin())

        ctx = PluginContext(dataset_id="ds-iso")

        # Should NOT raise, even though FaultyPlugin explodes
        results = registry.trigger_hook(HOOK_INGEST_START, context=ctx)

        # FaultyPlugin raised, so its result is not collected.
        # ExamplePlugin's on_ingest_start returns None.
        # Both executed; no exception propagated.
        assert len(results) == 1  # only ExamplePlugin succeeded

    def test_registry_empty_dir(self, tmp_path: Path) -> None:
        """discover_plugins on an empty directory returns empty list."""
        registry = PluginRegistry()
        found = registry.discover_plugins(tmp_path)
        assert found == []

    def test_registry_nonexistent_dir(self) -> None:
        """discover_plugins on a nonexistent path returns empty list."""
        registry = PluginRegistry()
        found = registry.discover_plugins(Path("/nonexistent/path"))
        assert found == []

    def test_registry_shutdown(self) -> None:
        """Shutdown calls on_deactivate for all registered plugins."""
        mock_plugin = MagicMock(spec=BasePlugin)
        mock_plugin.name = "mock"
        mock_plugin.on_activate = MagicMock()
        mock_plugin.on_deactivate = MagicMock()

        registry = PluginRegistry()
        registry.register_plugin(mock_plugin)

        mock_plugin.on_activate.assert_called_once()

        registry.shutdown()

        mock_plugin.on_deactivate.assert_called_once()

    def test_registry_get_plugin_returns_none_for_unknown(self) -> None:
        registry = PluginRegistry()
        assert registry.get_plugin("does-not-exist") is None

    def test_registry_list_plugins_empty(self) -> None:
        registry = PluginRegistry()
        assert registry.list_plugins() == []


# ------------------------------------------------------------------
# Hook constants tests
# ------------------------------------------------------------------


class TestHookConstants:
    def test_all_hooks_contains_five(self) -> None:
        assert len(ALL_HOOKS) == 5

    def test_hook_names_match_method_names(self) -> None:
        """Every hook constant corresponds to a method on BasePlugin."""
        for hook in ALL_HOOKS:
            assert hasattr(BasePlugin, hook), f"BasePlugin missing {hook}"
