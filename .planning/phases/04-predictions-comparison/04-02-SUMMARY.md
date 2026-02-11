---
phase: 04-predictions-comparison
plan: 02
subsystem: api, frontend
tags: [annotations, overlay, toggle, svg, zustand, source-filter, dashed-stroke]

# Dependency graph
requires:
  - phase: 04-predictions-comparison
    plan: 01
    provides: Predictions in annotations table with source discriminator, prediction_count column
  - phase: 02-visual-grid
    plan: 02
    provides: Batch annotations endpoint, SVG overlay component, annotation hooks
provides:
  - Three-way overlay mode toggle (GT/Pred/Both)
  - Source-aware SVG rendering (solid GT, dashed predictions with confidence)
  - Server-side source filtering on annotation endpoints
affects:
  - phase: 04-predictions-comparison
    plan: 03
    reason: Statistics dashboard may need to query annotations by source

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Zustand overlay mode state driving TanStack Query refetch via queryKey
    - Segmented control component with conditional render (hasPredictions)
    - SVG strokeDasharray for visual source differentiation

# File tracking
key-files:
  created:
    - frontend/src/components/toolbar/overlay-toggle.tsx
  modified:
    - app/routers/samples.py
    - frontend/src/stores/ui-store.ts
    - frontend/src/hooks/use-annotations.ts
    - frontend/src/components/grid/annotation-overlay.tsx
    - frontend/src/app/datasets/[datasetId]/page.tsx
    - frontend/src/types/dataset.ts

# Decisions
decisions:
  - id: overlay-default-gt
    description: Default overlayMode is "ground_truth" since predictions may not exist
  - id: stale-time-5min
    description: Changed annotation staleTime from Infinity to 5 minutes since predictions can change after import
  - id: source-param-both
    description: When overlay mode is "both", source param is omitted (returns all annotations)

# Metrics
metrics:
  duration: 3 min
  completed: 2026-02-11
  tasks: 2/2
---

# Phase 04 Plan 02: GT vs Predictions Comparison Toggle Summary

Three-way overlay mode toggle (GT/Pred/Both) with source-aware SVG rendering: solid strokes for GT, dashed strokes with confidence percentages for predictions, and server-side source filtering to reduce annotation payload.

## What Was Built

### Task 1: Backend source filter on annotation endpoints

Added an optional `source` query parameter to both annotation endpoints:

- `GET /samples/batch-annotations?source=ground_truth` -- returns only GT annotations
- `GET /samples/{sample_id}/annotations?source=prediction` -- returns only predictions
- Omitting the parameter returns all annotations (backward compatible)

The filter appends `AND source = ?` to the SQL WHERE clause when provided. Also added `prediction_count: number` to the frontend `Dataset` type to match the backend model from 04-01.

### Task 2: Overlay mode toggle and source-aware SVG rendering

**UI Store (`ui-store.ts`):**
- Added `OverlayMode` type: `"ground_truth" | "prediction" | "both"`
- Added `overlayMode` state (default: `"ground_truth"`) and `setOverlayMode` action

**OverlayToggle (`overlay-toggle.tsx`):**
- Segmented control with GT / Pred / Both buttons
- Active state: dark background; inactive: light background with hover
- Accepts `hasPredictions` prop -- returns null when false (toggle hidden until predictions imported)

**Annotation hooks (`use-annotations.ts`):**
- Both `useAnnotationsBatch` and `useAnnotations` read `overlayMode` from the store
- Map mode to source query param: `"ground_truth"` and `"prediction"` pass `&source=`, `"both"` omits it
- Added `overlayMode` to queryKey so TanStack Query refetches when toggle changes
- Changed `staleTime` from `Infinity` to 5 minutes (predictions can change after import)

**SVG overlay (`annotation-overlay.tsx`):**
- Predictions render with `strokeDasharray` (dashed lines) while GT uses solid lines
- Prediction labels append confidence percentage: `"dog 92%"` vs just `"dog"` for GT
- Dash pattern: `strokeWidth * 4` dash, `strokeWidth * 2` gap

**Dataset page (`page.tsx`):**
- Mounted `OverlayToggle` in header bar after the image count span
- Passes `hasPredictions={(dataset.prediction_count ?? 0) > 0}`

## Decisions Made

1. **Default overlay mode is GT-only** -- Predictions may not exist for a dataset, so defaulting to GT is always safe.
2. **staleTime reduced from Infinity to 5 min** -- After prediction import, annotations change, so caching forever is incorrect.
3. **"Both" mode omits source param** -- Rather than fetching GT and predictions separately and merging, we let the backend return all in one request.

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

| Check | Result |
|-------|--------|
| `python -m pytest tests/ -v` | 59/59 passed |
| `npx tsc --noEmit` | No errors |
| `npm run build` | Build succeeded |
| Batch annotations with `?source=ground_truth` | Filters to GT only |
| Batch annotations with `?source=prediction` | Filters to predictions only |
| Batch annotations without source | Returns all (backward compatible) |
| OverlayToggle renders GT/Pred/Both buttons | Component created |
| SVG rects use dashed stroke for predictions | strokeDasharray conditional |

## Next Phase Readiness

Plan 04-03 (statistics dashboard) can proceed. The source filter on annotation endpoints enables per-source counting queries. The overlay mode in the UI store can also be used by the stats panel to show source-specific metrics.
