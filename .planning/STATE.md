# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** A single tool that replaces scattered scripts: load any CV dataset, visually browse with annotation overlays, compare GT vs predictions, cluster via embeddings, and surface mistakes -- all in one workflow.
**Current focus:** Phase 4 complete. All three plans delivered (prediction import, comparison toggle, statistics dashboard). Ready for Phase 5 (Embeddings & Similarity).

## Current Position

Phase: 4 of 7 (Predictions & Comparison)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-02-11 -- Completed 04-03-PLAN.md

Progress: [████████████████░░░░░] 12/21

## Performance Metrics

**Velocity:**
- Total plans completed: 12
- Average duration: 4.0 min
- Total execution time: 48 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Data Foundation | 4/4 | 14 min | 3.5 min |
| 2. Visual Grid | 3/3 | 15 min | 5.0 min |
| 3. Filtering & Search | 2/2 | 10 min | 5.0 min |
| 4. Predictions & Comparison | 3/3 | 9 min | 3.0 min |

**Recent Trend:**
- Last 5 plans: 03-02 (5 min), 04-01 (3 min), 04-02 (3 min), 04-03 (3 min)
- Trend: stable, accelerating

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phases 4 (Predictions) and 5 (Embeddings) are independent and can execute in parallel
- [Roadmap]: Phase 7 (Intelligence) flagged for deeper research during planning (Pydantic AI tool design, VLM calibration)
- [Roadmap]: GRID-03 (GT vs Predictions toggle) assigned to Phase 4 rather than Phase 2 because it requires predictions to exist
- [01-01]: No PK/FK constraints on DuckDB tables for 3.8x faster bulk inserts
- [01-01]: Pydantic Settings with VISIONLENS_ env prefix and lru_cache singleton
- [01-01]: Single DuckDB connection via lifespan, cursor-per-request via DI
- [01-01]: pytest-asyncio with auto mode for async test support
- [01-02]: All plugin hooks use keyword-only arguments for forward compatibility
- [01-02]: Hook constants centralized in hooks.py to avoid magic strings
- [01-02]: Error isolation at both trigger_hook and discover_plugins levels
- [01-03]: Two-pass COCO parsing (categories, then images, then annotations) for clarity
- [01-03]: DataFrame column order explicitly matches DuckDB table order for bulk insert
- [01-03]: WebP method=4 for thumbnail generation (best speed/quality tradeoff)
- [01-04]: Sync generator for SSE (not async) -- FastAPI wraps in StreamingResponse
- [01-04]: Thumbnail generation capped at 500 during ingestion; rest on-demand
- [01-04]: Service composition via FastAPI DI (get_ingestion_service)
- [02-01]: Row-only virtualization with CSS grid columns (not dual virtualizer)
- [02-01]: Unoptimized Next.js images -- backend serves its own WebP thumbnails
- [02-01]: Simple Zustand create() pattern (not per-request) for fully client-rendered grid
- [02-01]: src/ directory structure for frontend (tsconfig @/* -> ./src/*)
- [02-02]: Batch annotations fetched at grid level from visible virtual rows, not per-cell
- [02-02]: SVG viewBox uses original image dimensions (not thumbnail) for correct coordinate mapping
- [02-02]: color-hash with saturation [0.6-0.8] and lightness [0.45-0.65] for vibrant readable colors
- [02-02]: Batch endpoint capped at 200 sample_ids per request
- [02-02]: paintOrder stroke with dark stroke behind colored text fill for readability
- [02-03]: Native <dialog> element for modal (focus trap, Escape, backdrop for free)
- [02-03]: SVG aspectMode prop: "slice" for object-cover thumbnails, "meet" for full-res modal
- [02-03]: Per-sample annotation endpoint for modal (batch not needed for single detail view)
- [03-01]: Individual Query() params (not Pydantic Query model) for filter endpoint
- [03-01]: Filter facets queryKey uses only datasetId to avoid N+1 refetches
- [03-01]: Sorted tags array in queryKey for structural stability
- [03-01]: Flex-1 layout for grid container instead of fixed calc() height
- [03-02]: Bulk tag/untag endpoints placed before /{sample_id}/annotations to avoid FastAPI path conflicts
- [03-02]: Selection state excluded from TanStack Query key (UI-only state)
- [03-02]: Exiting select mode auto-clears selection to prevent stale state
- [03-02]: Tag badges limited to 3 visible with +N more indicator
- [04-01]: Predictions stored in annotations table with source='prediction' discriminator (not separate table)
- [04-01]: Re-import deletes only source='prediction' rows, preserving ground truth
- [04-01]: PredictionParser follows same ijson streaming + DataFrame batching pattern as COCOParser
- [04-02]: Default overlayMode is "ground_truth" since predictions may not exist
- [04-02]: Annotation staleTime reduced from Infinity to 5 min (predictions can change after import)
- [04-02]: "Both" mode omits source param (returns all annotations in one request)
- [04-03]: Recharts for charting (lightweight, React-native, composable API, works with React 19)
- [04-03]: Server-side aggregation via DuckDB GROUP BY (not client-side)
- [04-03]: activeTab state in Zustand (ephemeral session state, not URL params)
- [04-03]: OverlayToggle hidden when Statistics tab active (only relevant to grid view)

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 5: SigLIP 2 vs DINOv2 decision requires benchmark spike during embedding implementation
- Phase 7: Pydantic AI tool design and VLM prompt engineering are less documented -- use research-phase before planning

## Session Continuity

Last session: 2026-02-11
Stopped at: Completed 04-03-PLAN.md (Phase 4 complete, 3/3 plans)
Resume file: None
