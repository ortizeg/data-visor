---
phase: 04-predictions-comparison
plan: 03
subsystem: api, frontend
tags: [statistics, recharts, duckdb, group-by, charts, tabs, zustand]

# Dependency graph
requires:
  - phase: 01-data-foundation
    provides: DuckDB schema, annotations table with source column, samples table with split column
  - plan: 04-01
    provides: Predictions in annotations table with source='prediction'
  - plan: 04-02
    provides: overlayMode in UI store, OverlayToggle component pattern
provides:
  - GET /datasets/{id}/statistics endpoint with server-side aggregation
  - DatasetStatistics, ClassDistribution, SplitBreakdown, SummaryStats models
  - Recharts-powered statistics dashboard (class distribution, split breakdown, summary cards)
  - Grid/Statistics tab system on dataset page
  - activeTab state in UI store
affects: [05-embeddings (may want embedding cluster stats), 06-smart-tagging (tag statistics)]

# Tech tracking
tech-stack:
  added: [recharts]
  patterns: [segmented-tab-control, server-side-aggregation, skeleton-loading]

# File tracking
key-files:
  created:
    - app/models/statistics.py
    - app/routers/statistics.py
    - frontend/src/types/statistics.ts
    - frontend/src/hooks/use-statistics.ts
    - frontend/src/components/stats/stats-dashboard.tsx
    - frontend/src/components/stats/class-distribution.tsx
    - frontend/src/components/stats/split-breakdown.tsx
    - frontend/src/components/stats/annotation-summary.tsx
  modified:
    - app/main.py
    - frontend/src/stores/ui-store.ts
    - frontend/src/app/datasets/[datasetId]/page.tsx
    - frontend/package.json

# Decisions
decisions:
  - id: "04-03-01"
    decision: "Recharts for charting (lightweight, React-native, composable API)"
    rationale: "No additional peer deps, works with React 19, simple declarative charts"
  - id: "04-03-02"
    decision: "Server-side aggregation via DuckDB GROUP BY (not client-side)"
    rationale: "Scales to millions of annotations; frontend receives only summary data"
  - id: "04-03-03"
    decision: "activeTab state in Zustand (not URL params)"
    rationale: "Consistent with existing UI state pattern; tab is ephemeral session state"
  - id: "04-03-04"
    decision: "OverlayToggle hidden when Statistics tab active"
    rationale: "Overlay mode only applies to grid view; avoids confusing irrelevant control"

# Metrics
metrics:
  duration: 3 min
  completed: 2026-02-11
---

# Phase 04 Plan 03: Statistics Dashboard Summary

Server-side DuckDB aggregation endpoint with Recharts-powered dashboard showing class distribution, split breakdown, and summary stats, accessible via a Grid/Statistics tab switcher.

## What Was Built

### Task 1: Statistics Backend Endpoint
- Created `app/models/statistics.py` with `DatasetStatistics`, `ClassDistribution`, `SplitBreakdown`, and `SummaryStats` Pydantic models
- Created `app/routers/statistics.py` with `GET /datasets/{dataset_id}/statistics` endpoint
- Three DuckDB queries: class distribution with `COUNT(*) FILTER (WHERE source = ...)` for GT/prediction split, split breakdown with `COALESCE(split, 'unassigned')`, and summary with subquery aggregates
- Registered statistics router in `app/main.py`
- Commit: `10fe2d6`

### Task 2: Statistics Dashboard Frontend
- Installed `recharts` (v3.7.0) for chart rendering
- Created TypeScript types mirroring backend models
- Created `useStatistics` TanStack Query hook with 5-minute staleTime
- Created `AnnotationSummary` -- 4-column grid of stat cards (total images, GT annotations, predictions, categories)
- Created `ClassDistribution` -- horizontal bar chart with GT (blue) and predictions (amber) side by side per category, height scales with category count
- Created `SplitBreakdown` -- vertical bar chart with violet bars per split
- Created `StatsDashboard` -- layout composing all three sections with skeleton loading states
- Added `activeTab: DatasetTab` and `setActiveTab` to Zustand UI store
- Updated dataset page with segmented Grid/Statistics tab control (same visual pattern as OverlayToggle)
- OverlayToggle only visible when Grid tab is active
- Commit: `fb0c854`

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **Recharts for charting** -- Lightweight, React-native composable API. No additional peer deps needed; works cleanly with React 19.
2. **Server-side aggregation** -- All computation via DuckDB GROUP BY queries. Frontend only receives summary JSON, scales to millions of annotations.
3. **activeTab in Zustand** -- Consistent with existing overlayMode pattern. Ephemeral session state, no URL persistence needed.
4. **OverlayToggle hidden on Statistics tab** -- Only relevant to grid view; hiding avoids user confusion.

## Verification Results

- All 59 backend tests pass
- TypeScript compiles with zero errors
- Frontend builds successfully (Next.js 16.1.6 Turbopack)
- Statistics router route confirmed: `GET /datasets/{dataset_id}/statistics`

## Next Phase Readiness

Phase 4 (Predictions & Comparison) is now complete (3/3 plans delivered). All three deliverables are in place:
1. Prediction import endpoint (04-01)
2. GT vs Predictions comparison toggle (04-02)
3. Statistics dashboard with charts (04-03)

No blockers for Phase 5 (Embeddings & Similarity). The statistics endpoint pattern can be extended for embedding cluster stats if needed.
