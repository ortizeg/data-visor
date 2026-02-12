---
phase: 05-embeddings-visualization
plan: 01
subsystem: api, ml
tags: [dinov2, transformers, torch, embeddings, sse, duckdb]

# Dependency graph
requires:
  - phase: 01-data-foundation
    provides: DuckDB schema pattern, StorageBackend for image loading, lifespan/DI pattern
provides:
  - DINOv2 embedding service with startup model loading and batch CLS token extraction
  - DuckDB embeddings table with FLOAT[768] vector column and x/y UMAP placeholders
  - REST endpoints for triggering, monitoring (SSE), and querying embedding status
  - Pydantic models for embedding request/response/progress/status
affects: [05-02 (UMAP reduction reads embeddings table), 05-03 (scatter plot queries status endpoint)]

# Tech tracking
tech-stack:
  added: [transformers 5.1.0, torch 2.10.0, sse-starlette 3.2.0, scikit-learn 1.8.0]
  patterns: [background task with in-memory progress tracking, SSE via EventSourceResponse, model singleton on app.state]

key-files:
  created:
    - app/services/embedding_service.py
    - app/routers/embeddings.py
    - app/models/embedding.py
  modified:
    - app/repositories/duckdb_repo.py
    - app/main.py
    - app/dependencies.py
    - pyproject.toml
    - tests/test_health.py

key-decisions:
  - "umap-learn skipped due to numba/llvmlite Python 3.14 incompatibility; scikit-learn installed as fallback for Plan 02"
  - "EmbeddingService takes StorageBackend (not ImageService) to access raw images via resolve_image_path + read_bytes"
  - "In-memory dict for progress tracking (not DB) -- ephemeral, per-process, no persistence needed"
  - "MPS/CUDA/CPU auto-detection for model placement"

patterns-established:
  - "Background ML task: service stores progress in dict, SSE endpoint polls it every 0.5s"
  - "Model singleton: loaded in lifespan, stored on app.state, injected via DI"
  - "EventSourceResponse async generator pattern for proper SSE (replaces sync StreamingResponse)"

# Metrics
duration: 5min
completed: 2026-02-11
---

# Phase 5 Plan 01: Embedding Pipeline Summary

**DINOv2-based embedding generation pipeline with background task runner, SSE progress streaming, and DuckDB FLOAT[768] storage**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-12T02:09:22Z
- **Completed:** 2026-02-12T02:14:14Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- EmbeddingService loads DINOv2-base model once at startup, extracts CLS token embeddings in batches of 32 with torch.no_grad()
- DuckDB embeddings table stores FLOAT[768] vectors with x/y columns reserved for UMAP reduction
- Three REST endpoints: POST /generate (202 background task), GET /progress (SSE stream), GET /status (embedding availability)
- All 59 existing tests pass with no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies, create DuckDB schema, and Pydantic models** - `269e2d0` (feat)
2. **Task 2: Embedding service with DINOv2 model and background task generation** - `01d9b30` (feat)

## Files Created/Modified
- `app/services/embedding_service.py` - DINOv2 model management, batch CLS token extraction, background task with progress tracking
- `app/routers/embeddings.py` - POST /generate, GET /progress (SSE), GET /status endpoints
- `app/models/embedding.py` - EmbeddingGenerateRequest, EmbeddingGenerateResponse, EmbeddingProgress, EmbeddingStatus
- `app/repositories/duckdb_repo.py` - Added embeddings table with FLOAT[768] vector column
- `app/main.py` - EmbeddingService initialization in lifespan, router registration
- `app/dependencies.py` - get_embedding_service DI function
- `pyproject.toml` - Added transformers, torch, scikit-learn, sse-starlette dependencies
- `tests/test_health.py` - Updated table list assertion to include embeddings

## Decisions Made
- **umap-learn skipped:** numba/llvmlite (transitive deps of umap-learn) do not support Python 3.14. Installed scikit-learn as alternative for Plan 02 UMAP reduction. Plan 02 will need to either use scikit-learn TSNE, a pure-Python UMAP alternative, or pin a compatible numba version.
- **StorageBackend over ImageService:** EmbeddingService uses StorageBackend directly (resolve_image_path + read_bytes) rather than ImageService, since it needs raw PIL images not thumbnails.
- **In-memory progress dict:** Progress state is stored per-dataset in a Python dict, not persisted to DB. This is ephemeral per-process state -- if the server restarts, running tasks are lost. Sufficient for the single-user dev tool use case.
- **MPS auto-detection:** Model auto-detects Apple Silicon MPS, then CUDA, then falls back to CPU. No configuration required.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] umap-learn incompatible with Python 3.14**
- **Found during:** Task 1 (dependency installation)
- **Issue:** umap-learn requires numba -> llvmlite, which only supports Python <=3.10. Project uses Python 3.14.
- **Fix:** Skipped umap-learn installation. Added scikit-learn as alternative for Plan 02's dimensionality reduction. umap-learn is not needed for Plan 01 (embedding generation only).
- **Files modified:** pyproject.toml (scikit-learn added instead)
- **Verification:** All other deps install and import correctly
- **Committed in:** 269e2d0 (Task 1 commit)

**2. [Rule 1 - Bug] Updated test_health.py table assertion**
- **Found during:** Task 2 (verification)
- **Issue:** test_db_creates_all_tables expected 5 tables but embeddings table makes 6
- **Fix:** Added "embeddings" to the expected table list
- **Files modified:** tests/test_health.py
- **Verification:** All 59 tests pass
- **Committed in:** 01d9b30 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correct operation. umap-learn gap deferred to Plan 02 scope. No scope creep.

## Issues Encountered
- Python 3.14 compatibility gap with numba/llvmlite prevents umap-learn installation. This will need resolution in Plan 02 (UMAP reduction). Options: use scikit-learn TSNE, find a numba-free UMAP implementation, or use a Python 3.14-compatible numba version when available.

## User Setup Required

None - no external service configuration required. DINOv2 model is auto-downloaded from Hugging Face Hub on first startup.

## Next Phase Readiness
- Embedding pipeline is ready: POST to generate, SSE to monitor, GET to check status
- Plan 02 (UMAP reduction) can read from the embeddings table's vector column and write to x/y columns
- Plan 03 (scatter plot) can query the /status endpoint to detect embedding availability
- **Blocker for Plan 02:** umap-learn installation needs Python 3.14 workaround

---
*Phase: 05-embeddings-visualization*
*Completed: 2026-02-11*
