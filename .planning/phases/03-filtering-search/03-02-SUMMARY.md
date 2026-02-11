---
phase: 03-filtering-search
plan: 02
subsystem: api, ui
tags: [duckdb, fastapi, zustand, tanstack-query, saved-views, bulk-tagging, search, sort, debounce]

# Dependency graph
requires:
  - phase: 03-filtering-search
    plan: 01
    provides: "SampleFilterBuilder, extended samples endpoint, filter-facets endpoint, Zustand filter store, FilterSidebar, apiPost/apiPatch/apiDelete helpers, saved_views table schema, tags column on samples"
provides:
  - Saved views CRUD endpoints (POST/GET/DELETE /views)
  - Bulk tagging endpoints (PATCH /samples/bulk-tag, /samples/bulk-untag)
  - SearchInput component with 300ms debounce
  - SortControls component with field dropdown and direction toggle
  - SavedViewPicker component with load/save/delete
  - useSavedViews, useCreateView, useDeleteView hooks
  - useBulkTag, useBulkUntag mutation hooks
  - Selection state in filter store (selectedSampleIds, isSelecting)
  - Tag badges on grid cells
  - Floating selection action bar in image grid
affects: [04-01 predictions, 05-01 embeddings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Saved views: JSON-serialized filter state in DuckDB, CRUD via FastAPI router"
    - "Bulk tagging: DuckDB list_distinct(list_append(COALESCE(tags, []), ?)) for idempotent tag add"
    - "Debounced search: local state + setTimeout sync to Zustand store"
    - "Selection mode: UI-only state in filter store, not included in query key"

key-files:
  created:
    - app/models/view.py
    - app/routers/views.py
    - frontend/src/types/view.ts
    - frontend/src/hooks/use-saved-views.ts
    - frontend/src/hooks/use-tags.ts
    - frontend/src/components/filters/search-input.tsx
    - frontend/src/components/filters/sort-controls.tsx
    - frontend/src/components/filters/saved-view-picker.tsx
  modified:
    - app/models/sample.py
    - app/routers/samples.py
    - app/main.py
    - frontend/src/stores/filter-store.ts
    - frontend/src/components/filters/filter-sidebar.tsx
    - frontend/src/components/grid/grid-cell.tsx
    - frontend/src/components/grid/image-grid.tsx

key-decisions:
  - "Bulk tag/untag endpoints placed before /{sample_id}/annotations route to avoid FastAPI path conflicts"
  - "Selection state (selectedSampleIds, isSelecting) excluded from TanStack Query key to avoid unnecessary refetches"
  - "Exiting select mode automatically clears selection to prevent stale state"
  - "Tag badges show max 3 with +N more indicator to prevent layout overflow"

patterns-established:
  - "Saved view persistence: serialize filter state as JSON, store in DuckDB, load via applyView"
  - "Bulk operations: cap at 500 IDs per request, parameterized IN clause with placeholders"
  - "Checkbox selection: isSelecting toggle gate, toggleSampleSelection per-cell, selectAllVisible for batch"
  - "Debounce pattern: local state for immediate feedback, useEffect+setTimeout for store sync"

# Metrics
duration: 5min
completed: 2026-02-11
---

# Phase 3 Plan 2: Search, Sort, Saved Views, and Bulk Tagging Summary

**Debounced filename search, multi-column sorting, saved view CRUD with JSON filter persistence, and checkbox-based bulk tagging with tag badges on grid cells**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-11T13:39:38Z
- **Completed:** 2026-02-11T13:44:30Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments
- Saved views CRUD: create named filter views (POST), list by dataset (GET), delete (DELETE) with JSON-serialized filter state in DuckDB
- Bulk tagging: add tag to multiple samples (PATCH /samples/bulk-tag) and remove tag (PATCH /samples/bulk-untag) using DuckDB list functions with COALESCE for NULL safety
- Debounced search input (300ms) with bidirectional sync between local state and Zustand store
- Sort controls with field dropdown (id/file_name/width/height) and ASC/DESC direction toggle
- Saved view picker with dropdown listing, save-current prompt, delete button, and filter state restoration
- Selection mode with checkbox overlays on grid cells, floating action bar with "Select All Visible" and "Clear Selection"
- Tag badges on grid cells (max 3 visible + "+N more" indicator)
- All 55 backend tests pass, frontend builds with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend saved views CRUD and bulk tagging endpoints** - `5a18137` (feat)
2. **Task 2: Frontend search, sort, saved views, and bulk tagging UI** - `ce2fc78` (feat)

## Files Created/Modified
- `app/models/view.py` - SavedViewCreate, SavedViewResponse, SavedViewListResponse models
- `app/routers/views.py` - Saved views CRUD endpoints (POST/GET/DELETE)
- `app/models/sample.py` - Added BulkTagRequest model
- `app/routers/samples.py` - Added PATCH /samples/bulk-tag and /samples/bulk-untag endpoints
- `app/main.py` - Registered views router
- `frontend/src/types/view.ts` - SavedView and SavedViewList interfaces
- `frontend/src/stores/filter-store.ts` - Extended with selectedSampleIds, isSelecting, and selection actions
- `frontend/src/components/filters/search-input.tsx` - Debounced search input component
- `frontend/src/components/filters/sort-controls.tsx` - Sort field and direction controls
- `frontend/src/components/filters/saved-view-picker.tsx` - Saved view dropdown with save/delete/load
- `frontend/src/components/filters/filter-sidebar.tsx` - Integrated search, sort, saved views, select mode, bulk tag panel
- `frontend/src/hooks/use-saved-views.ts` - useSavedViews, useCreateView, useDeleteView hooks
- `frontend/src/hooks/use-tags.ts` - useBulkTag, useBulkUntag mutation hooks
- `frontend/src/components/grid/grid-cell.tsx` - Selection checkbox overlay, tag badges, click mode toggle
- `frontend/src/components/grid/image-grid.tsx` - Floating selection action bar with Select All/Clear

## Decisions Made
- Bulk tag/untag endpoints defined before `/{sample_id}/annotations` route to avoid FastAPI path parameter conflicts
- Selection state (selectedSampleIds, isSelecting) kept as UI-only state, excluded from TanStack Query queryKey
- Exiting select mode automatically clears the selection set to prevent stale selections
- Tag badges limited to 3 visible with "+N more" indicator to prevent cell layout overflow
- window.prompt used for save-view name input (simple, no modal component needed for v1)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 (Filtering & Search) is now complete: all 4 FILT requirements delivered
  - FILT-01: Category/split/tags sidebar filtering (03-01)
  - FILT-02: Search by filename + column sorting (03-02)
  - FILT-03: Saved views with JSON filter persistence (03-02)
  - FILT-04: Bulk tagging with checkbox selection (03-02)
- Ready for Phase 4 (Predictions & Comparison) or Phase 5 (Embeddings & Visualization)
- Phases 4 and 5 are independent and can execute in parallel

---
*Phase: 03-filtering-search*
*Completed: 2026-02-11*
