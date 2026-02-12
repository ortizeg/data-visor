---
phase: 08-docker-deployment-auth
plan: 01
subsystem: infra
tags: [docker, dockerfile, multi-stage-build, uv, pytorch-cpu, cors, duckdb-checkpoint]

# Dependency graph
requires:
  - phase: 07-intelligence-agents
    provides: "Complete v1.0 backend application (app/, plugins/, pyproject.toml)"
provides:
  - "Dockerfile.backend with multi-stage Python 3.14 + uv build"
  - "CPU-only PyTorch in Docker to avoid CUDA bloat"
  - "Conditional CORS middleware (off when behind proxy)"
  - "DuckDB WAL flush on clean shutdown via CHECKPOINT"
  - ".dockerignore for efficient build context"
affects: [08-02, 08-03, 08-04, 08-05]

# Tech tracking
tech-stack:
  added: [docker, uv-in-docker]
  patterns: [multi-stage-docker-build, conditional-cors, duckdb-checkpoint-on-shutdown]

key-files:
  created: [Dockerfile.backend, .dockerignore]
  modified: [app/config.py, app/main.py]

key-decisions:
  - "CPU-only PyTorch via post-sync replacement: uv sync first, then uv pip install torch from CPU index"
  - "CORS restricted to http://localhost:3000 in dev (was wildcard * which is spec-invalid with credentials)"
  - "behind_proxy setting controls CORS; set DATAVISOR_BEHIND_PROXY=true in Docker to disable CORS entirely"

patterns-established:
  - "Multi-stage Docker: builder (uv + deps) -> runner (python:3.14-slim + curl)"
  - "Conditional middleware via settings: check config at module level before adding middleware"
  - "DuckDB CHECKPOINT before close in lifespan shutdown"

# Metrics
duration: 4min
completed: 2026-02-12
---

# Phase 8 Plan 01: Backend Dockerfile & Config Fixes Summary

**Multi-stage Python 3.14 + uv Dockerfile with CPU-only PyTorch, conditional CORS, and DuckDB WAL flush on shutdown**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-12T22:00:19Z
- **Completed:** 2026-02-12T22:04:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Multi-stage Dockerfile.backend producing a 1.94GB image with all production Python deps
- CPU-only PyTorch replacement step prevents CUDA wheel bloat on x86_64 deployments
- CORS spec violation fixed: was `allow_origins=["*"]` + `allow_credentials=True` (silently rejected by browsers), now `["http://localhost:3000"]` in dev, disabled entirely behind proxy
- DuckDB CHECKPOINT on shutdown ensures WAL is flushed to disk before container stops

## Task Commits

Each task was committed atomically:

1. **Task 1: Create multi-stage backend Dockerfile** - `5a0afdf` (feat)
2. **Task 2: Add behind_proxy setting and fix CORS + DuckDB shutdown** - `ceed019` (fix)

## Files Created/Modified
- `Dockerfile.backend` - Two-stage build: python:3.14-slim builder with uv, slim runner with curl for health checks
- `.dockerignore` - Excludes data/, .venv/, tests/, frontend/, .planning/ from build context
- `app/config.py` - Added `behind_proxy: bool = False` setting (env: DATAVISOR_BEHIND_PROXY)
- `app/main.py` - Conditional CORS middleware + DuckDB CHECKPOINT before db.close()

## Decisions Made
- **CPU torch approach:** Install all deps via `uv sync --frozen`, then replace torch with CPU-only build via `uv pip install torch --index-url https://download.pytorch.org/whl/cpu`. On ARM64 (Apple Silicon) this is a no-op since standard PyPI wheels lack CUDA; on x86_64 (GCP) this replaces the ~2.5GB CUDA wheel with the ~140MB CPU wheel.
- **CORS origin:** Changed from wildcard `["*"]` to explicit `["http://localhost:3000"]`. The wildcard + credentials combination is a CORS spec violation that browsers silently reject.
- **No gunicorn:** Single uvicorn worker is correct for DuckDB's single-writer constraint in this single-user tool.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created .dockerignore**
- **Found during:** Task 1 (Dockerfile creation)
- **Issue:** No .dockerignore existed; Docker build would copy data/, .venv/, tests/, frontend/ into build context
- **Fix:** Created .dockerignore excluding unnecessary directories
- **Files modified:** .dockerignore
- **Verification:** Docker build context was 782KB instead of potentially gigabytes
- **Committed in:** 5a0afdf (Task 1 commit)

**2. [Rule 1 - Bug] Fixed CPU torch installation order**
- **Found during:** Task 1 (Docker build verification)
- **Issue:** Initial approach (install CPU torch BEFORE uv sync) failed because uv sync replaced torch==2.10.0+cpu with torch==2.10.0 from lockfile (different version string)
- **Fix:** Reversed order: uv sync first (installs standard torch), then replace with CPU torch via uv pip install
- **Files modified:** Dockerfile.backend
- **Verification:** Docker build completes successfully, image is 1.94GB
- **Committed in:** 5a0afdf (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correct Docker build behavior. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dockerfile.backend is ready to be referenced in docker-compose.yml (Plan 03)
- behind_proxy setting is ready for Docker Compose environment variable DATAVISOR_BEHIND_PROXY=true
- CHECKPOINT ensures clean DuckDB shutdown when `docker compose down` sends SIGTERM
- All 59 existing tests pass (no regressions)

---
*Phase: 08-docker-deployment-auth*
*Completed: 2026-02-12*
