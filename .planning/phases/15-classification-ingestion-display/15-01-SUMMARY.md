---
phase: 15-classification-ingestion-display
plan: 01
subsystem: api, ingestion, database
tags: [classification, jsonl, parser, duckdb, fastapi, sentinel-bbox]

requires:
  - phase: 07-evaluation
    provides: "statistics router and evaluation service"
  - phase: 02-ingestion
    provides: "BaseParser, COCOParser, FolderScanner, IngestionService"
provides:
  - ClassificationJSONLParser with sentinel bbox values
  - FolderScanner classification JSONL detection (layouts D and E)
  - dataset_type column and API field
  - PATCH /annotations/{id}/category endpoint
  - Format-based parser dispatch in IngestionService
  - Classification-aware statistics
affects: [15-02, 16-classification-evaluation, frontend-classification-display]

tech-stack:
  added: []
  patterns: [sentinel-bbox-for-classification, format-based-parser-dispatch, layout-detection-priority]

key-files:
  created:
    - app/ingestion/classification_jsonl_parser.py
  modified:
    - app/repositories/duckdb_repo.py
    - app/models/dataset.py
    - app/models/scan.py
    - app/models/annotation.py
    - app/ingestion/base_parser.py
    - app/services/folder_scanner.py
    - app/services/ingestion.py
    - app/routers/ingestion.py
    - app/routers/datasets.py
    - app/routers/annotations.py
    - app/routers/statistics.py

key-decisions:
  - "Classification JSONL layouts checked before COCO layouts since JSONL is never COCO"
  - "Sentinel bbox values (all 0.0) for classification annotations to avoid nullable columns"
  - "Format string threaded through ImportRequest -> ingest_splits_with_progress -> ingest_with_progress"
  - "Classification gt_annotations stat uses COUNT(DISTINCT sample_id) instead of COUNT(*)"

patterns-established:
  - "Format dispatch: IngestionService selects parser by format string, extensible for future formats"
  - "Layout priority: classification-specific layouts tested before generic COCO layouts"

duration: 5min
completed: 2026-02-18
---

# Phase 15 Plan 01: Classification Ingestion & Backend Summary

**ClassificationJSONLParser with sentinel bbox values, FolderScanner auto-detection of JSONL layouts, format-based parser dispatch, and category update endpoint**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-19T02:13:50Z
- **Completed:** 2026-02-19T02:18:51Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- ClassificationJSONLParser that produces annotations with sentinel bbox values (0.0) and supports multi-label via array labels
- FolderScanner detects classification JSONL in split dirs (Layout D) and flat (Layout E) with GCS support
- Format-based parser dispatch in IngestionService with dataset_type stored on dataset record
- PATCH /annotations/{id}/category endpoint for classification label editing
- Classification-aware statistics (gt_annotations = distinct labeled images)

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration, Pydantic models, and ClassificationJSONLParser** - `5264e51` (feat)
2. **Task 2: FolderScanner detection, IngestionService dispatch, and API endpoints** - `8af8a11` (feat)

## Files Created/Modified
- `app/ingestion/classification_jsonl_parser.py` - New parser extending BaseParser with sentinel bbox annotations
- `app/repositories/duckdb_repo.py` - dataset_type column migration
- `app/models/dataset.py` - dataset_type field on DatasetResponse
- `app/models/scan.py` - format field on ImportRequest
- `app/models/annotation.py` - CategoryUpdateRequest model
- `app/ingestion/base_parser.py` - image_dir parameter on build_image_batches ABC
- `app/services/folder_scanner.py` - Layout D/E detectors, GCS classification detection, _is_classification_jsonl
- `app/services/ingestion.py` - Format dispatch, dataset_type on INSERT, format threading
- `app/routers/ingestion.py` - Format passthrough, .jsonl in browse, updated error message
- `app/routers/datasets.py` - dataset_type in SELECT and DatasetResponse mapping
- `app/routers/annotations.py` - PATCH /annotations/{id}/category endpoint
- `app/routers/statistics.py` - Classification-aware gt_annotations aggregation

## Decisions Made
- Classification JSONL layouts checked before COCO layouts since JSONL files are never COCO (more specific detection first)
- Used sentinel bbox values (all 0.0) for classification annotations, matching the project decision to avoid nullable columns
- gt_annotations stat for classification uses COUNT(DISTINCT sample_id) to represent "labeled images" rather than raw annotation count
- Added .jsonl to browse endpoint extensions for file navigation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added .jsonl to browse endpoint file extensions**
- **Found during:** Task 2 (API endpoints)
- **Issue:** Browse endpoint only showed .json files, users couldn't see .jsonl files when navigating
- **Fix:** Added ".jsonl" to _BROWSE_EXTENSIONS set
- **Files modified:** app/routers/ingestion.py
- **Verification:** Import and app start verified
- **Committed in:** 8af8a11 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Minor addition necessary for classification JSONL usability. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Backend fully supports classification dataset ingestion, ready for frontend display work in Plan 02
- Parser dispatch is extensible for future formats (YOLO, VOC, etc.)
- dataset_type field available for frontend to branch display logic

---
*Phase: 15-classification-ingestion-display*
*Completed: 2026-02-18*
