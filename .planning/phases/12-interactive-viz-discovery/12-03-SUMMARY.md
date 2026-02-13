---
phase: 12-interactive-viz-discovery
plan: 03
subsystem: api, ui
tags: [qdrant, union-find, sse, near-duplicates, similarity, react]

# Dependency graph
requires:
  - phase: 05-embeddings-visualization
    provides: DINOv2 embeddings in Qdrant + SimilarityService
  - phase: 12-01
    provides: Discovery filter foundation (sampleIdFilter, DiscoveryFilterChip)
provides:
  - Near-duplicate detection backend with Qdrant pairwise search and union-find grouping
  - SSE progress streaming for detection status
  - Near Duplicates sub-tab on statistics dashboard
  - Click-to-filter group browsing via sampleIdFilter
affects: [13-keyboard-shortcuts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Union-find with path compression for grouping pairwise similarity results"
    - "Background task with SSE progress for long-running detection operations"

key-files:
  created:
    - frontend/src/hooks/use-near-duplicates.ts
    - frontend/src/components/stats/near-duplicates-panel.tsx
  modified:
    - app/models/similarity.py
    - app/routers/similarity.py
    - app/services/similarity_service.py
    - frontend/src/components/stats/stats-dashboard.tsx

key-decisions:
  - "Tab bar always visible so Near Duplicates is accessible without predictions"
  - "Union-find with path compression for O(alpha(n)) grouping of pairwise matches"
  - "Progress updates throttled to every 10 points to avoid excessive state updates"

patterns-established:
  - "Near-duplicate detection: background task + SSE progress + cached results GET pattern"

# Metrics
duration: 4min
completed: 2026-02-13
---

# Phase 12 Plan 03: Near-Duplicate Detection Summary

**Qdrant pairwise similarity scan with union-find grouping, SSE progress streaming, and clickable group browsing on statistics dashboard**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T14:25:13Z
- **Completed:** 2026-02-13T14:29:11Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Backend near-duplicate detection via Qdrant pairwise search with configurable threshold (0.80-0.99)
- Union-find grouping with path compression to merge pairwise matches into groups
- SSE progress stream (scanning/grouping/complete/error) following existing embedding progress pattern
- Frontend NearDuplicatesPanel with threshold slider, progress bar, and clickable group list
- Group click sets sampleIdFilter and switches to grid tab for visual inspection
- Stats dashboard tab bar is now always visible (not gated by hasPredictions) so Near Duplicates is accessible

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend near-duplicate detection with SSE progress** - `93a8464` (feat)
2. **Task 2: Frontend near-duplicates panel with detection trigger and group browsing** - `b1af002` (feat)

## Files Created/Modified
- `app/models/similarity.py` - Added NearDuplicateGroup, NearDuplicateResponse, NearDuplicateProgress models
- `app/services/similarity_service.py` - Added find_near_duplicates with union-find, progress tracking, result caching
- `app/routers/similarity.py` - Added POST detect, GET progress (SSE), GET results endpoints
- `frontend/src/hooks/use-near-duplicates.ts` - triggerDetection, useNearDuplicateProgress (SSE), useNearDuplicateResults (TanStack Query)
- `frontend/src/components/stats/near-duplicates-panel.tsx` - UI panel with threshold slider, progress bar, group cards
- `frontend/src/components/stats/stats-dashboard.tsx` - Added near_duplicates SubTab, always-visible tab bar

## Decisions Made
- Tab bar always visible: Changed from `(hasPredictions || isLoading) &&` guard to always rendering the tab bar, since Near Duplicates works on embeddings not predictions
- Union-find with path compression: O(alpha(n)) amortized for grouping pairwise matches, standard choice for connected components
- Progress throttled every 10 points: Avoids excessive dict updates during scanning while still providing responsive progress

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Made stats dashboard tab bar always visible**
- **Found during:** Task 2 (stats-dashboard.tsx integration)
- **Issue:** The sub-tab navigation was gated by `(hasPredictions || isLoading)`, meaning Near Duplicates would be invisible for datasets without predictions
- **Fix:** Removed the conditional wrapper so tabs always render; prediction-dependent tabs remain individually disabled
- **Files modified:** frontend/src/components/stats/stats-dashboard.tsx
- **Verification:** TypeScript compiles, tab bar visible without predictions
- **Committed in:** b1af002 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for the feature to be accessible. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Near-duplicate detection complete, Phase 12 fully delivered
- All three plans (12-01 discovery filter, 12-02 confusion matrix drill-down, 12-03 near-duplicates) complete
- Ready for Phase 13: Keyboard Shortcuts

---
*Phase: 12-interactive-viz-discovery*
*Completed: 2026-02-13*
