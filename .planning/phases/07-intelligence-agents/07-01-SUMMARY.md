---
phase: 07-intelligence-agents
plan: 01
subsystem: api
tags: [pydantic-ai, llm, agent, duckdb, error-analysis, fastapi]

# Dependency graph
requires:
  - phase: 06-error-analysis-similarity
    provides: categorize_errors() service and ErrorAnalysisResponse models
provides:
  - POST /datasets/{id}/analyze endpoint with structured AnalysisReport
  - Pydantic AI agent with 4 DuckDB query tools
  - VLM router stub (POST /auto-tag, GET /auto-tag/progress)
  - agent_model and vlm_device config settings
affects: [07-02 VLM auto-tagging, 07-03 frontend intelligence UI]

# Tech tracking
tech-stack:
  added: [pydantic-ai-slim 1.58.0]
  patterns: [lazy agent instantiation, RunContext dependency injection, agent tool DuckDB queries]

key-files:
  created:
    - app/models/agent.py
    - app/services/agent_service.py
    - app/routers/agent.py
    - app/routers/vlm.py
  modified:
    - pyproject.toml
    - app/config.py
    - app/main.py

key-decisions:
  - "Lazy agent creation via _get_agent() to defer model resolution until first call"
  - "Error samples passed through AnalysisDeps dataclass (in-memory, not materialized to DuckDB table)"
  - "Confidence distribution computed in-memory from error samples (not DuckDB query)"
  - "VLM router stub returns 501 for auto-tag and idle status for progress"
  - "Agent endpoint returns 503 with clear message when API key is missing"

patterns-established:
  - "Pydantic AI agent with RunContext[Deps] pattern for tool dependency injection"
  - "Lazy agent singleton with module-level cache for configurable model"
  - "Router stub pattern: 501 placeholder for endpoints filled by later plans"

# Metrics
duration: 3min
completed: 2026-02-12
---

# Phase 7 Plan 1: Agent Infrastructure Summary

**Pydantic AI agent with 4 DuckDB query tools for error pattern analysis, structured AnalysisReport output, and VLM router stub**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-12T12:29:38Z
- **Completed:** 2026-02-12T12:32:49Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Installed pydantic-ai-slim 1.58.0 and created PatternInsight, Recommendation, AnalysisReport Pydantic models with Field descriptions for LLM schema understanding
- Built agent service with 4 tools: error summary, per-class annotation counts, tag-error correlation, and confidence distribution bucketing
- Wired POST /datasets/{id}/analyze endpoint with 404/503/500 error handling, plus VLM router stub ready for Plan 02

## Task Commits

Each task was committed atomically:

1. **Task 1: Install pydantic-ai-slim, create agent models and service** - `8a710f0` (feat)
2. **Task 2: Create routers, update config, wire into app** - `e89925a` (feat)

## Files Created/Modified
- `app/models/agent.py` - PatternInsight, Recommendation, AnalysisReport, AnalysisRequest Pydantic models
- `app/services/agent_service.py` - Pydantic AI agent with 4 DuckDB tools and run_analysis() entry point
- `app/routers/agent.py` - POST /datasets/{id}/analyze endpoint with error handling
- `app/routers/vlm.py` - Stub router for VLM auto-tagging (501 placeholder)
- `app/config.py` - Added agent_model and vlm_device settings
- `app/main.py` - Wired agent and vlm routers
- `pyproject.toml` - Added pydantic-ai-slim dependency

## Decisions Made
- **Lazy agent instantiation:** Agent created on first `run_analysis()` call via `_get_agent()` with module-level cache, avoiding import-time side effects and allowing settings to be read after app initialization
- **In-memory error samples in deps:** Error samples from `categorize_errors()` passed through `AnalysisDeps.error_samples` dict rather than materializing to a DuckDB temp table -- simpler and sufficient since error samples are already capped at 50 per type
- **Confidence distribution in-memory:** Bucketed in Python from error samples rather than a DuckDB query, since the data is already in-memory from categorize_errors()
- **503 for missing API key:** ValueError from agent service mapped to HTTP 503 with actionable message about which env vars to configure

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The agent model defaults to `openai:gpt-4o` and requires `OPENAI_API_KEY` to be set when the `/analyze` endpoint is actually called. Without it, the endpoint returns a clear 503 error.

## Next Phase Readiness
- Agent infrastructure complete, ready for Plan 02 (VLM auto-tagging) and Plan 03 (frontend intelligence UI)
- VLM router stub is wired and ready for Moondream2 implementation
- Config has vlm_device setting ready for VLM model loading

---
*Phase: 07-intelligence-agents*
*Completed: 2026-02-12*
