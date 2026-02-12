# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-12)

**Core value:** A single tool that replaces scattered scripts: load any CV dataset, visually browse with annotation overlays, compare GT vs predictions, cluster via embeddings, and surface mistakes -- all in one workflow.
**Current focus:** Phase 8 — Docker Deployment & Auth

## Current Position

Phase: 8 of 13 (Docker Deployment & Auth)
Plan: 2 of 5 in current phase
Status: In progress
Last activity: 2026-02-12 — Completed 08-02-PLAN.md

Progress: [████░░░░░░░░░░░░░░░░] 8% (v1.1: 1/5 plans in phase 8)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 21
- Average duration: 3.9 min
- Total execution time: 82 min

**By Phase (v1.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Data Foundation | 4/4 | 14 min | 3.5 min |
| 2. Visual Grid | 3/3 | 15 min | 5.0 min |
| 3. Filtering & Search | 2/2 | 10 min | 5.0 min |
| 4. Predictions & Comparison | 3/3 | 9 min | 3.0 min |
| 5. Embeddings & Visualization | 4/4 | 16 min | 4.0 min |
| 6. Error Analysis & Similarity | 2/2 | 9 min | 4.5 min |
| 7. Intelligence & Agents | 3/3 | 9 min | 3.0 min |

**By Phase (v1.1):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 8. Docker Deployment & Auth | 1/5 | 2 min | 2.0 min |
| 9. Smart Ingestion | — | — | — |
| 10. Annotation Editing | — | — | — |
| 11. Error Triage | — | — | — |
| 12. Interactive Viz & Discovery | — | — | — |
| 13. Keyboard Shortcuts | — | — | — |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.1 Roadmap]: Keep Qdrant in local mode for Docker (single-user <1M vectors)
- [v1.1 Roadmap]: Caddy over nginx for reverse proxy (auto-HTTPS, built-in basic_auth)
- [v1.1 Roadmap]: react-konva for annotation editing in detail modal only (SVG stays for grid)
- [v1.1 Roadmap]: FastAPI HTTPBasic DI over middleware (testable, composable)
- [08-02]: NEXT_PUBLIC_API_URL=/api baked at build time for same-origin API via Caddy
- [08-02]: Caddy handles all auth at proxy layer -- zero application code changes

### Pending Todos

None.

### Blockers/Concerns

- [P1] DuckDB WAL files must persist via directory mount (not file mount) in Docker
- [P5] SVG-to-Canvas coordinate mismatch requires explicit conversion utilities for Phase 10

## Session Continuity

Last session: 2026-02-12
Stopped at: Completed 08-02-PLAN.md (frontend Dockerfile + Caddyfile)
Resume file: None
