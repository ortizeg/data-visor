---
phase: 11-error-triage
plan: 01
subsystem: api
tags: [fastapi, duckdb, tanstack-query, triage, error-analysis]

# Dependency graph
requires:
  - phase: 06-error-analysis
    provides: categorize_errors service and ErrorAnalysisResponse model
provides:
  - PATCH /samples/set-triage-tag endpoint with atomic tag replacement
  - DELETE /samples/{sample_id}/triage-tag endpoint
  - GET /datasets/{dataset_id}/worst-images endpoint with composite scoring
  - useSetTriageTag, useRemoveTriageTag, useWorstImages frontend hooks
  - TriageScore, WorstImagesResponse, TRIAGE_OPTIONS, TriageTag types
affects: [11-02-triage-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic triage tag replacement via list_filter + list_append single SQL"
    - "Composite scoring: 0.6 * norm_errors + 0.4 * norm_confidence_spread"
    - "Dual router export pattern (samples_router + datasets_router) from single module"

key-files:
  created:
    - app/models/triage.py
    - app/services/triage.py
    - app/routers/triage.py
    - frontend/src/types/triage.ts
    - frontend/src/hooks/use-triage.ts
  modified:
    - app/main.py

key-decisions:
  - "TRIAGE_PREFIX = 'triage:' with VALID_TRIAGE_TAGS set for validation"
  - "Dual router pattern: samples_router for /samples endpoints, datasets_router for /datasets endpoints"
  - "get_db DI pattern (not get_cursor) matching statistics router style"

patterns-established:
  - "Atomic tag replacement: list_filter to remove prefix-matching tags + list_append in single UPDATE"
  - "Composite scoring from existing error analysis pipeline (no new DB queries)"

# Metrics
duration: 3min
completed: 2026-02-13
---

# Phase 11 Plan 01: Triage Infrastructure Summary

**Backend triage endpoints (set-tag, remove-tag, worst-images) with composite error scoring service and frontend TanStack Query hooks**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T04:41:24Z
- **Completed:** 2026-02-13T04:44:31Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Three new backend endpoints: PATCH set-triage-tag (atomic replacement), DELETE remove-triage-tag, GET worst-images (composite scoring)
- Triage service computing 60/40 weighted score from error_count and confidence_spread via existing categorize_errors pipeline
- Frontend types (TriageScore, WorstImagesResponse, TRIAGE_OPTIONS, TriageTag) and hooks (useSetTriageTag, useRemoveTriageTag, useWorstImages) with proper cache invalidation

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend triage models, service, and router** - `7c0adff` (feat)
2. **Task 2: Frontend triage types and hooks** - `de40151` (feat)

## Files Created/Modified
- `app/models/triage.py` - SetTriageTagRequest, TriageScore, WorstImagesResponse models + TRIAGE_PREFIX/VALID_TRIAGE_TAGS constants
- `app/services/triage.py` - compute_worst_images scoring with categorize_errors pipeline
- `app/routers/triage.py` - samples_router (set-triage-tag, remove-triage-tag) + datasets_router (worst-images)
- `app/main.py` - Added triage router imports and registration
- `frontend/src/types/triage.ts` - TriageScore, WorstImagesResponse, TRIAGE_OPTIONS, TriageTag
- `frontend/src/hooks/use-triage.ts` - useSetTriageTag, useRemoveTriageTag, useWorstImages hooks

## Decisions Made
- Used dual router export pattern (samples_router + datasets_router) to keep triage endpoints under both /samples and /datasets namespaces from a single module
- Used get_db DI pattern (not get_cursor) matching existing statistics.py router style with manual cursor management in try/finally
- TRIAGE_PREFIX constant enables extensibility for future triage tag categories

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing test failure in `tests/test_coco_parser.py::test_build_image_batches_columns` (extra `image_dir` column). Unrelated to triage changes -- confirmed by running test on stashed state.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All triage data layer (backend + frontend hooks) ready for Plan 02's UI components
- useSetTriageTag and useRemoveTriageTag hooks provide cache invalidation for samples and filter-facets
- useWorstImages provides ranked sample fetching with threshold parameters
- TRIAGE_OPTIONS constant provides UI-ready tag definitions with color classes

---
*Phase: 11-error-triage*
*Completed: 2026-02-13*
