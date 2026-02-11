---
phase: 04-predictions-comparison
plan: 01
subsystem: api, ingestion
tags: [coco, predictions, ijson, streaming, duckdb, fastapi]

# Dependency graph
requires:
  - phase: 01-data-foundation
    provides: DuckDB schema, COCO parser pattern, annotations table with source column
provides:
  - Streaming COCO results parser (PredictionParser)
  - POST /datasets/{id}/predictions endpoint
  - prediction_count column on datasets table
  - PredictionImportRequest/PredictionImportResponse models
affects: [04-02 (comparison toggle), 04-03 (statistics dashboard)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prediction import reuses ijson streaming + DataFrame batching from COCO parser"
    - "source='prediction' column discriminator separates GT from predictions in annotations table"

key-files:
  created:
    - app/ingestion/prediction_parser.py
    - app/models/prediction.py
    - tests/test_prediction_import.py
    - tests/fixtures/coco_predictions.json
  modified:
    - app/repositories/duckdb_repo.py
    - app/models/dataset.py
    - app/routers/datasets.py
    - app/services/ingestion.py

key-decisions:
  - "Predictions stored in same annotations table with source='prediction' discriminator (not a separate table)"
  - "Re-import deletes only source='prediction' rows before inserting, preserving ground truth"
  - "Skipped count computed by re-reading file total vs inserted count"

patterns-established:
  - "source column as annotation type discriminator: 'ground_truth' vs 'prediction'"
  - "PredictionParser follows same streaming batch pattern as COCOParser"

# Metrics
duration: 3min
completed: 2026-02-11
---

# Phase 4 Plan 1: Prediction Import Pipeline Summary

**Streaming COCO results parser with POST endpoint for prediction import into annotations table with source='prediction' discriminator**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-11T15:48:18Z
- **Completed:** 2026-02-11T15:51:43Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Streaming PredictionParser using ijson that yields DataFrame batches matching annotations schema
- POST /datasets/{dataset_id}/predictions endpoint with full import flow
- Re-import replaces predictions without touching ground truth
- Dataset prediction_count column tracks imported prediction count
- 4 integration tests covering success, replace, GT preservation, and 404

## Task Commits

Each task was committed atomically:

1. **Task 1: Prediction parser and Pydantic models** - `a136ab7` (feat)
2. **Task 2: Prediction import endpoint and integration test** - `63b7fbf` (feat)

## Files Created/Modified
- `app/ingestion/prediction_parser.py` - Streaming COCO results parser yielding DataFrame batches
- `app/models/prediction.py` - PredictionImportRequest and PredictionImportResponse models
- `app/repositories/duckdb_repo.py` - Added prediction_count column to datasets schema
- `app/models/dataset.py` - Added prediction_count field to DatasetResponse
- `app/routers/datasets.py` - Added POST predictions endpoint, updated SELECT queries for new column
- `app/services/ingestion.py` - Updated INSERT statement for new prediction_count column
- `tests/test_prediction_import.py` - 4 integration tests for prediction import flow
- `tests/fixtures/coco_predictions.json` - 9 prediction objects including 1 unmapped category

## Decisions Made
- Predictions stored in the existing annotations table with `source='prediction'` rather than a separate table, since the schema already supports this via the source column
- Re-import deletes only `source='prediction'` rows before inserting new ones, ensuring ground truth is never touched
- Skipped prediction count computed by re-reading file total vs inserted count (two-pass but simple and correct)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated ingestion service INSERT for new column**
- **Found during:** Task 1 (schema update)
- **Issue:** Adding prediction_count to datasets table changed the column count, breaking the positional INSERT INTO datasets VALUES statement in ingestion.py
- **Fix:** Added `0` literal for prediction_count in the INSERT statement
- **Files modified:** app/services/ingestion.py
- **Verification:** All 55 existing tests pass after change
- **Committed in:** a136ab7 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix -- without it, all ingestion would break. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Predictions exist in the database alongside ground truth annotations
- source column discriminates between 'ground_truth' and 'prediction'
- prediction_count on datasets table available for UI display
- Ready for Phase 4 Plan 2 (comparison toggle) and Plan 3 (statistics dashboard)

---
*Phase: 04-predictions-comparison*
*Completed: 2026-02-11*
