---
phase: 02-visual-grid
plan: 02
subsystem: ui
tags: [svg, annotations, bounding-box, color-hash, batch-api, duckdb]

# Dependency graph
requires:
  - phase: 01-data-foundation
    provides: "DuckDB annotations table with bbox coordinates, samples with width/height"
  - phase: 02-visual-grid (plan 01)
    provides: "Next.js frontend with virtualized image grid, TanStack Query, types, API wrapper"
provides:
  - "SVG annotation overlay component rendering bounding boxes with class labels on thumbnails"
  - "Batch annotation endpoint (GET /samples/batch-annotations) returning annotations grouped by sample_id"
  - "Deterministic class-to-color hashing via color-hash library"
  - "Grid-level batch annotation fetching hook (useAnnotationsBatch)"
affects: [02-03 detail modal, 03-filtering, 04-predictions]

# Tech tracking
tech-stack:
  added: []
  patterns: ["SVG viewBox matching original image dimensions for coordinate scaling", "Batch API endpoint with comma-separated IDs and max cap", "Grid-level data fetching passed down as props (not per-cell queries)", "paintOrder stroke for readable text labels on any background"]

key-files:
  created:
    - "frontend/src/components/grid/annotation-overlay.tsx"
    - "frontend/src/hooks/use-annotations.ts"
    - "frontend/src/lib/color-hash.ts"
  modified:
    - "app/routers/samples.py"
    - "app/models/annotation.py"
    - "frontend/src/components/grid/grid-cell.tsx"
    - "frontend/src/components/grid/image-grid.tsx"
    - "frontend/src/types/annotation.ts"

key-decisions:
  - "Batch annotations fetched at grid level from visible virtual rows, not per-cell"
  - "SVG viewBox uses original image dimensions (not thumbnail) for correct coordinate mapping"
  - "color-hash with saturation [0.6-0.8] and lightness [0.45-0.65] for vibrant readable colors"
  - "Batch endpoint capped at 200 sample_ids per request"
  - "paintOrder stroke with dark stroke behind colored text fill for readability"

patterns-established:
  - "AnnotationOverlay: SVG with viewBox={originalW x originalH} + preserveAspectRatio=xMidYMid meet"
  - "useAnnotationsBatch: sorted cache keys for stable TanStack Query caching, staleTime=Infinity"
  - "Grid-level annotation fetching: ImageGrid computes visible sample IDs, fetches batch, passes map to GridCell"
  - "Batch API pattern: comma-separated IDs in query param, grouped response dict"

# Metrics
duration: 5min
completed: 2026-02-11
---

# Phase 2 Plan 2: Annotation Overlays Summary

**SVG bounding box overlays on grid thumbnails with deterministic class colors via color-hash, batch-fetched through a single endpoint per scroll position**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-11T05:25:57Z
- **Completed:** 2026-02-11T05:30:34Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Built SVG annotation overlay rendering bounding boxes with class labels on thumbnails, using viewBox for automatic coordinate scaling from original image space to thumbnail display size
- Added batch annotation endpoint (GET /samples/batch-annotations) that groups annotations by sample_id, reducing grid annotation requests from 40-80 per scroll to 1
- Created deterministic class-to-color mapping via color-hash library with tuned saturation/lightness ranges
- Wired batch fetching at grid level (ImageGrid) with annotations passed down to GridCell as props

## Task Commits

Each task was committed atomically:

1. **Task 1: Add batch annotation endpoint and create color-hash utility** - `cd19933` (feat)
2. **Task 2: Build SVG annotation overlay and wire into grid cells** - `f73030b` (feat)

## Files Created/Modified
- `frontend/src/components/grid/annotation-overlay.tsx` - SVG overlay rendering bounding boxes with class labels (79 lines)
- `frontend/src/hooks/use-annotations.ts` - Batch annotation fetching hook with sorted cache keys (35 lines)
- `frontend/src/lib/color-hash.ts` - Deterministic class-to-color mapping using color-hash library
- `app/routers/samples.py` - Added GET /samples/batch-annotations endpoint with max 200 IDs
- `app/models/annotation.py` - Added BatchAnnotationsResponse Pydantic model
- `frontend/src/components/grid/grid-cell.tsx` - Updated to accept annotations prop and render AnnotationOverlay
- `frontend/src/components/grid/image-grid.tsx` - Added grid-level batch annotation fetching for visible rows
- `frontend/src/types/annotation.ts` - Added BatchAnnotationsResponse TypeScript type

## Decisions Made
- **Batch at grid level, not per-cell:** Annotations are fetched for all visible samples in a single request at the ImageGrid level. The annotation map is passed down to GridCell as a prop. This avoids 40-80 individual annotation requests per scroll position.
- **SVG viewBox for coordinate scaling:** The SVG viewBox is set to the original image dimensions (sample.width x sample.height), not the thumbnail display size. This means annotation coordinates (in original pixel space) map correctly without any manual scaling math -- the browser's SVG renderer handles the coordinate transformation via preserveAspectRatio="xMidYMid meet".
- **paintOrder stroke for label readability:** Text labels use paintOrder="stroke" with a dark semi-transparent stroke behind the colored fill, making labels readable on both light and dark image regions without a background rectangle.
- **200 ID cap on batch endpoint:** The batch endpoint limits sample_ids to 200 per request, protecting against abuse while covering typical grid page sizes (50 samples per page with up to ~80 visible at once).

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None -- both tasks completed cleanly with zero TypeScript errors on build.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Annotation overlays are rendering on grid thumbnails
- AnnotationOverlay component is reusable for detail modal (02-03)
- color-hash utility is reusable anywhere class colors are needed
- Batch endpoint pattern can be extended for prediction annotations (Phase 4)
- Ready for Plan 02-03: Sample detail modal with full-resolution image and annotation list

---
*Phase: 02-visual-grid*
*Completed: 2026-02-11*
