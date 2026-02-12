---
phase: 07-intelligence-agents
plan: 02
subsystem: api, ui
tags: [moondream2, vlm, transformers, auto-tagging, sse, fastapi, react]

# Dependency graph
requires:
  - phase: 07-intelligence-agents
    provides: VLM router stub, vlm_device config setting, app lifespan wiring
  - phase: 05-embeddings-visualization
    provides: SSE progress streaming pattern (EmbeddingService, useEmbeddingProgress)
  - phase: 03-filtering-search
    provides: samples.tags VARCHAR[] column, tag filtering infrastructure
provides:
  - VLMService with on-demand Moondream2 loading via transformers
  - POST /auto-tag endpoint (202 background task) and GET /auto-tag/progress SSE
  - AutoTagButton component with SSE progress indicator
  - Tags validated against 5-dimension controlled vocabulary
affects: [07-03 frontend intelligence UI, agent tag-error correlation tools]

# Tech tracking
tech-stack:
  added: []
  patterns: [on-demand model loading, encode-once VLM optimization, controlled vocabulary validation]

key-files:
  created:
    - app/services/vlm_service.py
    - frontend/src/types/vlm.ts
    - frontend/src/hooks/use-vlm-progress.ts
    - frontend/src/components/toolbar/auto-tag-button.tsx
  modified:
    - app/routers/vlm.py
    - app/main.py
    - app/dependencies.py
    - frontend/src/app/datasets/[datasetId]/page.tsx

key-decisions:
  - "VLM model loaded on-demand (not at startup) to avoid memory pressure with DINOv2"
  - "Encode-once optimization: encode_image() called once, query() per dimension"
  - "5 tag dimensions with controlled vocabulary; invalid VLM responses silently discarded"
  - "Tags merged via list_distinct(list_concat(...)) to preserve user-applied tags"
  - "AutoTagButton invalidates both samples and filter-facets caches on completion"

patterns-established:
  - "On-demand model loading pattern: _ensure_model() lazy init for memory-intensive models"
  - "Controlled vocabulary validation: VALID_TAGS dict gates VLM output to known values"
  - "Frontend toolbar component pattern: button + SSE progress in dataset header"

# Metrics
duration: 4min
completed: 2026-02-12
---

# Phase 7 Plan 2: VLM Auto-Tagging Summary

**Moondream2 auto-tagging pipeline with encode-once optimization, 5-dimension controlled vocabulary, SSE progress streaming, and frontend AutoTagButton**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-12T12:35:44Z
- **Completed:** 2026-02-12T12:39:30Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created VLMService with on-demand Moondream2 loading via transformers (not at startup), encode-once optimization per image, and 5-dimension tag prompts validated against controlled vocabulary
- Replaced VLM router stub with full POST /auto-tag (202 background task) and GET /auto-tag/progress SSE endpoints following existing embedding generation pattern
- Built AutoTagButton React component with SSE progress bar, error display, and cache invalidation on completion

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement VLM service and fill router endpoints** - `4d36485` (feat)
2. **Task 2: Frontend auto-tag button with SSE progress** - `f8a17b6` (feat)

## Files Created/Modified
- `app/services/vlm_service.py` - VLMService with Moondream2 model loading, encode-once tagging, background task pipeline
- `app/routers/vlm.py` - POST /auto-tag and GET /auto-tag/progress endpoints (replaced stub)
- `app/main.py` - VLMService created in lifespan (model NOT loaded at startup)
- `app/dependencies.py` - Added get_vlm_service dependency
- `frontend/src/types/vlm.ts` - TaggingProgress TypeScript interface
- `frontend/src/hooks/use-vlm-progress.ts` - SSE EventSource hook for tagging progress
- `frontend/src/components/toolbar/auto-tag-button.tsx` - AutoTagButton with progress indicator
- `frontend/src/app/datasets/[datasetId]/page.tsx` - Added AutoTagButton to dataset page header

## Decisions Made
- **On-demand model loading:** VLMService._ensure_model() loads Moondream2 only on first tag request, avoiding ~4GB memory allocation at startup when DINOv2 is already loaded
- **Encode-once optimization:** Each image encoded once via model.encode_image(), then queried 5 times (one per tag dimension) -- 5x faster than re-encoding per prompt
- **Controlled vocabulary gates:** VALID_TAGS dict with 5 dimensions (lighting, clarity, setting, weather, density) gates VLM responses to known values; invalid answers silently discarded
- **Tags merged not overwritten:** list_distinct(list_concat(tags, new_tags)) preserves any user-applied tags while adding VLM-generated ones
- **Cache invalidation on completion:** AutoTagButton invalidates both "samples" and "filter-facets" query keys so tags appear immediately in grid and filter sidebar

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - Moondream2 is downloaded automatically from HuggingFace on first use. No API keys required (runs locally).

## Next Phase Readiness
- VLM auto-tagging fully operational, ready for Plan 03 (frontend intelligence UI)
- Agent service tag-error correlation tool can now query populated samples.tags for pattern analysis
- DATAVISOR_VLM_DEVICE config allows switching between cpu/mps/cuda

---
*Phase: 07-intelligence-agents*
*Completed: 2026-02-12*
