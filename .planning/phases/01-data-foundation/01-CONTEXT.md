# Phase 1: Data Foundation - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the ingestion pipeline that loads COCO datasets from local disk or GCS into DuckDB, generates and caches thumbnails, serves images via API, and provides a BasePlugin extension point. This phase delivers the data layer that all subsequent phases build on. No UI — just backend + API.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User delegated all Phase 1 implementation decisions to Claude. This is a foundational infrastructure phase — use research findings to guide choices.

Key decisions to resolve during planning/implementation:

**Ingestion experience:**
- How users trigger import (CLI command, API endpoint, or both)
- Progress feedback mechanism during 100K+ imports
- Error handling and partial failure recovery

**Data model & schema:**
- DuckDB table schema for samples, annotations, metadata
- How COCO categories, images, and annotations map to tables
- Whether metadata columns are fixed or extensible (JSON column vs flat columns)

**Image storage strategy:**
- Thumbnail sizes, format (WebP vs JPEG), and cache location
- GCS access pattern (stream on demand vs local cache)
- Image serving endpoint design

**Plugin contract:**
- BasePlugin interface (what methods to override)
- Hook registration mechanism
- Plugin discovery and loading pattern
- Minimal v1 scope (ingestion hooks only, or broader)

**Guiding research:**
- DuckDB single-writer with cursor-per-request (from STACK research)
- Streaming COCO parsing with ijson to avoid OOM (from PITFALLS research)
- Thumbnail proxy with LRU cache (from ARCHITECTURE research)
- Single Uvicorn worker constraint (from ARCHITECTURE research)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches informed by research. The user's stack choices (FastAPI, DuckDB, Qdrant, Pydantic AI) are locked.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-data-foundation*
*Context gathered: 2026-02-10*
