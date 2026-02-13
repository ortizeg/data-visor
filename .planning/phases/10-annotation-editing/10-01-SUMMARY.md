---
phase: 10-annotation-editing
plan: 01
subsystem: annotation-crud
tags: [fastapi, duckdb, react-query, mutations, crud]
dependency-graph:
  requires: []
  provides:
    - "Annotation CRUD REST endpoints (PUT/POST/DELETE)"
    - "AnnotationUpdate and AnnotationCreate Pydantic models"
    - "apiPut frontend helper"
    - "AnnotationUpdate/AnnotationCreate TypeScript types"
    - "useUpdateAnnotation, useCreateAnnotation, useDeleteAnnotation hooks"
  affects:
    - "10-02 (Konva editor wires into these mutation hooks)"
    - "10-03 (draw tool uses useCreateAnnotation)"
tech-stack:
  added: []
  patterns:
    - "get_cursor DI for annotation router (auto-close cursor)"
    - "RETURNING clause for existence checks on UPDATE/DELETE"
    - "Dataset count refresh helper (_update_dataset_counts)"
key-files:
  created:
    - app/routers/annotations.py
  modified:
    - app/models/annotation.py
    - app/main.py
    - frontend/src/lib/api.ts
    - frontend/src/types/annotation.ts
    - frontend/src/hooks/use-annotations.ts
decisions:
  - "Used get_cursor DI (not get_db + manual cursor) for cleaner resource management"
  - "source='ground_truth' enforced in SQL WHERE clauses (not application code) for safety"
  - "Dataset counts refreshed via subquery UPDATE (not separate SELECT + UPDATE)"
metrics:
  duration: "~3 min"
  completed: "2026-02-12"
---

# Phase 10 Plan 01: Annotation CRUD Data Layer Summary

Backend REST endpoints and frontend mutation hooks for ground_truth annotation editing with DuckDB persistence and React Query cache invalidation.

## What Was Built

### Backend (app/routers/annotations.py)

Three endpoints registered under `/annotations`:

1. **PUT /annotations/{annotation_id}** -- Updates bbox position/size for ground_truth annotations only. Computes area automatically. Returns 404 if annotation not found or is a prediction.

2. **POST /annotations** -- Creates a new ground_truth annotation with auto-generated UUID. Sets `source='ground_truth'`, `is_crowd=false`, `confidence=NULL`. Updates dataset `annotation_count` and `category_count` after insert.

3. **DELETE /annotations/{annotation_id}** -- Deletes a ground_truth annotation only. Uses `RETURNING id, dataset_id` to fetch dataset_id before the row disappears. Updates dataset counts after delete.

All endpoints use the `get_cursor` dependency for automatic cursor lifecycle management.

### Backend Models (app/models/annotation.py)

- `AnnotationUpdate` -- bbox_x, bbox_y, bbox_w, bbox_h (float fields)
- `AnnotationCreate` -- dataset_id, sample_id, category_name + bbox fields

### Frontend API (frontend/src/lib/api.ts)

- `apiPut<T>(path, body)` -- PUT helper matching existing apiPatch pattern

### Frontend Types (frontend/src/types/annotation.ts)

- `AnnotationUpdate` -- mirrors backend model
- `AnnotationCreate` -- mirrors backend model

### Frontend Hooks (frontend/src/hooks/use-annotations.ts)

- `useUpdateAnnotation(datasetId, sampleId)` -- invalidates annotations + annotations-batch
- `useCreateAnnotation(datasetId, sampleId)` -- invalidates annotations + annotations-batch + filter-facets
- `useDeleteAnnotation(datasetId, sampleId)` -- invalidates annotations + annotations-batch + filter-facets

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `get_cursor` DI over `get_db` + manual cursor | Cleaner resource management, consistent with plan guidance |
| SQL WHERE `source='ground_truth'` enforcement | Prevents accidental modification of predictions at the database level |
| Dataset count refresh via subquery UPDATE | Single statement, no race conditions between SELECT and UPDATE |
| Partial queryKey matching for invalidation | `["annotations", sampleId]` matches all activeSources variants |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- `python -c "from app.routers.annotations import router; print('OK')"` -- OK
- FastAPI route inspection: PUT, POST, DELETE all registered under /annotations
- `npx tsc --noEmit` -- passes with zero errors
- All three mutation hooks exported and reference correct API paths

## Next Phase Readiness

Plans 02 and 03 can now build the Konva visual editor on top of this data layer:
- Mutation hooks are ready to wire into drag/resize/draw interactions
- apiPut helper available for bbox update calls
- TypeScript types match backend models exactly
