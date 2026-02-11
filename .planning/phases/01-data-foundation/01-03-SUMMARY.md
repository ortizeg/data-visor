---
phase: 01-data-foundation
plan: 03
subsystem: ingestion, storage, images
tags: [fsspec, ijson, pillow, webp, pandas, streaming, thumbnails, coco]

# Dependency graph
requires:
  - phase: 01-01
    provides: DuckDB schema (samples, annotations tables), project scaffold, dependencies
provides:
  - fsspec-based StorageBackend for transparent local/GCS file access
  - Abstract BaseParser interface for format-agnostic dataset parsing
  - Streaming COCOParser using ijson with DataFrame batch output
  - ImageService with WebP thumbnail generation and disk cache
affects: [01-04, 02-01, 04-01]

# Tech tracking
tech-stack:
  added: []
  patterns: [fsspec lazy filesystem cache per protocol, ijson binary-mode streaming with use_float, DataFrame batch yield for DuckDB bulk insert, disk-cached WebP thumbnails with LANCZOS resampling]

key-files:
  created: [app/repositories/storage.py, app/ingestion/base_parser.py, app/ingestion/coco_parser.py, app/services/image_service.py, tests/test_coco_parser.py, tests/test_images.py, tests/fixtures/small_coco.json, tests/fixtures/malformed_coco.json]
  modified: []

key-decisions:
  - "Two-pass COCO parsing (categories first, then images, then annotations) for clarity over single-pass"
  - "DataFrame column order explicitly matches DuckDB table order for INSERT INTO ... SELECT * FROM df"
  - "WebP method=4 for best speed/quality tradeoff in thumbnail generation"
  - "RGBA/P/LA/PA mode conversion to RGB before WebP save"

patterns-established:
  - "Streaming parse pattern: ijson.items() in binary mode with use_float=True, accumulate into batches, yield pd.DataFrame"
  - "Cache pattern: deterministic file path ({id}_{size}.webp), check exists before generating"
  - "Error isolation pattern: batch operations catch per-item exceptions and return (success, error) counts"

# Metrics
duration: 4min
completed: 2026-02-11
---

# Phase 1 Plan 3: Core Services Summary

**fsspec StorageBackend for local/GCS, streaming COCO parser via ijson yielding DataFrame batches, and WebP thumbnail service with disk cache**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-11T04:36:07Z
- **Completed:** 2026-02-11T04:39:43Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- StorageBackend provides unified local/GCS file access via fsspec with lazy filesystem caching per protocol
- BaseParser ABC defines the extension point for COCO, YOLO, VOC format parsers with configurable batch_size
- COCOParser streams COCO JSON with ijson (binary mode, use_float=True) and yields pandas DataFrames with column order matching DuckDB tables exactly
- ImageService generates WebP thumbnails at 128/256/512px with LANCZOS resampling, disk cache, and error-isolated batch generation
- 20 new tests covering streaming parsing, edge cases (iscrowd, missing categories, malformed files), thumbnail generation, caching, RGBA conversion, and batch error isolation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create StorageBackend and BaseParser interface** - `c5fdf45` (feat)
2. **Task 2: Create streaming COCO parser with test fixtures** - `ad2a917` (feat)
3. **Task 3: Create ImageService with thumbnail generation and disk cache** - `a12364c` (feat)

## Files Created/Modified
- `app/repositories/storage.py` - fsspec-based StorageBackend with read_bytes, exists, open, list_dir, resolve_image_path
- `app/ingestion/base_parser.py` - Abstract BaseParser ABC with format_name, parse_categories, build_image_batches, build_annotation_batches
- `app/ingestion/coco_parser.py` - Streaming COCO parser using ijson with DataFrame batch output
- `app/services/image_service.py` - Thumbnail generation with disk cache, WebP output, multiple sizes
- `tests/test_coco_parser.py` - 13 tests for COCO parser including edge cases
- `tests/test_images.py` - 7 tests for ImageService including caching, batch, error isolation
- `tests/fixtures/small_coco.json` - 10-image COCO fixture with 3 categories, 17 annotations
- `tests/fixtures/malformed_coco.json` - Edge case fixture: missing categories, missing width, unknown category_id

## Decisions Made
- Two-pass COCO parsing (categories first, then images, then annotations) for code clarity; file I/O cost is acceptable since files are read from disk
- DataFrame column order explicitly mirrors DuckDB table column order so `INSERT INTO table SELECT * FROM df` works without column mapping
- WebP save uses method=4 (best speed/quality tradeoff per Pillow docs)
- Extended RGBA/P mode handling to also cover LA and PA modes for broader WebP compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three core services (storage, parsing, thumbnails) are standalone and tested
- Ready for Plan 01-04 (API routers and ingestion orchestration) to wire these services into endpoints
- DataFrame batch output format is validated to match DuckDB schema column order

---
*Phase: 01-data-foundation*
*Completed: 2026-02-11*
