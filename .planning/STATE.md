# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-12)

**Core value:** A single tool that replaces scattered scripts: load any CV dataset, visually browse with annotation overlays, compare GT vs predictions, cluster via embeddings, and surface mistakes -- all in one workflow.
**Current focus:** Phase 11 in progress -- Error Triage. Plan 01 complete, Plan 02 next.

## Current Position

Phase: 11 of 13 (Error Triage) -- IN PROGRESS
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-02-13 -- Completed 11-01-PLAN.md

Progress: [████████████████████████████████████████████░░░░░░░░░░] 80% (v1.1: 32/40 plans complete)

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
| 8. Docker Deployment & Auth | 5/5 | 25 min | 5.0 min |
| 9. Smart Ingestion | 2/2 | 10 min | 5.0 min |
| 10. Annotation Editing | 3/3 | 9 min | 3.0 min |
| 11. Error Triage | 1/2 | 3 min | 3.0 min |
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
- [08-01]: CPU-only PyTorch via post-sync replacement in Dockerfile (uv sync then uv pip install from CPU index)
- [08-01]: CORS restricted to localhost:3000 in dev, disabled entirely behind proxy (DATAVISOR_BEHIND_PROXY=true)
- [08-02]: NEXT_PUBLIC_API_URL=/api baked at build time for same-origin API via Caddy
- [08-02]: Caddy handles all auth at proxy layer -- zero application code changes
- [08-03]: Directory bind mount ./data:/app/data for DuckDB WAL + Qdrant + thumbnails persistence
- [08-03]: AUTH_PASSWORD_HASH has no default -- forces explicit auth configuration before deployment
- [08-03]: Only Caddy exposes ports 80/443 -- backend and frontend are Docker-internal only
- [08-04]: VM startup script does NOT auto-start docker compose -- requires manual .env setup first
- [08-04]: GCP config via env vars with defaults (only GCP_PROJECT_ID required)
- [08-05]: 10-section deployment docs covering local Docker, GCP, custom domain HTTPS, data persistence, troubleshooting
- [08-05]: opencv-python-headless replaces opencv-python in Docker builder stage (no X11/GUI libs in slim images)
- [09-01]: Three-layout priority detection: Roboflow > Standard COCO > Flat
- [09-01]: ijson peek at top-level keys for COCO detection (max 10 keys, files >500MB skipped)
- [09-01]: Optional dataset_id param on ingest_with_progress for multi-split ID sharing
- [09-01]: INSERT-or-UPDATE pattern for dataset record across multi-split imports
- [09-02]: POST SSE streaming via fetch + ReadableStream (not EventSource, which is GET-only)
- [09-02]: FolderScanner refactored to accept StorageBackend for GCS support
- [09-02]: Split-prefixed IDs for collision avoidance in multi-split import
- [10-01]: get_cursor DI for annotation router (auto-close cursor)
- [10-01]: source='ground_truth' enforced in SQL WHERE clauses for PUT/DELETE safety
- [10-01]: Dataset counts refreshed via subquery UPDATE (no race conditions)
- [10-02]: useDrawLayer hook pattern (handlers + ReactNode) instead of separate component
- [10-02]: Transformer scale reset to 1 on transformEnd (Konva best practice)
- [10-03]: AnnotationEditor loaded via next/dynamic with ssr:false (prevents Konva SSR errors)
- [10-03]: Draw completion shows ClassPicker before creating annotation (requires category selection)
- [10-03]: Delete buttons only appear on ground_truth rows when edit mode is active
- [11-01]: Dual router pattern (samples_router + datasets_router) from single triage module
- [11-01]: Atomic triage tag replacement via list_filter + list_append single SQL
- [11-01]: get_db DI pattern for triage router (matching statistics.py style)

### Pending Todos

None.

### Blockers/Concerns

- [RESOLVED] SVG-to-Canvas coordinate mismatch resolved by coord-utils.ts (10-02)

## Session Continuity

Last session: 2026-02-13
Stopped at: Completed 11-01-PLAN.md -- Phase 11 in progress
Resume file: None
