---
phase: 03-filtering-search
plan: 01
subsystem: api, ui
tags: [duckdb, fastapi, zustand, tanstack-query, filter-builder, facets, sidebar, parameterized-sql]

# Dependency graph
requires:
  - phase: 01-data-foundation
    provides: "DuckDB schema, samples/annotations tables, API routers, Pydantic models"
  - phase: 02-visual-grid
    provides: "Next.js app, TanStack Query infinite scroll grid, Zustand UI store, useSamples hook"
provides:
  - SampleFilterBuilder service for parameterized dynamic SQL query construction
  - GET /samples extended with search, tags, sort_by, sort_dir params
  - GET /samples/filter-facets endpoint returning distinct categories, splits, tags
  - tags VARCHAR[] column on samples table, saved_views table schema
  - Zustand filter-store with atomic selectors driving TanStack Query refetch
  - FilterSidebar component with category and split dropdowns
  - useFilterFacets hook with 5-min staleTime
  - apiPost, apiPatch, apiDelete helpers for mutations
affects: [03-02 search/sort/saved-views/tagging, 04-01 predictions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SampleFilterBuilder: builder-pattern dynamic SQL with parameterized queries and column allowlist"
    - "Filter state in TanStack Query queryKey for declarative refetch-on-filter-change"
    - "Atomic Zustand selectors for individual filter fields to minimize re-renders"
    - "Filter facets endpoint with per-dataset queryKey and 5-min staleTime"

key-files:
  created:
    - app/services/filter_builder.py
    - frontend/src/stores/filter-store.ts
    - frontend/src/types/filter.ts
    - frontend/src/hooks/use-filter-facets.ts
    - frontend/src/components/filters/filter-sidebar.tsx
    - frontend/src/components/filters/filter-select.tsx
  modified:
    - app/repositories/duckdb_repo.py
    - app/models/sample.py
    - app/routers/samples.py
    - app/services/ingestion.py
    - tests/test_health.py
    - frontend/src/hooks/use-samples.ts
    - frontend/src/types/sample.ts
    - frontend/src/components/grid/image-grid.tsx
    - frontend/src/app/datasets/[datasetId]/page.tsx
    - frontend/src/lib/api.ts

key-decisions:
  - "Individual Query() params (not Pydantic Query model) for filter endpoint -- matches existing codebase pattern and avoids FastAPI version concerns"
  - "Filter facets queryKey uses only datasetId (not filter state) to avoid N+1 refetches"
  - "Sorted tags array in queryKey for structural stability"
  - "Removed fixed height from grid scroll container in favor of flex-1 (parent flex handles height)"

patterns-established:
  - "SampleFilterBuilder: chain add_dataset().add_split().add_category().add_search().add_tags().build(sort_by, sort_dir)"
  - "Filter sidebar pattern: FilterSidebar reads facets + store state, FilterSelect is pure controlled component"
  - "Explicit column names in ingestion INSERT to avoid column count mismatch after schema migration"

# Metrics
duration: 5min
completed: 2026-02-11
---

# Phase 3 Plan 1: Filter Infrastructure Summary

**SampleFilterBuilder for parameterized dynamic SQL, extended samples endpoint with search/tags/sort, filter-facets endpoint, and Zustand-driven FilterSidebar with category/split dropdowns**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-11T13:31:40Z
- **Completed:** 2026-02-11T13:37:03Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- SampleFilterBuilder constructs parameterized SQL with all filter types (dataset, split, category, search, tags, sort) using builder pattern with SQL injection prevention via column allowlist
- GET /samples extended with search, tags, sort_by, sort_dir query params; refactored from inline SQL to SampleFilterBuilder
- GET /samples/filter-facets returns distinct categories, splits, and tags for populating filter dropdowns
- Zustand filter-store manages all filter state with atomic selectors, driving automatic TanStack Query refetch via queryKey
- FilterSidebar renders category and split dropdowns populated from the facets endpoint
- Schema migration adds tags VARCHAR[] to samples and creates saved_views table
- All 55 existing backend tests pass with no regressions
- Frontend builds with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend filter infrastructure** - `89ef3cf` (feat)
2. **Task 2: Frontend filter sidebar** - `9286df9` (feat)

## Files Created/Modified
- `app/services/filter_builder.py` - SampleFilterBuilder with FilterResult dataclass, parameterized query construction
- `app/repositories/duckdb_repo.py` - Schema migration: tags column on samples, saved_views table
- `app/models/sample.py` - SampleResponse.tags field, SampleFilterParams model
- `app/routers/samples.py` - Extended list_samples with SampleFilterBuilder, added filter-facets endpoint
- `app/services/ingestion.py` - Explicit column names in INSERT for compatibility with new tags column
- `tests/test_health.py` - Updated table count test for saved_views table
- `frontend/src/stores/filter-store.ts` - Zustand filter state with atomic selectors and clearFilters
- `frontend/src/types/filter.ts` - FilterFacets interface
- `frontend/src/types/sample.ts` - Added tags field to Sample interface
- `frontend/src/hooks/use-samples.ts` - Filter state in queryKey, URLSearchParams construction
- `frontend/src/hooks/use-filter-facets.ts` - useQuery with 5-min staleTime for facet data
- `frontend/src/components/filters/filter-sidebar.tsx` - Sidebar with category/split FilterSelect components
- `frontend/src/components/filters/filter-select.tsx` - Reusable single-select dropdown
- `frontend/src/components/grid/image-grid.tsx` - Removed fixed height, flex-1 for layout
- `frontend/src/app/datasets/[datasetId]/page.tsx` - Flex row layout with FilterSidebar + ImageGrid
- `frontend/src/lib/api.ts` - Added apiPost, apiPatch, apiDelete helpers

## Decisions Made
- Used individual Query() params instead of Pydantic Query Parameter Model to match existing codebase pattern and avoid FastAPI version dependency
- Filter facets use dataset-only queryKey (not filter-dependent) to prevent unnecessary refetches when filters change
- Tags array sorted in queryKey for structural stability across renders
- Removed fixed `calc(100vh - 120px)` height from grid container in favor of flexbox layout management

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ingestion INSERT column count mismatch**
- **Found during:** Task 1
- **Issue:** Adding `tags` column to samples table (9 columns) broke `INSERT INTO samples SELECT * FROM batch_df` (8 columns from DataFrame)
- **Fix:** Changed to explicit column list: `INSERT INTO samples (id, dataset_id, ..., metadata) SELECT * FROM batch_df`
- **Files modified:** app/services/ingestion.py
- **Verification:** All 55 tests pass
- **Committed in:** 89ef3cf (Task 1 commit)

**2. [Rule 1 - Bug] Updated table count test for new saved_views table**
- **Found during:** Task 1
- **Issue:** `test_db_creates_four_tables` asserted exactly 4 tables; schema now creates 5 (added saved_views)
- **Fix:** Updated assertion to include `saved_views` in expected table list, renamed test to `test_db_creates_all_tables`
- **Files modified:** tests/test_health.py
- **Verification:** Test passes with updated assertion
- **Committed in:** 89ef3cf (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness after schema migration. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Filter infrastructure complete: backend SampleFilterBuilder + frontend Zustand store + FilterSidebar
- Ready for Plan 03-02: search input, sort controls, saved views CRUD, bulk tagging
- apiPost/apiPatch/apiDelete helpers already created for mutation endpoints
- saved_views table schema already in place for saved views CRUD
- tags column on samples ready for bulk tagging operations

---
*Phase: 03-filtering-search*
*Completed: 2026-02-11*
