---
phase: 12-interactive-viz-discovery
plan: 01
subsystem: ui
tags: [zustand, recharts, tanstack-query, discovery-filter, similarity]

# Dependency graph
requires:
  - phase: 05-embeddings-visualization
    provides: similarity search API and useSimilarity hook
  - phase: 06-error-analysis-similarity
    provides: similarity panel in detail modal
provides:
  - sampleIdFilter state in filter-store (shared discovery filter mechanism)
  - "Show in Grid" button piping similarity results to grid
  - clickable histogram bars filtering by category
  - DiscoveryFilterChip component for active filter indication
affects: [12-02 confusion-matrix-drilldown, 12-03 near-duplicate-detection]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discovery filter pattern: sampleIdFilter in filter-store -> effectiveIds in use-samples -> sample_ids query param"
    - "Lasso priority over discovery filter: effectiveIds = lassoSelectedIds ?? sampleIdFilter"

key-files:
  created:
    - frontend/src/components/grid/discovery-filter-chip.tsx
  modified:
    - frontend/src/stores/filter-store.ts
    - frontend/src/hooks/use-samples.ts
    - frontend/src/components/detail/sample-modal.tsx
    - frontend/src/components/stats/class-distribution.tsx
    - frontend/src/components/stats/stats-dashboard.tsx
    - frontend/src/app/datasets/[datasetId]/page.tsx

key-decisions:
  - "Lasso selection takes priority over discovery filter when both active (effectiveIds = lassoSelectedIds ?? sampleIdFilter)"
  - "Show in Grid button only appears after similarity results are loaded (not alongside Find Similar)"
  - "Bar click handler uses getState() pattern for non-reactive store access in event handlers"
  - "DiscoveryFilterChip placed in dataset page header for cross-tab visibility"

patterns-established:
  - "Discovery filter output: all discovery features write to sampleIdFilter, use-samples reads it"
  - "Interactive chart pattern: Recharts onClick -> useFilterStore.getState().setFilter -> useUIStore.getState().setActiveTab('grid')"

# Metrics
duration: 3min
completed: 2026-02-13
---

# Phase 12 Plan 01: Discovery Filter Foundation Summary

**sampleIdFilter mechanism in filter-store with Find Similar grid piping and clickable histogram bars**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T14:18:04Z
- **Completed:** 2026-02-13T14:21:17Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Established shared sampleIdFilter discovery filter pattern that all Phase 12 features pipe through
- "Show in Grid" button in detail modal pipes similarity results to grid view via sampleIdFilter
- Class distribution histogram bars are clickable, setting category filter and switching to grid tab
- DiscoveryFilterChip shows active filter count with clear button, visible across all tabs

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sampleIdFilter to filter-store and wire into use-samples** - `5dc566c` (feat)
2. **Task 2: Wire Find Similar to grid filter + make histogram bars clickable** - `27bf5d8` (feat)

## Files Created/Modified
- `frontend/src/stores/filter-store.ts` - Added sampleIdFilter state, setSampleIdFilter, clearSampleIdFilter actions, useSampleIdFilter selector
- `frontend/src/hooks/use-samples.ts` - Merged sampleIdFilter with lassoSelectedIds into effectiveIds for query
- `frontend/src/components/grid/discovery-filter-chip.tsx` - New component showing active discovery filter with clear button
- `frontend/src/app/datasets/[datasetId]/page.tsx` - Wired DiscoveryFilterChip into header for cross-tab visibility
- `frontend/src/components/detail/sample-modal.tsx` - Added "Show in Grid" button after similarity results load
- `frontend/src/components/stats/class-distribution.tsx` - Added onClick handlers to GT and Prediction bars
- `frontend/src/components/stats/stats-dashboard.tsx` - Added hint text below class distribution chart

## Decisions Made
- Lasso selection takes priority over discovery filter when both active -- this prevents confusion when user has both a spatial selection and a discovery filter
- "Show in Grid" button only appears after similarity results are loaded, keeping the UI progressive
- Used `getState()` pattern for store access in event handlers (non-reactive, avoids unnecessary re-renders)
- Placed DiscoveryFilterChip in the dataset page header so it is visible regardless of active tab

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- sampleIdFilter mechanism ready for Plans 02 (confusion matrix drilldown) and 03 (near-duplicate detection) to write IDs
- Both future plans just need to call `setSampleIdFilter(ids)` to filter the grid
- DiscoveryFilterChip automatically shows for any discovery filter

---
*Phase: 12-interactive-viz-discovery*
*Completed: 2026-02-13*
