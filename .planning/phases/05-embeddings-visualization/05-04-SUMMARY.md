---
phase: 05-embeddings-visualization
plan: 04
subsystem: ui, api
tags: [lasso, point-in-polygon, robust-point-in-polygon, deck.gl, zustand, cross-filter, scatter-plot, embedding]

# Dependency graph
requires:
  - phase: 05-03
    provides: "deck.gl scatter plot with OrthographicView and ScatterplotLayer"
  - phase: 01-01
    provides: "SampleFilterBuilder and DuckDB query infrastructure"
  - phase: 03-01
    provides: "useSamples hook with filter store integration"
provides:
  - "SVG lasso overlay for freehand polygon selection on scatter plot"
  - "robust-point-in-polygon hit testing with bbox pre-filter"
  - "Zustand embedding store for lasso selection state"
  - "Backend sample_ids filter on GET /samples endpoint"
  - "Cross-filter wiring: scatter plot lasso -> grid view"
affects: [06-smart-views, 07-intelligence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-filter via separate Zustand stores (embedding-store + filter-store) combined in useSamples"
    - "SVG overlay on deck.gl with viewport.project() for screen coordinate mapping"
    - "Bounding-box pre-filter before point-in-polygon for O(k*m) instead of O(n*m)"

key-files:
  created:
    - frontend/src/components/embedding/lasso-overlay.tsx
    - frontend/src/stores/embedding-store.ts
  modified:
    - frontend/src/components/embedding/embedding-scatter.tsx
    - frontend/src/components/embedding/embedding-panel.tsx
    - frontend/src/hooks/use-samples.ts
    - app/routers/samples.py
    - app/services/filter_builder.py

key-decisions:
  - "Lasso selection lives in embedding-store, NOT filter-store -- spatial vs metadata separation"
  - "useSamples is single integration point reading both stores"
  - "sample_ids cap at 5000 (vs 200 for batch-annotations) for large cluster selection"
  - "DeckGLRef forwarded through scatter component for viewport.project() access"
  - "SVG overlay with pointerEvents toggle (active: all, inactive: none)"

patterns-established:
  - "Cross-filter pattern: separate domain stores combined at query hook level"
  - "deck.gl ref forwarding for viewport coordinate projection"

# Metrics
duration: 4min
completed: 2026-02-12
---

# Phase 5 Plan 4: Lasso Selection & Cross-Filter Summary

**SVG lasso overlay with robust-point-in-polygon hit testing and cross-filter wiring from scatter plot to image grid via Zustand embedding store**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-12T02:32:31Z
- **Completed:** 2026-02-12T02:36:48Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Freehand SVG lasso polygon drawing on scatter plot with bbox pre-filter + robust-point-in-polygon
- Cross-filter from embedding scatter to grid: lasso selection triggers filtered grid view
- Backend sample_ids filter composing with existing category/split/search/tags filters
- Selection-aware scatter plot coloring (indigo for selected, gray for unselected)
- Lasso toggle + clear buttons with selected count badge in toolbar

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend sample_ids filter and Zustand embedding store** - `f9bf861` (feat)
2. **Task 2: Lasso overlay component and cross-filter wiring** - `25def69` (feat)

## Files Created/Modified
- `frontend/src/components/embedding/lasso-overlay.tsx` - SVG overlay for freehand lasso polygon with point-in-polygon testing
- `frontend/src/stores/embedding-store.ts` - Zustand store for lasso selection state (null = no filter)
- `frontend/src/components/embedding/embedding-scatter.tsx` - Selection-aware getFillColor + deckRef forwarding
- `frontend/src/components/embedding/embedding-panel.tsx` - Lasso toggle/clear buttons, selection count badge
- `frontend/src/hooks/use-samples.ts` - Cross-filter: reads lassoSelectedIds, passes sample_ids param
- `app/routers/samples.py` - sample_ids query parameter (max 5000)
- `app/services/filter_builder.py` - add_sample_ids method on SampleFilterBuilder

## Decisions Made
- Lasso selection in embedding-store, not filter-store: spatial selection and metadata filters are separate domains, combined only at the query hook level (useSamples)
- sample_ids capped at 5000 (not 200 like batch-annotations) because lasso can span large clusters
- DeckGLRef forwarded through EmbeddingScatter via prop (not forwardRef) for simpler API
- Mouse event throttling (every 3rd event) during lasso drawing for smooth performance
- updateTriggers on ScatterplotLayer to force color recalculation when selection changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Embedding visualization is now complete (all 4 plans in phase 5 done)
- Lasso selection cross-filter closes the loop: see clusters -> inspect specific images
- Ready for Phase 6 (Smart Views) which can build on the embedding + filter infrastructure
- Phase 7 (Intelligence) can use embedding space for semantic search and similarity queries

---
*Phase: 05-embeddings-visualization*
*Completed: 2026-02-12*
