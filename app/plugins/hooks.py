"""Hook name constants for the plugin system.

Centralizes hook names so registry and tests reference constants,
not magic strings. All plugin hooks are defined here.
"""

from __future__ import annotations

# Ingestion hooks
HOOK_INGEST_START: str = "on_ingest_start"
HOOK_SAMPLE_INGESTED: str = "on_sample_ingested"
HOOK_INGEST_COMPLETE: str = "on_ingest_complete"

# Lifecycle hooks
HOOK_ACTIVATE: str = "on_activate"
HOOK_DEACTIVATE: str = "on_deactivate"

# All hooks in invocation order (lifecycle first, then ingestion)
ALL_HOOKS: list[str] = [
    HOOK_ACTIVATE,
    HOOK_INGEST_START,
    HOOK_SAMPLE_INGESTED,
    HOOK_INGEST_COMPLETE,
    HOOK_DEACTIVATE,
]
