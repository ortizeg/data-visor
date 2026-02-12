# Project Research Summary: DataVisor v1.1

**Project:** DataVisor v1.1 — Deployment, Workflow & Competitive Parity
**Milestone Focus:** Docker deployment, single-user auth, smart dataset ingestion, annotation editing, error triage workflow, keyboard shortcuts
**Researched:** 2026-02-12
**Overall Confidence:** HIGH

---

## Executive Summary

DataVisor v1.1 builds on a proven v1.0 foundation (12,720 LOC, 59 tests) to add production deployment and competitive features. Research across stack, features, architecture, and pitfalls reveals a clear path: **prioritize Docker deployment with Caddy reverse proxy, then layer on smart ingestion and error triage workflows**.

The recommended approach uses **three-service Docker Compose** (backend, frontend, caddy) with Qdrant remaining in local embedded mode. This simplifies deployment while maintaining single-user focus. Auth is handled at two layers: Caddy's basic_auth for edge protection plus FastAPI dependency injection for API-level defense in depth. The smart ingestion UI uses a folder scanner service that detects COCO/YOLO structures and presents suggestions for user confirmation. Annotation editing adds react-konva ONLY in the detail modal (keeping SVG for grid read-only overlays). The error triage workflow extends the existing error analysis system with DuckDB persistence and a focused keyboard-driven review mode.

**Critical architectural decisions validated:**
1. **Keep Qdrant in local mode for Docker** — single-user workload does not justify server mode complexity. Conditional client initialization supports both modes.
2. **Caddy over nginx for reverse proxy** — automatic HTTPS via Let's Encrypt, built-in basic_auth, simpler config for single-VM deployment.
3. **react-konva for annotation editing** — v19.2.0 explicitly supports React 19. Konva Transformer provides resize handles out of the box.
4. **FastAPI HTTPBasic dependency injection** — more testable and composable than middleware for single-user auth.

**Key risks addressed upfront:**
- **DuckDB WAL files lost on container restart** (P1) — mount entire data/ directory, add CHECKPOINT on shutdown
- **NEXT_PUBLIC_API_URL baked at build time** (P3) — use Caddy reverse proxy to serve frontend and API from same origin
- **Basic auth over HTTP exposes credentials** (P4) — Caddy handles HTTPS automatically
- **SVG-to-Canvas coordinate mismatch** (P5) — keep SVG for read-only, use Konva ONLY for edit mode with explicit coordinate conversion

With these patterns, v1.1 delivers GCP-deployable production quality while adding FiftyOne/Encord competitive features (smart ingestion, error triage, annotation editing) that the existing v1.0 architecture supports naturally.

---

## Key Findings

### From STACK.md: Technologies for v1.1

The v1.1 stack extends v1.0 with deployment and UX libraries. All choices are validated against official documentation and production usage.

**Docker deployment stack:**
- **Docker Compose** — three services: backend (FastAPI + DuckDB + Qdrant local), frontend (Next.js standalone), caddy (reverse proxy + HTTPS + auth)
- **Caddy 2-alpine** — automatic HTTPS, built-in basic_auth, 10-line Caddyfile vs nginx's verbose config
- **Qdrant local mode** — existing `QdrantClient(path=...)` works in Docker via volume mount. No server container needed for <1M vectors single-user.
- **Python 3.14-slim base** — avoids musl compilation issues (alpine would break torch/numpy wheels)
- **Node 22-alpine** — Next.js 16 standalone output reduces image from ~1GB to ~150MB

**Authentication stack:**
- **FastAPI HTTPBasic** (built-in) — zero new dependencies, works with Caddy's basic_auth for defense in depth
- **Caddy basic_auth directive** — edge protection with bcrypt password hashing via `caddy hash-password`

**Frontend interaction stack:**
- **react-konva 19.2.0 + konva 10.2.0** — Canvas-based bbox editing with Transformer (resize/rotate handles). v19 explicitly for React 19.
- **react-hotkeys-hook 5.2.4** — declarative keyboard shortcuts with scoping. 3KB, actively maintained (published 9 days ago).

**What NOT to add:**
- Qdrant server container — local mode sufficient, eliminates complexity
- Gunicorn — single-user tool, one uvicorn worker is enough
- JWT/OAuth2 — HTTP Basic Auth sufficient for personal deployment
- Nginx — Caddy's auto-HTTPS wins decisively for single-VM
- Fabric.js — no official React wrapper, imperative API fights React model
- cmdk — command palette is nice-to-have, not needed for v1.1 shortcuts

**New frontend dependencies (total ~76KB gzipped):**
```
npm install konva@^10.2.0 react-konva@^19.2.0 react-hotkeys-hook@^5.2.4
```

**Backend: ZERO new Python dependencies** — auth uses FastAPI built-ins, smart ingestion uses pathlib + existing fsspec

**Confidence:** HIGH — every dependency verified via official docs and npm/PyPI version checks

### From FEATURES.md: Competitive Gap Analysis

Competitive analysis of DataVisor vs FiftyOne (Voxel51) and Encord reveals 16 features across 6 categories. v1.1 closes table stakes gaps while adding differentiators.

**MUST build for v1.1 (16 features):**

| Feature | Priority | Complexity | Competitor Reference |
|---------|----------|------------|---------------------|
| YOLO + VOC format import | Table Stakes | Medium | FiftyOne supports 15+ formats; missing YOLO is critical gap |
| Train/val/test split handling | Table Stakes | Medium | FiftyOne tags samples with split; every real dataset has splits |
| Smart folder detection UI | Differentiator | Medium | Neither FiftyOne nor Encord auto-detects — opportunity to leapfrog |
| Dataset export (COCO, YOLO) | Table Stakes | Medium | FiftyOne exports to all import formats; completes curation loop |
| Bbox editing (move/resize/delete) | Table Stakes | High | Encord has full editor; FiftyOne delegates to CVAT. DataVisor targets "quick corrections only" |
| Interactive confusion matrix | Table Stakes | High | FiftyOne's killer feature — click cell to filter to GT/pred pairs |
| Near-duplicate detection | Table Stakes | Low | FiftyOne Brain + Encord Active both provide this |
| Image quality metrics | Table Stakes | Low | Brightness, sharpness, contrast for AI agent |
| Error triage mode | Differentiator | Medium | FiftyOne is programmatic; Encord is multi-stage. Keyboard-driven review is faster |
| Worst images composite ranking | Differentiator | Medium | Neither competitor has single composite "badness" score |
| Docker deployment | Table Stakes | Medium | FiftyOne Enterprise has Helm chart; OSS has Dockerfile |
| Basic auth | Table Stakes | Low | FiftyOne OSS has none; Enterprise has full RBAC |
| Deployment scripts (local + GCP) | Table Stakes | Low-Medium | FiftyOne provides SSH tunnel; DataVisor targets cloud VM |
| Keyboard shortcuts (Tier 1) | Table Stakes | Medium | FiftyOne has partial support; Encord has comprehensive shortcuts |
| "Find Similar" UI button | Table Stakes | Low | Existing Qdrant infrastructure, just needs UI exposure |
| Interactive histograms | Differentiator | Medium | FiftyOne has this; click bar to filter grid |

**DEFER to v1.2+ (9 features):**
- Create new annotations — edit/delete sufficient for v1.1
- CVAT/Label Studio integration — export achieves same goal
- PR curves + per-class AP — confusion matrix is priority
- Mistakenness/hardness scoring — requires model logits import
- Custom workspaces — current layout works
- Customizable hotkeys — fixed defaults sufficient
- Model zoo / in-app inference — import predictions workflow is pragmatic
- View expression Python API — UI filtering covers 90%
- Demo/quickstart dataset — nice for onboarding but not core

**OUT OF SCOPE:**
- 3D point cloud viz — different rendering pipeline (per PROJECT.md)
- Video support — image-only for now (per PROJECT.md)
- Map/geolocation — no current geo dataset need
- Multi-user auth — personal tool (per PROJECT.md)

**Build order dependencies:**
```
[Docker + Auth + Deploy] (parallel foundation)
     |
     v
[YOLO + VOC Parsers] -> [Smart Folder Detection] -> [Split Handling]
     |
     v
[Dataset Export] (requires format writers)
     |
     v
[Image Quality Metrics] -> [Near-Duplicate Detection] -> [Composite Score]
     |                                                       |
     v                                                       v
[Bbox Editing] -> [Keyboard Shortcuts] -> [Error Triage Mode]
     |                                           |
     v                                           v
[Interactive Confusion Matrix] -> [Click-to-Filter]
     |
     v
[Interactive Histograms]
     |
     v
["Find Similar" Button]
```

**Confidence:** HIGH — grounded in official FiftyOne/Encord documentation

### From ARCHITECTURE.md: Feature Integration

Architecture research analyzed the existing v1.0 codebase (12,720 LOC, 50+ files) to identify integration points for v1.1 features.

**Current v1.0 architecture snapshot:**
- **Backend:** FastAPI with 9 routers, 7 services, DuckDB (6 tables) + Qdrant local mode
- **Frontend:** Next.js 16 with 3 Zustand stores, 14 TanStack Query hooks, TanStack Virtual grid
- **Key properties:** DuckDB single-connection cursor-per-request, Qdrant local mode, SVG annotation overlays, SSE for progress streams

**Feature 1: Docker Deployment**

Three-service topology (NOT four — Qdrant stays local):
```
[caddy :80/:443] -> [backend :8000 (FastAPI + DuckDB + Qdrant local)]
                 -> [frontend :3000 (Next.js standalone)]
```

**Integration points:**
- Create: `Dockerfile.backend`, `Dockerfile.frontend`, `docker-compose.yml`, `nginx/default.conf`
- Modify: `app/config.py` (add `qdrant_url` for conditional mode), `similarity_service.py` (conditional client), `next.config.ts` (add `output: "standalone"`)

**Qdrant mode switch:**
```python
# Conditional: local mode (dev) vs server mode (optional future)
if settings.qdrant_url:
    self.client = QdrantClient(url=settings.qdrant_url)
else:
    self.client = QdrantClient(path=str(path))  # existing
```

**Critical decisions:**
- Keep Qdrant local — single-user <1M vectors does not need server container
- Use Caddy reverse proxy — NEXT_PUBLIC_API_URL becomes `/api/` (same origin, no CORS)
- Multi-stage builds — backend ~4GB (PyTorch CPU-only), frontend ~150MB
- Single uvicorn worker — DuckDB single-writer constraint preserved

**Feature 2: Single-User Auth**

FastAPI dependency injection pattern (NOT middleware):
```python
# app/auth.py
def verify_auth(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    # secrets.compare_digest to prevent timing attacks
    ...

# app/main.py
app.include_router(datasets.router, dependencies=[Depends(verify_auth)])
```

**Why DI over middleware:**
- Existing codebase uses Depends() for 9 dependencies already
- Easier to exclude /health endpoint
- Testable and composable
- Recommended by FastAPI community (GitHub Discussion #8867)

**SSE auth challenge:** EventSource cannot set Authorization headers. Solution: cookie-based session after initial Basic Auth login.

**Feature 3: Smart Ingestion UI**

New folder scanner service detects dataset structures:
```
POST /ingestion/scan { root_path }
  -> FolderScanner.scan()
  -> ScanResult { annotation_files, image_dirs, suggested_imports }
  -> Frontend: confirmation UI
  -> POST /datasets/ingest (existing SSE endpoint)
```

**Integration points:**
- Create: `app/services/folder_scanner.py`, `app/routers/ingestion.py`, `app/models/scan.py`
- Modify: `app/models/dataset.py` (add `split` field), `ingestion.py` (pass split to parser)
- Frontend: new `/ingest` page with scan results display

**Feature 4: Annotation Editing**

**Critical observation:** Existing overlay is SVG, NOT react-konva. Architecture decision: use Konva ONLY in detail modal, keep SVG for grid.

```
sample-modal.tsx
  |-- [Read-only mode] AnnotationOverlay (SVG, existing)
  |-- [Edit mode] AnnotationEditor (NEW, react-konva)
        |-- <Stage><Layer>
        |     |-- <Image> (background)
        |     |-- <Rect draggable /> (per annotation)
        |     |-- <Transformer /> (resize handles)
```

**New backend endpoints:**
- `PATCH /annotations/batch` — update bbox coordinates
- `DELETE /annotations/{id}` — remove annotation

**Data flow:**
```
User clicks "Edit" -> AnnotationEditStore.startEditing()
  -> Modal switches to Konva
  -> User drags/resizes (Konva handles visuals)
  -> "Save" -> PATCH /annotations/batch
  -> Invalidate TanStack Query cache
  -> Modal switches back to SVG
```

**Coordinate normalization critical:** Konva Transformer modifies scaleX/scaleY, not width/height. Must normalize:
```typescript
const sx = node.scaleX(), sy = node.scaleY();
node.scaleX(1); node.scaleY(1);
const newW = node.width() * sx;
const newH = node.height() * sy;
```

**Feature 5: Error Triage Workflow**

Extends existing `error_analysis.py` with tagging and ranking:

**New DuckDB table:**
```sql
CREATE TABLE triage_labels (
    annotation_id VARCHAR,
    dataset_id VARCHAR,
    label VARCHAR,  -- 'confirmed', 'dismissed', 'needs_review'
    created_at TIMESTAMP
)
```

**New components:**
- `app/routers/triage.py` — CRUD for triage labels
- `app/services/triage_service.py` — "worst images" ranking algorithm
- Frontend: `triage-store.ts` (5th Zustand store), `triage-action-bar.tsx`, `worst-images-panel.tsx`

**Worst images ranking:**
```python
score = (2 * hard_fp_count) + (3 * label_error_count) + (1 * fn_count)
        + (0.5 * low_confidence_count) - (0.1 * tp_count)
```

**Feature 6: Keyboard Shortcuts**

react-hotkeys-hook for declarative shortcuts:
```typescript
useHotkeys('shift+/', () => openShortcutHelp(true));
useHotkeys('g', () => setActiveTab('grid'));
useHotkeys('/', () => document.querySelector('[data-shortcut-target="search"]')?.focus());
```

**Tier 1 shortcuts (v1.1):**
- `?` — help overlay
- Arrow keys — prev/next sample
- `Escape` — close modal
- `Space` — toggle label visibility
- `Delete` — delete annotation (edit mode)
- `Ctrl+Z` — undo (edit mode)
- `1-9` — quick-assign class

**Scoping:** Component-level via react-hotkeys-hook's ref scoping. Prevents firing when input fields are focused.

**Build order:**
```
Phase 1: Docker Deployment (enables cloud deployment)
  -> Phase 2: Auth (enables secure access)
    -> Phase 3: Smart Ingestion (parallel with 4, 5)
    -> Phase 4: Error Triage (parallel with 3, 5)
    -> Phase 5: Annotation Editing (parallel with 3, 4)
  -> Phase 6: Keyboard Shortcuts (last, layers on all UI)
```

**New files:** 13 backend, 14 frontend
**Modified files:** 17 (app/config.py, main.py, repositories, services; frontend stores, components)
**New Zustand stores:** 2 (annotation-edit-store, triage-store) — total 5 stores

**Confidence:** HIGH — grounded in codebase analysis (12,720 LOC verified) + official docs

### From PITFALLS.md: Domain-Specific Risks

Pitfall research identified 16 risks across Docker, auth, annotation editing, ingestion, and deployment.

**CRITICAL pitfalls (5):**

**P1: DuckDB WAL file loss on Docker restart**
- **Risk:** WAL file created alongside .duckdb file. If container killed before clean shutdown, WAL persists. If volume mounts only the .duckdb file (not directory), WAL vanishes -> silent data loss.
- **Prevention:** Mount entire `data/` directory. Set `stop_grace_period: 30s`. Add `CHECKPOINT` in lifespan shutdown. Set `checkpoint_threshold='8MB'` for more frequent checkpoints.

**P2: Qdrant local mode works fine in Docker (clarification)**
- **Research update:** Local mode CAN run in Docker. The earlier concern was unfounded — local mode via `QdrantClient(path=...)` works with volume mount. Server mode is optional for multi-worker scenarios.
- **Decision:** Keep local mode for v1.1. Conditional switch supports future migration.

**P3: NEXT_PUBLIC_API_URL baked at build time**
- **Risk:** `NEXT_PUBLIC_*` vars are inlined during `next build`. Built image has hardcoded API URL. Cannot change at runtime.
- **Prevention:** Use Caddy reverse proxy to serve frontend and backend from same origin. Frontend calls `/api/` which Caddy routes to backend:8000. No CORS, no URL config needed.

**P4: Basic auth over HTTP exposes credentials**
- **Risk:** Base64 encoding is not encryption. HTTP transmits credentials in cleartext.
- **Prevention:** Caddy provides automatic HTTPS via Let's Encrypt (zero config). EventSource (SSE) limitation requires cookie-based session, not per-request Basic Auth headers.

**P5: SVG-to-Canvas coordinate mismatch**
- **Risk:** SVG uses viewBox with preserveAspectRatio for automatic scaling. Konva uses Stage/Layer coordinates with manual scale. Transformer changes scaleX/scaleY, not width/height. Annotations can drift if coordinates not normalized.
- **Prevention:** Compute single scale factor on load. Normalize Transformer scale to 1 on dragEnd/transformEnd. Write utility functions `toPixelSpace()` and `toDisplaySpace()` for all conversions. Keep SVG for read-only, Konva ONLY for edit mode.

**MAJOR pitfalls (5):**

**P6: Docker image bloat (8-12GB)**
- **Risk:** PyTorch + transformers with CUDA = ~8GB image. Build takes 30+ min, push/pull times out.
- **Prevention:** Use CPU-only PyTorch (200MB vs 2.5GB). Multi-stage build. `--no-cache-dir` everywhere. Pin versions.

**P7: DuckDB annotation mutations without transactions**
- **Risk:** v1.0 is read-heavy append-only. v1.1 adds UPDATE/DELETE. No PRIMARY KEY enforcement. Concurrent edits may conflict. Denormalized counts can drift.
- **Prevention:** Wrap mutations in explicit transactions. Recompute counts from source tables. Verify annotation ID uniqueness in app code.

**P8: Smart folder detection edge cases**
- **Risk:** Datasets use 20+ conventions (COCO, YOLO, Roboflow, CVAT, custom). Detection heuristic cannot handle all. Dangerous: folder named `train/` containing train images (not training data).
- **Prevention:** Detection is suggestion, not action. Show confidence scores. Manual override. Start COCO-only. Depth limit (3 levels max). No symlinks.

**P9: GCP firewall blocks all ports by default**
- **Risk:** GCP has default-deny inbound. VM starts, docker-compose runs, but `http://35.x.x.x:3000` times out. Developer spends 30 min debugging Docker before realizing it's firewall.
- **Prevention:** Deployment script creates firewall rules automatically. Use port 80/443 only. Qdrant port 6333 NOT exposed (internal only). Tag VM and scope rules.

**P10: Error triage state lost on page refresh**
- **Risk:** Triage decisions in Zustand only. User tags 50 errors, refreshes page, all gone. 100K dataset with 5000 errors = significant manual work lost.
- **Prevention:** Persist to DuckDB immediately. Debounce 500ms for rapid changes. Optimistic updates (Zustand first, DuckDB background). Use existing `samples.tags` column.

**MODERATE pitfalls (4):**

**P11: Docker volume mounts break image path resolution** — Store relative paths or path remap
**P12: Keyboard shortcuts conflict with browser defaults** — Check activeElement, use modifiers for destructive actions
**P13: CORS wildcard + credentials is spec-invalid** — Remove CORS via reverse proxy
**P14: GCP persistent disk not auto-mounted on restart** — Add fstab entry with `nofail`

**MINOR pitfalls (2):**

**P15: Annotation delete without undo** — Soft delete or undo buffer
**P16: docker-compose OOMs on small VMs** — Lazy model loading, document e2-standard-4 minimum

**Integration pitfall matrix:**

| Feature | Existing Component | Pitfall | Prevention |
|---------|-------------------|---------|------------|
| Docker | DuckDB file | P1: WAL loss | Mount `data/` dir, CHECKPOINT shutdown |
| Docker | Next.js env | P3: Build-time URL | Caddy reverse proxy (same origin) |
| Docker | PyTorch | P6: 8GB image | CPU-only torch, multi-stage |
| Auth | SSE streams | P4: EventSource headers | Cookie-based session |
| Auth | CORS | P13: Wildcard+creds | Reverse proxy removes CORS |
| Annotation Edit | SVG overlay | P5: Coord mismatch | Keep SVG read-only, Konva edit-only |
| Annotation Edit | DuckDB | P7: No transactions | Explicit transactions |
| Smart Ingestion | COCOParser | P8: Edge cases | Suggestion not action |
| Error Triage | Zustand | P10: State lost | Persist to DuckDB |
| GCP Deploy | Firewall | P9: Blocks ports | Script creates rules |

**Confidence:** MEDIUM-HIGH — critical pitfalls verified via official docs (DuckDB WAL, Next.js env vars, EventSource limitations). Edge cases (folder detection, Konva coords) based on community patterns.

---

## Implications for Roadmap

Based on synthesized research, **6 feature groupings** are recommended with clear dependencies and pitfall mitigation.

### Phase 1: Docker Deployment & Auth (Foundation)
**Why first:** Establishes cloud deployment scaffold. Every other feature builds on this. Critical pitfalls (P1, P3, P4, P13) MUST be addressed here — retrofit is extremely painful.

**Delivers:** GCP-deployable Docker Compose setup with automatic HTTPS and basic auth.

**Features:**
- Docker Compose (backend, frontend, caddy)
- Qdrant local mode with conditional switch
- Multi-stage Dockerfiles (CPU-only PyTorch)
- Caddy reverse proxy (HTTPS + basic_auth)
- FastAPI HTTPBasic dependency injection
- GCP deployment script + firewall rules
- Local run script

**Avoids pitfalls:**
- P1: Mount `data/` directory, CHECKPOINT on shutdown
- P3: Caddy serves frontend and API from same origin (no NEXT_PUBLIC_API_URL issue)
- P4: Caddy auto-HTTPS, cookie-based session for SSE
- P6: Multi-stage build, CPU-only torch, ~4GB backend image
- P9: Deployment script creates firewall rules
- P11: Path remapping for Docker volume mounts
- P13: Reverse proxy removes CORS entirely
- P14: fstab entry for persistent disk

**Dependencies:** NONE — foundational
**Research flag:** SKIP — Docker, Caddy, FastAPI auth are well-documented

### Phase 2: Smart Ingestion UI
**Why second:** Builds on Docker foundation (new endpoints need auth). Completes the "no-code dataset import" workflow.

**Delivers:** Point at folder, auto-detect structure, import with confirmation.

**Features:**
- Folder scanner service (detect COCO/YOLO/splits)
- Scan endpoint with structure detection
- Frontend ingestion wizard with preview
- Split detection in existing parser
- Multi-format support hooks (YOLO/VOC deferred to later)

**Avoids pitfalls:**
- P8: Detection is suggestion not action, confidence scores, manual override

**Dependencies:** Phase 1 (auth for new endpoints)
**Research flag:** SKIP — folder scanning patterns are standard

### Phase 3: Annotation Editing
**Why parallel with Phase 2/4:** Independent of ingestion and triage. Depends only on existing sample modal.

**Delivers:** Quick corrections in-app (move/resize/delete bboxes).

**Features:**
- react-konva integration in detail modal ONLY
- AnnotationEditor component with Transformer
- AnnotationEditStore (new Zustand store)
- PATCH /annotations/batch endpoint
- Coordinate normalization utilities

**Avoids pitfalls:**
- P5: Keep SVG read-only, Konva edit-only; explicit coord conversion
- P7: Explicit transactions for mutations
- P15: Soft delete or confirmation dialog

**Dependencies:** Phase 1 (modal exists, auth for new endpoint)
**Research flag:** SKIP — react-konva Transformer is documented

### Phase 4: Error Triage Workflow
**Why parallel with Phase 2/3:** Extends existing error analysis. Independent of ingestion and annotation editing.

**Delivers:** Keyboard-driven error review workflow with persistence.

**Features:**
- triage_labels DuckDB table
- Triage API endpoints
- TriageStore (new Zustand store)
- Worst images ranking algorithm
- Grid highlight/dim mode
- Keyboard shortcuts for triage (1/2/3 keys)

**Avoids pitfalls:**
- P10: Persist triage decisions to DuckDB immediately

**Dependencies:** Phase 1 (existing error analysis built in v1.0)
**Research flag:** SKIP — extends existing patterns

### Phase 5: Keyboard Shortcuts
**Why last:** Layers on top of all UI features. Must reference grid, modal, triage, annotation editing.

**Delivers:** Power-user keyboard navigation.

**Features:**
- react-hotkeys-hook integration
- Global shortcuts (tab switching, help)
- Component-level shortcuts (grid nav, modal nav, edit mode)
- Shortcut help overlay (? key)

**Avoids pitfalls:**
- P12: Check activeElement before handling, use modifiers for destructive actions

**Dependencies:** Phases 1-4 (shortcuts reference all UI)
**Research flag:** SKIP — react-hotkeys-hook is straightforward

### Phase 6: Competitive Features (Deferred to v1.2)
**Why deferred:** Core v1.1 delivers deployment + workflows. These add ecosystem value but are not blocking.

**Features:**
- YOLO + VOC parsers
- Dataset export (COCO, YOLO)
- Interactive confusion matrix + click-to-filter
- Near-duplicate detection
- Image quality metrics
- "Find Similar" UI button
- Interactive histograms

**Research flag:** SKIP — annotation format specs documented, existing patterns extend

---

### Phase Structure Summary

**Dependency graph:**
```
Phase 1 (Docker + Auth) — FOUNDATIONAL
    |
    +-> Phase 2 (Smart Ingestion) — NEW ENDPOINTS
    +-> Phase 3 (Annotation Edit) — PARALLEL
    +-> Phase 4 (Error Triage) — PARALLEL
    |
    v
Phase 5 (Keyboard Shortcuts) — LAYER ON ALL UI

Phase 6 (Competitive Features) — DEFERRED v1.2
```

**Rationale:**
- Phase 1 is non-negotiable foundation — Docker, auth, deployment
- Phases 2-4 can proceed in parallel (independent)
- Phase 5 references all UI, must come last
- Phase 6 deferred — core v1.1 is deployment + workflows

**Which phases need `/gsd:research-phase`?**
- **NONE** — all v1.1 features use well-documented patterns (Docker, Caddy, FastAPI auth, react-konva, react-hotkeys-hook)
- Phase 6 (if built in v1.2) also uses documented patterns (COCO/YOLO specs, Qdrant similarity)

**Critical path:**
- Phase 1 blocks everything (foundation)
- Phases 2-4 are independent (can parallelize)
- Phase 5 depends on 2-4 (shortcuts reference their UI)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | Every dependency verified: react-konva 19.2.0 for React 19, react-hotkeys-hook 5.2.4 (published 9 days ago), Caddy 2-alpine. Zero new backend deps (auth uses FastAPI built-ins). Versions confirmed via npm/PyPI. |
| **Features** | HIGH | Competitive analysis grounded in official FiftyOne v1.12.0 and Encord docs. 16 must-build features mapped to competitors. Dependencies validated (smart ingestion depends on auth, triage depends on error analysis). |
| **Architecture** | HIGH | Integration points verified against actual v1.0 codebase (12,720 LOC, 50+ files). Qdrant local mode decision reversed after deeper research (can run in Docker). Konva-only-for-edit pattern avoids grid performance issues. |
| **Pitfalls** | MEDIUM-HIGH | Critical pitfalls verified via official docs (DuckDB WAL behavior, Next.js NEXT_PUBLIC inlining, EventSource header limitations, Konva Transformer scale behavior). Edge cases (folder detection, Docker OOM) based on community patterns and GitHub issues. |

**Overall confidence:** **HIGH**

The stack is validated, features are grounded in competitive analysis, architecture patterns are proven against existing codebase, and pitfalls have clear prevention strategies. The main uncertainty (Qdrant local vs server) was resolved — local mode works fine for v1.1 single-user deployment.

### Gaps to Address During Implementation

**Docker volume semantics for DuckDB WAL:**
- Research confirmed WAL behavior and directory mount requirement, but real-world testing (kill -9 container, verify WAL replay) needed to validate prevention.

**Konva coordinate normalization at different image scales:**
- Transformer scale pattern documented, but implementation with real datasets (varied aspect ratios, zoom levels) will validate edge cases.

**GCS image serving with signed URL expiry:**
- Stack research mentioned GCS support exists (fsspec), but signed URL refresh during long browsing sessions needs implementation design.

**react-hotkeys-hook focus scoping with nested modals:**
- Documentation confirms scoping, but interaction between modal shortcuts (arrow keys) and edit mode shortcuts (delete) needs testing.

---

## Sources

### Stack Research (HIGH confidence)
- [Caddy Docker image](https://hub.docker.com/_/caddy) — caddy:2-alpine, automatic HTTPS
- [Caddy reverse proxy quickstart](https://caddyserver.com/docs/quick-starts/reverse-proxy)
- [Caddy basic_auth directive](https://caddyserver.com/docs/caddyfile/directives/basic_auth)
- [FastAPI HTTP Basic Auth](https://fastapi.tiangolo.com/advanced/security/http-basic-auth/)
- [FastAPI Docker deployment](https://fastapi.tiangolo.com/deployment/docker/)
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [react-konva npm](https://www.npmjs.com/package/react-konva) — v19.2.0 verified
- [konva npm](https://www.npmjs.com/package/konva) — v10.2.0 verified
- [Konva Transformer docs](https://konvajs.org/docs/react/Transformer.html)
- [react-hotkeys-hook npm](https://www.npmjs.com/package/react-hotkeys-hook) — v5.2.4 verified
- [Qdrant local mode](https://deepwiki.com/qdrant/qdrant-client/2.2-local-mode)
- [GCP Container-Optimized OS](https://cloud.google.com/container-optimized-os/docs)

### Feature Research (HIGH confidence)
- [FiftyOne Import Datasets (v1.12.0)](https://docs.voxel51.com/user_guide/import_datasets.html)
- [FiftyOne Export Datasets (v1.11.1)](https://docs.voxel51.com/user_guide/export_datasets.html)
- [FiftyOne Evaluation (v1.11.1)](https://docs.voxel51.com/user_guide/evaluation.html)
- [FiftyOne Brain](https://docs.voxel51.com/brain.html)
- [FiftyOne Annotation (v1.11.0)](https://docs.voxel51.com/user_guide/annotation.html)
- [Encord Annotate Overview](https://docs.encord.com/platform-documentation/Annotate/annotate-overview)
- [Encord Label Editor](https://docs.encord.com/platform-documentation/Annotate/annotate-label-editor)
- [Encord Active Quality Metrics](https://docs.encord.com/platform-documentation/Active/active-quality-metrics/active-model-quality-metrics)
- [Encord Editor Shortcuts](https://docs.encord.com/platform-documentation/Annotate/annotate-label-editor/annotate-label-editor-settings-shortcuts)

### Architecture Research (HIGH confidence)
- DataVisor codebase: app/main.py, dependencies.py, config.py, repositories/duckdb_repo.py, services/similarity_service.py — existing patterns verified
- DataVisor codebase: frontend/src/stores/*.ts, components/**/*.tsx — 3 Zustand stores, SVG annotation overlay confirmed
- [FastAPI Dependency Injection (PropelAuth)](https://www.propelauth.com/post/fastapi-auth-with-dependency-injection)
- [FastAPI Auth Discussion #8867](https://github.com/fastapi/fastapi/discussions/8867)
- [Konva Drag and Resize Limits](https://konvajs.org/docs/select_and_transform/Resize_Limits.html)
- [Qdrant Python Client](https://python-client.qdrant.tech/qdrant_client.qdrant_client)

### Pitfall Research (MEDIUM-HIGH confidence)
- [DuckDB Files Created](https://duckdb.org/docs/stable/operations_manual/footprint_of_duckdb/files_created_by_duckdb) — WAL behavior
- [DuckDB Concurrency](https://duckdb.org/docs/stable/connect/concurrency) — single-writer model
- [DuckDB WAL Issue #10002](https://github.com/duckdb/duckdb/issues/10002) — lock file not cleaned
- [Next.js Environment Variables](https://nextjs.org/docs/pages/guides/environment-variables) — NEXT_PUBLIC build-time
- [Next.js Docker Env Discussion #17641](https://github.com/vercel/next.js/discussions/17641)
- [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials) — header limitations
- [WHATWG EventSource Issue #2177](https://github.com/whatwg/html/issues/2177) — cannot set headers
- [Konva Coordinate Issue #830](https://github.com/konvajs/konva/issues/830) — dragging and zooming
- [Konva Transformer BBox Issue #1296](https://github.com/konvajs/konva/issues/1296) — incorrect bbox with scale
- [GCP Persistent Disks](https://cloud.google.com/compute/docs/disks/add-persistent-disk)
- [GCP Firewall Rules](https://cloud.google.com/compute/docs/networking/firewalls)

---

**Ready for Requirements Definition:** YES

SUMMARY.md synthesizes findings from 4 parallel research files. Orchestrator can proceed to requirements definition for v1.1 roadmap.
