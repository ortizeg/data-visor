---
phase: 09-smart-ingestion
plan: 01
subsystem: api
tags: [fastapi, pydantic, ijson, coco, ingestion, sse, folder-scanner]

# Dependency graph
requires:
  - phase: 01-data-foundation
    provides: DuckDB schema with samples.split column, IngestionService, COCOParser
provides:
  - FolderScanner service with Roboflow/Standard/Flat COCO layout detection
  - Pydantic scan models (ScanRequest, ScanResult, DetectedSplit, ImportRequest, ImportSplit)
  - POST /ingestion/scan endpoint returning detected COCO splits
  - POST /ingestion/import endpoint with SSE multi-split progress streaming
  - Split-aware ingestion pipeline (split param flows API -> Service -> Parser -> DuckDB)
  - Multi-split import under single dataset_id with INSERT-or-UPDATE logic
affects: [09-smart-ingestion plan 02 (frontend wizard), future format parsers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FolderScanner heuristic detection: Layout B (Roboflow) -> A (Standard) -> C (Flat)"
    - "Multi-split dataset_id sharing via optional dataset_id parameter in ingest_with_progress"
    - "Dataset record INSERT-or-UPDATE for subsequent splits under same dataset_id"

key-files:
  created:
    - app/models/scan.py
    - app/services/folder_scanner.py
    - app/routers/ingestion.py
  modified:
    - app/ingestion/base_parser.py
    - app/ingestion/coco_parser.py
    - app/services/ingestion.py
    - app/models/dataset.py
    - app/routers/datasets.py
    - app/main.py

key-decisions:
  - "Three-layout priority detection: Roboflow (most specific) first, then Standard COCO, then Flat fallback"
  - "ijson peek at top-level keys for COCO detection (no full parse, max 10 keys checked)"
  - "os.scandir for image counting (no glob, no recursion into subdirs)"
  - "Optional dataset_id param on ingest_with_progress for multi-split ID sharing"
  - "INSERT-or-UPDATE pattern for dataset record across splits (accumulate image/annotation counts)"
  - "Category dedup via NOT IN subquery for subsequent split imports"

patterns-established:
  - "FolderScanner: stateless service class with scan() entry point and private layout detectors"
  - "Multi-split ingestion: generate one UUID, pass to all ingest_with_progress calls"

# Metrics
duration: 5min
completed: 2026-02-12
---

# Phase 9 Plan 1: Smart Ingestion Backend Summary

**FolderScanner with 3-layout COCO detection, /ingestion/scan and /import endpoints, split-aware pipeline flowing split param from API through to DuckDB samples.split column**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-12T23:50:39Z
- **Completed:** 2026-02-12T23:55:49Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- FolderScanner detects Roboflow, Standard COCO, and Flat layouts using ijson peek
- POST /ingestion/scan returns detected splits with image counts and annotation file sizes
- POST /ingestion/import streams SSE progress for sequential multi-split import
- Split parameter flows from API through IngestionService to COCOParser to DuckDB samples.split
- Multi-split imports share one dataset_id with INSERT-or-UPDATE logic for dataset record
- All 59 existing tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create FolderScanner service and Pydantic scan models** - `81b002b` (feat)
2. **Task 2: Create ingestion router, extend ingestion pipeline, register router** - `f53db6b` (feat)

## Files Created/Modified
- `app/models/scan.py` - ScanRequest, ScanResult, DetectedSplit, ImportRequest, ImportSplit Pydantic models
- `app/services/folder_scanner.py` - FolderScanner with 3-layout heuristic COCO detection
- `app/routers/ingestion.py` - POST /ingestion/scan and POST /ingestion/import endpoints
- `app/ingestion/base_parser.py` - Updated abstract build_image_batches signature with split param
- `app/ingestion/coco_parser.py` - build_image_batches accepts optional split, populates split column
- `app/services/ingestion.py` - split + dataset_id params on ingest_with_progress, ingest_splits_with_progress method
- `app/models/dataset.py` - IngestRequest gains optional split field
- `app/routers/datasets.py` - Existing ingest endpoint passes split through to service
- `app/main.py` - Ingestion router registered with app.include_router()

## Decisions Made
- Three-layout priority: Roboflow > Standard COCO > Flat. Roboflow is most specific (split dirs with co-located JSON + images), checked first to avoid false positives from Standard detection.
- ijson peek checks first 10 top-level keys for "images" -- enough to identify COCO without parsing megabytes of annotation data. Files > 500MB skipped during scan.
- os.scandir for image counting -- no recursion into subdirectories, no glob expansion overhead.
- Optional dataset_id parameter on ingest_with_progress enables multi-split sharing without breaking existing single-split callers (backward compatible).
- INSERT-or-UPDATE pattern for dataset record: first split INSERTs, subsequent splits UPDATE image/annotation counts cumulatively. Category dedup via NOT IN subquery.
- Updated BaseParser abstract interface to include split parameter for forward compatibility with future format parsers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated BaseParser abstract interface**
- **Found during:** Task 2 (extending COCOParser)
- **Issue:** Plan only mentioned modifying COCOParser, but the abstract base class signature also needs the split parameter to maintain interface consistency
- **Fix:** Added `split: str | None = None` to BaseParser.build_image_batches abstract method
- **Files modified:** app/ingestion/base_parser.py
- **Verification:** All imports and tests pass
- **Committed in:** f53db6b (Task 2 commit)

**2. [Rule 2 - Missing Critical] Updated existing datasets router to pass split**
- **Found during:** Task 2 (extending ingestion pipeline)
- **Issue:** Plan mentioned adding split to IngestRequest but did not explicitly mention updating the existing POST /datasets/ingest endpoint to pass it through
- **Fix:** Added `split=request.split` to the existing ingest endpoint's call to ingest_with_progress
- **Files modified:** app/routers/datasets.py
- **Verification:** Existing 59 tests pass
- **Committed in:** f53db6b (Task 2 commit)

**3. [Rule 2 - Missing Critical] Thumbnail query for multi-split: filter by NULL thumbnail_path**
- **Found during:** Task 2 (multi-split import logic)
- **Issue:** For subsequent splits, the thumbnail query `SELECT ... WHERE dataset_id = ? LIMIT ?` would re-fetch already-thumbnailed images from prior splits
- **Fix:** Added `AND thumbnail_path IS NULL` filter to thumbnail query
- **Files modified:** app/services/ingestion.py
- **Verification:** Logic correct for both single and multi-split flows
- **Committed in:** f53db6b (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 missing critical)
**Impact on plan:** All auto-fixes necessary for interface consistency and multi-split correctness. No scope creep.

## Issues Encountered
None -- all tasks executed cleanly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Backend foundation for smart ingestion complete
- POST /ingestion/scan and POST /ingestion/import ready for frontend consumption
- Plan 02 (frontend wizard) can build on these endpoints
- No blockers

---
*Phase: 09-smart-ingestion*
*Completed: 2026-02-12*
