---
phase: 12-interactive-viz-discovery
plan: 02
subsystem: api, ui
tags: [confusion-matrix, iou-matching, drilldown, sampleIdFilter, discovery-filter]

# Dependency graph
requires:
  - phase: 12-interactive-viz-discovery
    provides: sampleIdFilter mechanism in filter-store (plan 01)
  - phase: 04-predictions-comparison
    provides: evaluation endpoint with confusion matrix
provides:
  - GET /datasets/{id}/confusion-cell-samples endpoint mapping CM cells to sample IDs
  - Clickable confusion matrix cells that filter grid to matching samples
  - fetchConfusionCellSamples imperative fetch function
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Confusion cell drilldown: CM cell click -> fetchConfusionCellSamples -> setSampleIdFilter -> grid"
    - "Greedy IoU matching for per-sample cell membership (reuses _load_detections, _build_detections, _compute_iou_matrix)"

key-files:
  created:
    - frontend/src/hooks/use-confusion-cell.ts
  modified:
    - app/models/evaluation.py
    - app/services/evaluation.py
    - app/routers/statistics.py
    - frontend/src/components/stats/confusion-matrix.tsx
    - frontend/src/components/stats/evaluation-panel.tsx

key-decisions:
  - "Imperative fetch function (not React hook) for confusion cell samples -- action-triggered, not reactive"
  - "Greedy IoU matching replayed per sample to determine cell membership (consistent with supervision ConfusionMatrix)"
  - "getState() pattern for store writes in async callback (non-reactive, avoids stale closures)"

patterns-established:
  - "Confusion matrix drilldown pattern: onCellClick prop -> async fetch -> setSampleIdFilter + setActiveTab('grid')"

# Metrics
duration: 3min
completed: 2026-02-13
---

# Phase 12 Plan 02: Confusion Matrix Cell Drilldown Summary

**Clickable confusion matrix cells with backend IoU matching that filters grid to samples matching any GT/predicted class pair**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-13T14:24:05Z
- **Completed:** 2026-02-13T14:27:13Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Backend endpoint GET /datasets/{id}/confusion-cell-samples re-runs IoU matching per sample to return sample IDs for any (actual_class, predicted_class) pair
- Handles "background" class correctly: FPs (actual=background), FNs (predicted=background), and true matches
- Confusion matrix cells with non-zero counts are clickable with hover ring indicator
- Clicking a cell fetches matching sample IDs, sets sampleIdFilter, and switches to grid tab automatically

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend confusion-cell-samples endpoint** - `90ed37a` (feat)
2. **Task 2: Frontend confusion matrix cell click -> grid filter** - `9dc1e39` (feat)

## Files Created/Modified
- `app/models/evaluation.py` - Added ConfusionCellSamplesResponse model
- `app/services/evaluation.py` - Added get_confusion_cell_samples function with greedy IoU matching
- `app/routers/statistics.py` - Added GET /datasets/{id}/confusion-cell-samples endpoint
- `frontend/src/hooks/use-confusion-cell.ts` - New imperative fetch function for confusion cell samples
- `frontend/src/components/stats/confusion-matrix.tsx` - Added onCellClick prop with cursor-pointer and hover ring on non-zero cells
- `frontend/src/components/stats/evaluation-panel.tsx` - Added handleCellClick callback wiring CM clicks to sampleIdFilter and grid tab

## Decisions Made
- Used imperative fetch function rather than a React Query hook since the action is user-triggered (click), not reactive data -- avoids unnecessary query cache entries for one-shot operations
- Replayed greedy IoU matching per sample (same algorithm as supervision ConfusionMatrix) to ensure cell membership is consistent with what the matrix displays
- Used getState() pattern for Zustand store writes in async callback to avoid stale closure issues

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Confusion matrix drilldown complete, all cells clickable
- Plan 03 (near-duplicate detection) can reuse the same sampleIdFilter pipeline
- DiscoveryFilterChip from plan 01 automatically shows count when confusion cell filter is active

---
*Phase: 12-interactive-viz-discovery*
*Completed: 2026-02-13*
