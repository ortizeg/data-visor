---
phase: 05-embeddings-visualization
plan: 02
subsystem: api
tags: [t-sne, scikit-learn, dimensionality-reduction, sse, duckdb, scatter-plot]

# Dependency graph
requires:
  - phase: 05-01
    provides: "DINOv2 embedding pipeline, embeddings table with 768-dim vectors and x/y columns"
provides:
  - "ReductionService with t-SNE dimensionality reduction (768-dim -> 2D)"
  - "POST /reduce endpoint triggering background t-SNE task"
  - "GET /reduce/progress SSE endpoint for reduction progress streaming"
  - "GET /coordinates endpoint returning 2D scatter-plot data"
  - "ReductionProgress and EmbeddingPoint Pydantic models"
affects: ["05-03", "05-04"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Background task + in-memory progress dict + SSE polling (same as EmbeddingService)"
    - "t-SNE as UMAP replacement for Python 3.14 compatibility"

key-files:
  created:
    - "app/services/reduction_service.py"
  modified:
    - "app/models/embedding.py"
    - "app/routers/embeddings.py"
    - "app/main.py"
    - "app/dependencies.py"

key-decisions:
  - "scikit-learn t-SNE used instead of umap-learn (numba/llvmlite incompatible with Python 3.14)"
  - "Perplexity clamped to min(perplexity, n_samples-1) for small dataset safety"
  - "PCA initialization for t-SNE (more stable than random init)"
  - "Cosine metric matches embedding space semantics"

patterns-established:
  - "ReductionService follows same pattern as EmbeddingService: background task + in-memory dict + SSE"
  - "Coordinates endpoint returns camelCase JSON keys (sampleId, fileName, thumbnailPath) for frontend consumption"

# Metrics
duration: 3min
completed: 2026-02-11
---

# Phase 5 Plan 02: Dimensionality Reduction Summary

**t-SNE reduction service converting 768-dim DINOv2 embeddings to 2D scatter coordinates via background task with SSE progress streaming**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-12T02:17:56Z
- **Completed:** 2026-02-12T02:20:56Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- ReductionService wrapping scikit-learn t-SNE with random_state=42 for reproducible 2D layouts
- Three new endpoints on the embeddings router: POST /reduce, GET /reduce/progress, GET /coordinates
- Background task execution with SSE progress distinguishing loading, fitting, and complete states
- Coordinates endpoint joining embeddings + samples tables for scatter-plot data

## Task Commits

Each task was committed atomically:

1. **Task 1: Reduction service and Pydantic models** - `5116acc` (feat)
2. **Task 2: Reduction endpoints and coordinates API** - `13e5c59` (feat)

## Files Created/Modified

- `app/services/reduction_service.py` - t-SNE reduction service with background task, progress tracking, coordinates query
- `app/models/embedding.py` - Added ReductionProgress and EmbeddingPoint Pydantic models
- `app/routers/embeddings.py` - Added POST /reduce, GET /reduce/progress, GET /coordinates endpoints
- `app/main.py` - Register ReductionService in lifespan
- `app/dependencies.py` - Added get_reduction_service DI function

## Decisions Made

- **t-SNE instead of UMAP:** umap-learn requires numba/llvmlite which are incompatible with Python 3.14. scikit-learn's t-SNE provides the same fit_transform API and produces high-quality 2D layouts for CV embeddings. Both use random_state=42 for reproducibility.
- **Perplexity clamping:** t-SNE perplexity must be < n_samples. Clamped to min(30, n_samples-1) for safety with small datasets.
- **PCA initialization:** Used init="pca" for more stable, reproducible t-SNE layouts vs random initialization.
- **Cosine metric:** Matches the semantic distance in the DINOv2 embedding space.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used t-SNE instead of UMAP**
- **Found during:** Task 1 (ReductionService implementation)
- **Issue:** Plan specifies `import umap` / `umap.UMAP()` but umap-learn cannot install on Python 3.14 (numba/llvmlite incompatibility, documented in 05-01 decisions)
- **Fix:** Used `sklearn.manifold.TSNE` with equivalent parameters (n_components=2, random_state=42, metric="cosine")
- **Files modified:** app/services/reduction_service.py
- **Verification:** `TSNE(n_components=2, random_state=42).fit_transform(np.random.rand(50, 768))` produces (50, 2) shape
- **Committed in:** 5116acc (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Expected deviation documented in plan's IMPORTANT NOTE and 05-01 decisions. No scope creep; t-SNE is a direct substitute.

## Issues Encountered

None - scikit-learn was already installed and t-SNE API is compatible with the plan's UMAP usage.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 2D coordinates endpoint ready for Plan 03's deck.gl scatter plot
- GET /coordinates returns the exact JSON shape the frontend needs: {sampleId, x, y, fileName, thumbnailPath}
- Reduction status integrated with existing /status endpoint (has_reduction flag)
- No blockers for Plan 03

---
*Phase: 05-embeddings-visualization*
*Completed: 2026-02-11*
