---
phase: 06-error-analysis-similarity
plan: 01
subsystem: api, ui
tags: [error-analysis, iou-matching, recharts, stacked-bar, object-detection]

# Dependency graph
requires:
  - phase: 04-predictions-comparison
    provides: "Predictions stored with source='prediction', evaluation service with IoU matching"
provides:
  - "Per-detection error categorization service (TP, Hard FP, Label Error, FN)"
  - "GET /datasets/{id}/error-analysis endpoint with IoU/conf threshold params"
  - "Error Analysis sub-tab in statistics dashboard with summary cards, bar chart, sample grid"
affects: [07-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Greedy IoU matching with confidence-sorted predictions for error categorization"
    - "Reusing _load_detections and _compute_iou_matrix across evaluation and error analysis services"
    - "Stacked bar chart pattern with Recharts for multi-category per-class breakdown"

key-files:
  created:
    - app/models/error_analysis.py
    - app/services/error_analysis.py
    - frontend/src/types/error-analysis.ts
    - frontend/src/hooks/use-error-analysis.ts
    - frontend/src/components/stats/error-analysis-panel.tsx
    - frontend/src/components/stats/error-samples-grid.tsx
  modified:
    - app/routers/statistics.py
    - frontend/src/components/stats/stats-dashboard.tsx

key-decisions:
  - "Import _load_detections and _compute_iou_matrix from evaluation.py directly (shared internal helpers within services package)"
  - "Cap error samples at 50 per type to avoid large payloads"
  - "Label Error marks GT as matched (prevents same GT from also being FN)"
  - "Per-class error counts keyed by predicted class for TP/Hard FP/Label Error, GT class for FN"

patterns-established:
  - "Error categorization via greedy IoU matching: TP (match+class), Label Error (match+mismatch), Hard FP (no match), FN (unmatched GT)"
  - "Color palette for error types: green (TP), red (Hard FP), amber (Label Error), orange (FN)"

# Metrics
duration: 5min
completed: 2026-02-12
---

# Phase 6 Plan 1: Error Analysis Summary

**Per-detection error categorization with greedy IoU matching, stacked bar chart, and clickable error sample grid in statistics dashboard**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-12T03:16:11Z
- **Completed:** 2026-02-12T03:21:13Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Built error categorization service classifying predictions into TP, Hard FP, Label Error, FN using IoU matching
- Added GET /datasets/{id}/error-analysis endpoint with IoU and confidence threshold parameters
- Created Error Analysis sub-tab in statistics dashboard with color-coded summary cards, per-class stacked bar chart, and clickable error sample thumbnails
- Verified counts are consistent: per-class sums match summary totals, threshold sensitivity correct

## Task Commits

Each task was committed atomically:

1. **Task 1: Error categorization service, models, and API endpoint** - `64a9840` (feat)
2. **Task 2: Error Analysis sub-tab in statistics dashboard** - `3d04bf7` (feat)

## Files Created/Modified
- `app/models/error_analysis.py` - Pydantic models: ErrorSample, PerClassErrors, ErrorSummary, ErrorAnalysisResponse
- `app/services/error_analysis.py` - categorize_errors() with greedy IoU matching algorithm
- `app/routers/statistics.py` - Added GET /datasets/{id}/error-analysis endpoint
- `frontend/src/types/error-analysis.ts` - TypeScript types mirroring backend models
- `frontend/src/hooks/use-error-analysis.ts` - TanStack Query hook with 30s staleTime
- `frontend/src/components/stats/error-analysis-panel.tsx` - Main panel with controls, summary cards, bar chart, sample grids
- `frontend/src/components/stats/error-samples-grid.tsx` - Clickable thumbnail grid per error type
- `frontend/src/components/stats/stats-dashboard.tsx` - Added Error Analysis as third sub-tab

## Decisions Made
- Imported `_load_detections` and `_compute_iou_matrix` directly from evaluation.py rather than copying (DRY, single source of truth for IoU computation)
- Label Error matching consumes the GT box (adds to matched_gt set), preventing it from also counting as a False Negative
- Error samples capped at 50 per type to prevent large API payloads; frontend deduplicates by sample_id for unique thumbnails
- Per-class counts key on predicted class for prediction-originated errors (TP, Hard FP, Label Error) and on GT class for FN

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Error Analysis tab complete, ready for Phase 6 Plan 2 (Qdrant similarity search)
- The error categorization service pattern can be extended with caching if performance becomes an issue on large datasets

---
*Phase: 06-error-analysis-similarity*
*Completed: 2026-02-12*
