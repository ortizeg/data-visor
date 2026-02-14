# Architecture Research: v1.1 Feature Integration

**Domain:** CV Dataset Introspection Tooling -- Feature Integration into Existing Architecture
**Researched:** 2026-02-12
**Confidence:** HIGH (grounded in codebase analysis of 12,720 LOC across 50+ source files)

---

## Existing Architecture Snapshot

Before defining integration points, here is the current v1.0 architecture as built (not as planned -- verified against actual source files):

```
CURRENT ARCHITECTURE (v1.0 -- 12,720 LOC)
==========================================

Frontend (Next.js 16 + React 19)                    Backend (FastAPI + Python 3.14)
--------------------------------------               ------------------------------------
app/page.tsx          -- Dataset list                app/main.py          -- Lifespan, CORS, router mounts
app/datasets/[id]/    -- Dataset view                app/config.py        -- Pydantic Settings (env prefix DATAVISOR_)
                                                     app/dependencies.py  -- DI: get_db, get_cursor, get_*_service
3 Zustand stores:
  filter-store.ts     -- Filters, selection          9 Routers:
  ui-store.ts         -- Modal, tabs, sources          datasets.py, samples.py, images.py, views.py,
  embedding-store.ts  -- Lasso selection               statistics.py, embeddings.py, similarity.py,
                                                       agent.py, vlm.py
14 Hooks (TanStack Query):
  use-samples.ts      -- Infinite scroll             7 Services:
  use-annotations.ts  -- Batch + per-sample            ingestion.py, embedding_service.py, reduction_service.py,
  use-error-analysis.ts                                similarity_service.py, vlm_service.py,
  use-evaluation.ts                                    error_analysis.py, evaluation.py, agent_service.py
  use-embedding-progress.ts                            filter_builder.py, image_service.py
  use-vlm-progress.ts
  ... (8 more)                                       Data Layer:
                                                       DuckDB (data/datavisor.duckdb) -- 6 tables
lib/api.ts           -- apiFetch, apiPost, etc.        Qdrant (data/qdrant/) -- local mode, disk-persisted
lib/constants.ts     -- API_BASE, PAGE_SIZE            StorageBackend (fsspec: local + GCS)
lib/color-hash.ts    -- Deterministic class colors

Component Tree:                                      DuckDB Tables:
  grid/image-grid.tsx    (TanStack Virtual)            datasets, samples, annotations, categories,
  grid/grid-cell.tsx                                   saved_views, embeddings
  grid/annotation-overlay.tsx (SVG-based)
  detail/sample-modal.tsx (HTML dialog)
  detail/annotation-list.tsx
  detail/similarity-panel.tsx
  embedding/embedding-scatter.tsx (deck.gl)
  embedding/lasso-overlay.tsx
  filters/filter-sidebar.tsx
  stats/stats-dashboard.tsx (6 sub-panels)
  toolbar/auto-tag-button.tsx
```

### Key Architectural Properties

1. **DuckDB is single-connection, cursor-per-request** (`app/dependencies.py:24-32`)
2. **Qdrant runs in LOCAL mode** (no Docker service -- `QdrantClient(path=...)` in `similarity_service.py:27`)
3. **SSE pattern established** -- 4 existing SSE streams (ingestion, embeddings, reduction, VLM)
4. **Services are injected via `app.state`** at lifespan startup, retrieved via `get_*` dependencies
5. **Annotation overlay uses SVG** (NOT react-konva) -- `annotation-overlay.tsx` renders `<svg>` with `<rect>` elements
6. **Frontend talks to `http://localhost:8000`** by default (`NEXT_PUBLIC_API_URL` env var)
7. **No auth exists** -- CORS allows all origins (`allow_origins=["*"]`)
8. **No Docker files exist** -- project runs via `uvicorn` and `next dev` directly

---

## Feature 1: Docker Deployment

### Compose Topology

```
docker-compose.yml
==================

                    +-----------------+
                    |     nginx       |  :80 / :443
                    |  (reverse proxy)|
                    +--------+--------+
                             |
              +--------------+--------------+
              |                             |
    +---------v--------+          +---------v--------+
    |     backend      |          |     frontend     |
    |  FastAPI + DuckDB|          |   Next.js 16     |
    |  (uvicorn :8000) |          |  (standalone)    |
    |                  |          |  (:3000)          |
    +--------+---------+          +------------------+
             |
    +--------v---------+
    |      qdrant       |
    |  (qdrant/qdrant)  |
    |  :6333 (REST)     |
    |  :6334 (gRPC)     |
    +-------------------+

Volumes:
  - data_volume:/app/data        (DuckDB + thumbnails, mounted into backend)
  - qdrant_storage:/qdrant/storage (Qdrant persistent data)
  - images:/data/images           (bind mount for local image datasets)
```

### Integration Points

**Files to create:**
| File | Purpose |
|------|---------|
| `Dockerfile.backend` | Multi-stage: Python 3.14, install deps, copy app/, expose 8000 |
| `Dockerfile.frontend` | Multi-stage: Node 22, build standalone, expose 3000 |
| `docker-compose.yml` | 4 services: backend, frontend, qdrant, nginx |
| `nginx/default.conf` | Reverse proxy: `/api/*` -> backend:8000, `/*` -> frontend:3000 |
| `.env.docker` | Docker-specific env vars |

**Files to modify:**
| File | Change | Rationale |
|------|--------|-----------|
| `app/config.py` | Add `qdrant_url` setting (default `None` = local mode, set to `http://qdrant:6333` in Docker) | Switch between local Qdrant (dev) and Docker Qdrant (prod) |
| `app/services/similarity_service.py` | Conditional: `QdrantClient(path=...)` vs `QdrantClient(url=...)` based on `qdrant_url` setting | Current code hardcodes local mode |
| `frontend/next.config.ts` | Add `output: "standalone"` for Docker-optimized builds | Reduces image size from ~1GB to ~100MB |
| `frontend/src/lib/constants.ts` | Already uses `NEXT_PUBLIC_API_URL` env var -- no change needed | Works as-is with Docker |

### Qdrant Mode Switch Design

The critical architecture decision is Qdrant's mode. Currently `SimilarityService.__init__` creates a local-mode client:

```python
# CURRENT (app/services/similarity_service.py:27)
self.client = QdrantClient(path=str(path))

# PROPOSED -- conditional based on settings
settings = get_settings()
if settings.qdrant_url:
    # Docker mode: connect to Qdrant service
    self.client = QdrantClient(url=settings.qdrant_url)
else:
    # Dev mode: local embedded storage
    path = Path(qdrant_path)
    path.mkdir(parents=True, exist_ok=True)
    self.client = QdrantClient(path=str(path))
```

### DuckDB in Docker

DuckDB is embedded (in-process) -- it runs INSIDE the backend container. The `.duckdb` file must persist across container restarts via a Docker volume:

```yaml
# docker-compose.yml (backend service)
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    volumes:
      - data_volume:/app/data          # DuckDB + thumbnails persist here
      - /path/to/images:/data/images:ro # Bind-mount image datasets (read-only)
    environment:
      - DATAVISOR_DB_PATH=/app/data/datavisor.duckdb
      - DATAVISOR_THUMBNAIL_CACHE_DIR=/app/data/thumbnails
      - DATAVISOR_QDRANT_URL=http://qdrant:6333
    ports:
      - "8000:8000"
```

**Single worker constraint remains:** DuckDB requires `--workers 1` in Docker too. The `CMD` should be `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1`.

### Backend Dockerfile Pattern

```dockerfile
# Multi-stage build for Python 3.14 + uv
FROM python:3.14-slim AS builder
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev

FROM python:3.14-slim AS runtime
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app/ ./app/
COPY plugins/ ./plugins/
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

**GPU consideration:** The base image does NOT include CUDA. For VLM/embedding features in Docker, users either (a) use CPU-only inference (slow but works), or (b) use `nvidia/cuda` base image with GPU passthrough. Recommend CPU-only as default Docker profile, GPU as optional override.

### Frontend Dockerfile Pattern

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
ENV NEXT_PUBLIC_API_URL=/api
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### Nginx Reverse Proxy

```nginx
# nginx/default.conf
upstream backend {
    server backend:8000;
}
upstream frontend {
    server frontend:3000;
}

server {
    listen 80;

    # API routes -> FastAPI backend
    location /api/ {
        proxy_pass http://backend/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;           # Required for SSE streams
        proxy_read_timeout 300s;       # Long-running SSE connections
    }

    # Everything else -> Next.js frontend
    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
    }
}
```

### Build Order Implication

Docker deployment is **independent of all other v1.1 features** and should be built first. It creates the deployment scaffold that other features (auth, ingestion UI) build upon.

---

## Feature 2: Single-User Auth Middleware

### Architecture Decision: Dependency Injection (not middleware)

**Recommendation: Use FastAPI's `Depends()` pattern, NOT ASGI middleware.**

Rationale from research and codebase analysis:
1. The codebase already uses `Depends()` extensively (9 dependency functions in `dependencies.py`). Adding auth as another dependency is consistent.
2. Middleware approach would wrap ALL routes including `/health` and SSE streams, requiring complex exclusion logic.
3. The FastAPI community consensus (GitHub Discussion #8867, #3277) strongly favors DI for auth because it is testable, composable, and explicit per-route.
4. Single-user auth is simple: one username/password from environment variables, verified via HTTP Basic Auth.

### Integration Point

**File to create:**
| File | Purpose |
|------|---------|
| `app/auth.py` | `verify_credentials()` dependency using `fastapi.security.HTTPBasic` |

**Files to modify:**
| File | Change |
|------|--------|
| `app/config.py` | Add `auth_username: str = "admin"` and `auth_password: str` settings |
| `app/main.py` | Add auth dependency to ALL router includes (single line each) |
| `app/routers/*.py` | No changes -- auth applied at router level via `dependencies=[Depends(verify_auth)]` |

### Implementation Pattern

```python
# app/auth.py
import secrets
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from app.config import get_settings

security = HTTPBasic()

def verify_auth(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    """Verify single-user basic auth credentials.

    Returns the username on success. Raises 401 on failure.
    Uses secrets.compare_digest to prevent timing attacks.
    """
    settings = get_settings()
    correct_username = secrets.compare_digest(
        credentials.username.encode("utf-8"),
        settings.auth_username.encode("utf-8"),
    )
    correct_password = secrets.compare_digest(
        credentials.password.encode("utf-8"),
        settings.auth_password.encode("utf-8"),
    )
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username
```

### Router-Level Application

Apply auth at the router include level in `main.py` so every endpoint on every router requires auth, without modifying individual router files:

```python
# app/main.py -- modified includes
from app.auth import verify_auth

app.include_router(datasets.router, dependencies=[Depends(verify_auth)])
app.include_router(samples.router, dependencies=[Depends(verify_auth)])
# ... repeat for all routers

# /health remains unprotected (no dependency)
@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
```

### Frontend Auth Integration

The frontend `api.ts` functions (`apiFetch`, `apiPost`, `apiPatch`, `apiDelete`) all call `fetch()` directly. For Basic Auth, add the `Authorization` header:

```typescript
// frontend/src/lib/api.ts -- modified
function authHeaders(): HeadersInit {
  // Credentials stored in environment variables at build time
  // or passed via cookie/session after initial login
  const creds = btoa(`${process.env.NEXT_PUBLIC_AUTH_USER}:${process.env.NEXT_PUBLIC_AUTH_PASS}`);
  return { Authorization: `Basic ${creds}` };
}
```

**Alternative (better UX):** Add a login page that stores credentials in `sessionStorage`, then include them in all API calls. This avoids browser Basic Auth popup.

### SSE Stream Auth

The existing SSE pattern uses `new EventSource(url)` which does NOT support custom headers. Two options:

1. **Cookie-based session** (recommended): After initial Basic Auth, set an HTTP-only session cookie. EventSource sends cookies automatically.
2. **Query parameter token**: Pass auth token as `?token=xxx` in SSE URLs. Less secure but simpler.

**Recommendation:** Use cookie-based sessions via `fastapi-sessions` or a simple signed cookie. This is the only viable approach because the existing `useEmbeddingProgress` and `useVlmProgress` hooks use `EventSource` which cannot set `Authorization` headers.

### Build Order Implication

Auth must come AFTER Docker (needs HTTPS for secure credential transmission) but BEFORE smart ingestion UI (new endpoints need auth).

---

## Feature 3: Smart Ingestion UI

### Current Ingestion Flow

The current ingestion is API-only (`POST /datasets/ingest` with `annotation_path` and `image_dir` as strings). There is no UI -- users must know exact file paths.

### Smart Ingestion Architecture

The smart ingestion feature adds three new components:

```
User points at folder
        |
        v
POST /datasets/scan { root_path }           <-- NEW endpoint
        |
        v
FolderScanner service                        <-- NEW service
  - Walk directory tree
  - Detect COCO annotation files (*.json with "images" key)
  - Detect image directories (dirs with .jpg/.png files)
  - Detect train/val/test splits by directory naming
  - Return structured scan result
        |
        v
Response: ScanResult {
  annotation_files: [{ path, format, est_images }],
  image_dirs: [{ path, image_count, split_guess }],
  suggested_imports: [{ annotation, image_dir, split, name }]
}
        |
        v
Frontend: Ingestion wizard UI               <-- NEW page/component
  - Shows detected files and directories
  - User confirms/adjusts import configuration
  - Clicks "Import" -> triggers SSE ingestion stream
        |
        v
POST /datasets/ingest (existing endpoint)    <-- REUSE with minor extension
  - SSE progress stream (existing pattern)
  - New: accept optional split parameter
```

### Backend Integration Points

**Files to create:**
| File | Purpose |
|------|---------|
| `app/services/folder_scanner.py` | `FolderScanner` class: walk dir tree, detect formats, suggest imports |
| `app/models/scan.py` | Pydantic models: `ScanRequest`, `ScanResult`, `DetectedFile`, `SuggestedImport` |
| `app/routers/ingestion.py` | New router: `POST /ingestion/scan`, mounted under auth |

**Files to modify:**
| File | Change |
|------|--------|
| `app/main.py` | Add `app.include_router(ingestion.router)` |
| `app/dependencies.py` | Add `get_folder_scanner()` dependency |
| `app/models/dataset.py` | Add optional `split` field to `IngestRequest` |
| `app/services/ingestion.py` | Pass `split` to image batch builder (set `split` column during parsing) |
| `app/ingestion/coco_parser.py` | Accept optional `split` parameter in `build_image_batches()` |

**Frontend files to create:**
| File | Purpose |
|------|---------|
| `frontend/src/app/ingest/page.tsx` | Ingestion wizard page |
| `frontend/src/components/ingest/scan-results.tsx` | Display detected files with checkboxes |
| `frontend/src/components/ingest/import-progress.tsx` | SSE progress display (reuses existing pattern) |
| `frontend/src/hooks/use-scan.ts` | TanStack Query mutation for scan endpoint |
| `frontend/src/hooks/use-ingest.ts` | SSE hook for ingestion progress (similar to `use-embedding-progress.ts`) |
| `frontend/src/types/scan.ts` | TypeScript types matching backend Pydantic models |

### Folder Scanner Design

```python
# app/services/folder_scanner.py

class FolderScanner:
    """Walk a directory tree and detect importable CV datasets.

    Detection heuristics:
    1. JSON files containing "images" key at top level -> COCO annotation file
    2. Directories containing 10+ image files (.jpg/.jpeg/.png) -> image directory
    3. Directory names matching train/val/test/validation -> split assignment
    4. Paired annotation + image directory at same level -> suggested import
    """

    def scan(self, root_path: str) -> ScanResult:
        ...
```

### SSE Pattern Reuse

The existing SSE pattern in `datasets.py:37-73` (wrapping `IngestionService.ingest_with_progress()` as a `StreamingResponse`) is directly reusable. The new ingestion UI will call the same `POST /datasets/ingest` endpoint and consume the same SSE event format.

### Build Order Implication

Smart ingestion depends on Docker (for deployment context) and auth (new endpoints need auth). Can be built independently of annotation editing and error triage.

---

## Feature 4: Annotation Editing (Browser-Based BBox Editing)

### Critical Observation: Current Overlay is SVG, NOT react-konva

The milestone context mentions react-konva, but **react-konva is NOT in the project**. The current annotation rendering in `annotation-overlay.tsx` is pure SVG:

```tsx
// CURRENT: frontend/src/components/grid/annotation-overlay.tsx
<svg viewBox={`0 0 ${imageWidth} ${imageHeight}`} ...>
  {annotations.map((ann) => (
    <rect x={ann.bbox_x} y={ann.bbox_y} width={ann.bbox_w} height={ann.bbox_h} ... />
  ))}
</svg>
```

### Architecture Decision: Use Konva ONLY in Detail Modal, Keep SVG for Grid

**Recommendation: Do NOT replace the grid overlay with react-konva.** Introduce react-konva ONLY in the sample detail modal for editing.

Rationale:
1. The SVG grid overlay works well for read-only display at scale (dozens of cells visible simultaneously). Replacing SVG with canvas per grid cell would multiply canvas contexts and hurt performance.
2. Editing happens in the detail modal (`sample-modal.tsx`), where only ONE image is displayed at a time. This is the right place for an interactive canvas.
3. Konva's `Transformer` component provides native drag/resize handles for bounding boxes.
4. The grid overlay continues rendering the latest annotation data from the server (refetched after edits).

### Component Architecture for Annotation Editing

```
sample-modal.tsx (MODIFIED)
  |
  +-- [Read-only mode] AnnotationOverlay (SVG, existing)
  |
  +-- [Edit mode] AnnotationEditor (NEW, react-konva)
        |
        +-- <Stage> with <Layer>
        |     |
        |     +-- <Image> (full-res image as Konva.Image)
        |     +-- <Rect> per annotation (draggable)
        |     +-- <Transformer> (attached to selected rect)
        |
        +-- EditToolbar (NEW)
        |     |
        |     +-- Select / Move / Delete buttons
        |     +-- Save / Cancel buttons
        |
        +-- Zustand: useAnnotationEditStore (NEW store)
              |
              +-- editingAnnotations: Annotation[] (local copy during edit)
              +-- selectedAnnotationId: string | null
              +-- isDirty: boolean
              +-- saveEdits() -> PATCH /annotations/batch
              +-- discardEdits()
```

### Integration Points

**New npm dependency:**
```
npm install react-konva konva
```

**Files to create:**
| File | Purpose |
|------|---------|
| `frontend/src/components/detail/annotation-editor.tsx` | react-konva Stage with draggable/resizable Rects |
| `frontend/src/components/detail/edit-toolbar.tsx` | Edit mode controls (select, delete, save, cancel) |
| `frontend/src/stores/annotation-edit-store.ts` | Zustand store for edit-mode state (NEW 4th store) |
| `frontend/src/types/annotation-edit.ts` | Types for annotation edit operations |

**Backend files to create:**
| File | Purpose |
|------|---------|
| `app/routers/annotations.py` | New router: `PATCH /annotations/batch`, `DELETE /annotations/{id}` |
| `app/models/annotation.py` (modify) | Add `AnnotationUpdateRequest` model |

**Files to modify:**
| File | Change |
|------|--------|
| `frontend/src/components/detail/sample-modal.tsx` | Add toggle between read (SVG) and edit (Konva) modes |
| `frontend/package.json` | Add `react-konva` and `konva` dependencies |
| `app/main.py` | Add `app.include_router(annotations.router)` |

### Backend API for Annotation Updates

```python
# app/routers/annotations.py (NEW)

@router.patch("/annotations/batch")
def update_annotations_batch(
    request: AnnotationBatchUpdateRequest,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Update bbox coordinates for multiple annotations.

    Used by the frontend annotation editor to save moved/resized boxes.
    Only ground_truth annotations are editable (predictions are immutable).
    """
    cursor = db.connection.cursor()
    try:
        for update in request.updates:
            cursor.execute(
                "UPDATE annotations SET bbox_x = ?, bbox_y = ?, bbox_w = ?, bbox_h = ?, "
                "area = ? * ? WHERE id = ? AND source = 'ground_truth'",
                [update.bbox_x, update.bbox_y, update.bbox_w, update.bbox_h,
                 update.bbox_w, update.bbox_h, update.id],
            )
    finally:
        cursor.close()
    return {"updated": len(request.updates)}


@router.delete("/annotations/{annotation_id}")
def delete_annotation(
    annotation_id: str,
    db: DuckDBRepo = Depends(get_db),
) -> None:
    """Delete a single annotation. Only ground_truth annotations are deletable."""
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            "DELETE FROM annotations WHERE id = ? AND source = 'ground_truth'",
            [annotation_id],
        )
    finally:
        cursor.close()
```

### Konva Transformer Integration

The key technical pattern from Konva docs: the Transformer changes `scaleX`/`scaleY`, not `width`/`height`. On `onTransformEnd`, compute the new bbox from the node's position and scale:

```typescript
// Pattern for annotation-editor.tsx
const handleTransformEnd = (e: KonvaEventObject<Event>) => {
  const node = e.target;
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  // Reset scale, apply to dimensions
  node.scaleX(1);
  node.scaleY(1);

  const updated: AnnotationUpdate = {
    id: node.id(),
    bbox_x: node.x(),
    bbox_y: node.y(),
    bbox_w: Math.max(5, node.width() * scaleX),
    bbox_h: Math.max(5, node.height() * scaleY),
  };

  editStore.updateAnnotation(updated);
};
```

### Data Flow for Annotation Edits

```
User clicks "Edit" in sample modal
  -> AnnotationEditStore.startEditing(annotations)  // copy current annotations
  -> Modal switches from SVG AnnotationOverlay to Konva AnnotationEditor
  -> User drags/resizes boxes (Konva handles visual updates in real-time)
  -> User clicks "Save"
  -> AnnotationEditStore.saveEdits()
    -> PATCH /annotations/batch { updates: [...] }
    -> On success: invalidate TanStack Query cache for this sample's annotations
    -> Modal switches back to SVG AnnotationOverlay
    -> Grid refetches batch annotations (sees updated boxes)
```

### Build Order Implication

Annotation editing depends on the sample modal existing (already built). It is independent of Docker, auth, and smart ingestion. Can be built in parallel with error triage.

---

## Feature 5: Error Triage Workflow

### Current Error Analysis State

The error analysis system already exists (`error_analysis.py` service, `error-analysis-panel.tsx` component). It categorizes detections into TP, Hard FP, Label Error, and FN. However, it is **read-only** -- there is no way to:
- Tag individual errors (confirm/dismiss/flag for review)
- Highlight errors while dimming non-errors in the grid
- Rank "worst" images by error severity

### Triage Workflow Architecture

```
Error Triage Flow
=================

error-analysis-panel.tsx (EXISTING -- add triage actions)
  |
  +-- ErrorSamplesGrid (EXISTING -- add "Tag as reviewed" button)
  |
  +-- TriageActionBar (NEW component)
  |     |
  |     +-- "Mark as FP" / "Mark as TP" / "Mark as Mistake" buttons
  |     +-- "Highlight errors only" toggle
  |     +-- "Rank worst images" button
  |
  +-- useTriageStore (NEW Zustand store -- 4th store)
        |
        +-- triageLabels: Map<string, TriageLabel>    // annotation_id -> label
        +-- highlightMode: "all" | "errors_only"
        +-- worstImagesRanking: ScoredSample[]
        +-- setTriageLabel(annotationId, label)
        +-- toggleHighlightMode()
```

### New DuckDB Table: `triage_labels`

The triage labels need to persist. Add a new table:

```sql
CREATE TABLE IF NOT EXISTS triage_labels (
    annotation_id   VARCHAR NOT NULL,
    dataset_id      VARCHAR NOT NULL,
    label           VARCHAR NOT NULL,     -- 'confirmed', 'dismissed', 'needs_review', 'mistake'
    created_at      TIMESTAMP DEFAULT current_timestamp
)
```

### Backend Integration Points

**Files to create:**
| File | Purpose |
|------|---------|
| `app/routers/triage.py` | New router: `POST /triage/label`, `GET /triage/labels`, `GET /triage/worst-images` |
| `app/models/triage.py` | Pydantic models: `TriageLabelRequest`, `TriageLabelResponse`, `ScoredSample` |
| `app/services/triage_service.py` | Triage label CRUD + "worst images" ranking algorithm |

**Files to modify:**
| File | Change |
|------|--------|
| `app/repositories/duckdb_repo.py` | Add `triage_labels` table creation in `initialize_schema()` |
| `app/main.py` | Add `app.include_router(triage.router)` |
| `app/dependencies.py` | Add `get_triage_service()` dependency |

### "Worst Images" Ranking Algorithm

The ranking combines multiple error signals into a single score:

```python
# app/services/triage_service.py

def rank_worst_images(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str,
    limit: int = 50,
) -> list[ScoredSample]:
    """Rank images by combined error severity score.

    Score = (2 * hard_fp_count) + (3 * label_error_count) + (1 * fn_count)
            + (0.5 * low_confidence_count) - (0.1 * tp_count)

    Higher score = worse image (more problems).
    """
    # Use existing error_analysis.categorize_errors() to get per-sample breakdown
    # Then aggregate and sort
    ...
```

### Frontend Integration Points

**Files to create:**
| File | Purpose |
|------|---------|
| `frontend/src/stores/triage-store.ts` | Zustand store for triage state (5th store) |
| `frontend/src/components/stats/triage-action-bar.tsx` | Triage controls and actions |
| `frontend/src/components/stats/worst-images-panel.tsx` | Ranked worst images display |
| `frontend/src/hooks/use-triage.ts` | TanStack Query hooks for triage API |
| `frontend/src/types/triage.ts` | TypeScript types |

**Files to modify:**
| File | Change |
|------|--------|
| `frontend/src/components/stats/error-analysis-panel.tsx` | Add triage action buttons to error samples |
| `frontend/src/components/stats/error-samples-grid.tsx` | Add per-sample triage label badges |
| `frontend/src/components/grid/grid-cell.tsx` | Support highlight/dim mode from triage store |
| `frontend/src/stores/ui-store.ts` | Add `highlightMode: "all" \| "errors_only"` state |

### Highlight/Dim Mode in Grid

When triage highlight mode is active, grid cells for non-error images get reduced opacity:

```tsx
// grid-cell.tsx modification
const triageHighlight = useTriageStore((s) => s.highlightMode);
const isError = useTriageStore((s) => s.errorSampleIds.has(sample.id));

const opacity = triageHighlight === "errors_only" && !isError ? 0.2 : 1.0;

return (
  <div style={{ opacity }} className="...">
    ...
  </div>
);
```

### Build Order Implication

Error triage depends on the existing error analysis system (already built). It extends the stats dashboard. Independent of Docker, auth, smart ingestion, and annotation editing.

---

## Feature 6: Keyboard Shortcuts

### Architecture Decision: react-hotkeys-hook

**Recommendation: Use `react-hotkeys-hook` (v5.x) library** rather than building custom keyboard handling.

Rationale:
1. Actively maintained (last published 9 days ago as of research date)
2. Lightweight (~4KB)
3. Supports scoped shortcuts (component-level) and global shortcuts
4. Works with React 19 and Next.js 16
5. Handles modifier keys, key combinations, and key sequences
6. Prevents shortcuts from firing when user is typing in inputs

### Integration Point: Global vs Component-Level Shortcuts

```
Shortcut Architecture
=====================

Global shortcuts (active everywhere):
  ?           -> Show shortcut help modal
  Escape      -> Close any open modal / exit edit mode / clear selection
  /           -> Focus search input
  g           -> Switch to Grid tab
  s           -> Switch to Statistics tab
  e           -> Switch to Embeddings tab

Component-level shortcuts (active when component is focused):

  Grid View:
    j/k       -> Navigate samples (down/up)
    Enter     -> Open detail modal for focused sample
    x         -> Toggle selection mode
    Shift+A   -> Select all visible

  Detail Modal:
    Left/Right arrow -> Previous/next sample
    d          -> Delete annotation (in edit mode)
    Ctrl+S     -> Save annotation edits
    Escape     -> Close modal / cancel edit

  Error Triage:
    1          -> Mark as confirmed TP
    2          -> Mark as needs review
    3          -> Mark as mistake
    h          -> Toggle highlight mode
```

### Integration Points

**New npm dependency:**
```
npm install react-hotkeys-hook
```

**Files to create:**
| File | Purpose |
|------|---------|
| `frontend/src/hooks/use-keyboard-shortcuts.ts` | Central shortcut registration hook |
| `frontend/src/components/shortcuts/shortcut-help-modal.tsx` | Help modal showing all available shortcuts |
| `frontend/src/lib/shortcuts.ts` | Shortcut definitions map (key -> action -> description) |

**Files to modify:**
| File | Change |
|------|--------|
| `frontend/src/app/datasets/[datasetId]/page.tsx` | Register global shortcuts (tab switching, search focus) |
| `frontend/src/components/grid/image-grid.tsx` | Register grid navigation shortcuts (j/k, Enter, x) |
| `frontend/src/components/detail/sample-modal.tsx` | Register modal shortcuts (arrows, Escape, d, Ctrl+S) |
| `frontend/src/components/stats/error-analysis-panel.tsx` | Register triage shortcuts (1/2/3, h) |
| `frontend/src/stores/ui-store.ts` | Add `shortcutHelpOpen: boolean` state |
| `frontend/package.json` | Add `react-hotkeys-hook` dependency |

### Implementation Pattern

```typescript
// frontend/src/hooks/use-keyboard-shortcuts.ts
import { useHotkeys } from 'react-hotkeys-hook';
import { useUIStore } from '@/stores/ui-store';

export function useGlobalShortcuts() {
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const openShortcutHelp = useUIStore((s) => s.setShortcutHelpOpen);

  // ? -> show help
  useHotkeys('shift+/', () => openShortcutHelp(true), { preventDefault: true });

  // g/s/e -> tab switching
  useHotkeys('g', () => setActiveTab('grid'), { preventDefault: true });
  useHotkeys('s', () => setActiveTab('statistics'), { preventDefault: true });
  useHotkeys('e', () => setActiveTab('embeddings'), { preventDefault: true });

  // / -> focus search
  useHotkeys('/', () => {
    document.querySelector<HTMLInputElement>('[data-shortcut-target="search"]')?.focus();
  }, { preventDefault: true });
}
```

### Build Order Implication

Keyboard shortcuts are the most independent feature. They layer on top of existing components without changing data flow or APIs. Can be built last or in parallel with any other feature.

---

## New Components Summary

### Backend (New Files)

| File | Feature | Type |
|------|---------|------|
| `Dockerfile.backend` | Docker | Build |
| `Dockerfile.frontend` | Docker | Build |
| `docker-compose.yml` | Docker | Config |
| `nginx/default.conf` | Docker | Config |
| `.env.docker` | Docker | Config |
| `app/auth.py` | Auth | Module |
| `app/services/folder_scanner.py` | Smart Ingestion | Service |
| `app/models/scan.py` | Smart Ingestion | Model |
| `app/routers/ingestion.py` | Smart Ingestion | Router |
| `app/routers/annotations.py` | Annotation Editing | Router |
| `app/routers/triage.py` | Error Triage | Router |
| `app/models/triage.py` | Error Triage | Model |
| `app/services/triage_service.py` | Error Triage | Service |

### Frontend (New Files)

| File | Feature | Type |
|------|---------|------|
| `src/app/ingest/page.tsx` | Smart Ingestion | Page |
| `src/components/ingest/scan-results.tsx` | Smart Ingestion | Component |
| `src/components/ingest/import-progress.tsx` | Smart Ingestion | Component |
| `src/components/detail/annotation-editor.tsx` | Annotation Editing | Component |
| `src/components/detail/edit-toolbar.tsx` | Annotation Editing | Component |
| `src/stores/annotation-edit-store.ts` | Annotation Editing | Store |
| `src/components/stats/triage-action-bar.tsx` | Error Triage | Component |
| `src/components/stats/worst-images-panel.tsx` | Error Triage | Component |
| `src/stores/triage-store.ts` | Error Triage | Store |
| `src/hooks/use-scan.ts` | Smart Ingestion | Hook |
| `src/hooks/use-ingest.ts` | Smart Ingestion | Hook |
| `src/hooks/use-triage.ts` | Error Triage | Hook |
| `src/components/shortcuts/shortcut-help-modal.tsx` | Shortcuts | Component |
| `src/hooks/use-keyboard-shortcuts.ts` | Shortcuts | Hook |
| `src/lib/shortcuts.ts` | Shortcuts | Lib |

### Modified Files

| File | Features Affecting It |
|------|----------------------|
| `app/config.py` | Docker (qdrant_url), Auth (credentials) |
| `app/main.py` | Auth (router dependencies), New routers (ingestion, annotations, triage) |
| `app/dependencies.py` | Smart Ingestion (folder_scanner), Error Triage (triage_service) |
| `app/repositories/duckdb_repo.py` | Error Triage (triage_labels table) |
| `app/services/similarity_service.py` | Docker (conditional Qdrant client mode) |
| `app/services/ingestion.py` | Smart Ingestion (split parameter) |
| `app/ingestion/coco_parser.py` | Smart Ingestion (split parameter) |
| `app/models/dataset.py` | Smart Ingestion (split field on IngestRequest) |
| `app/models/annotation.py` | Annotation Editing (update models) |
| `frontend/next.config.ts` | Docker (standalone output) |
| `frontend/package.json` | Annotation Editing (react-konva), Shortcuts (react-hotkeys-hook) |
| `frontend/src/lib/api.ts` | Auth (credentials header) |
| `frontend/src/stores/ui-store.ts` | Shortcuts (help modal), Triage (highlight mode) |
| `frontend/src/components/detail/sample-modal.tsx` | Annotation Editing (edit mode toggle), Shortcuts |
| `frontend/src/components/stats/error-analysis-panel.tsx` | Error Triage (action buttons) |
| `frontend/src/components/stats/error-samples-grid.tsx` | Error Triage (label badges) |
| `frontend/src/components/grid/grid-cell.tsx` | Error Triage (highlight/dim mode) |
| `frontend/src/app/datasets/[datasetId]/page.tsx` | Shortcuts (global registration) |
| `frontend/src/components/grid/image-grid.tsx` | Shortcuts (grid navigation) |

---

## Data Flow Changes

### New DuckDB Tables

| Table | Feature | Schema |
|-------|---------|--------|
| `triage_labels` | Error Triage | `annotation_id VARCHAR, dataset_id VARCHAR, label VARCHAR, created_at TIMESTAMP` |

### New API Endpoints

| Method | Path | Feature | SSE? |
|--------|------|---------|------|
| `POST` | `/ingestion/scan` | Smart Ingestion | No |
| `PATCH` | `/annotations/batch` | Annotation Editing | No |
| `DELETE` | `/annotations/{id}` | Annotation Editing | No |
| `POST` | `/triage/label` | Error Triage | No |
| `GET` | `/triage/labels?dataset_id=X` | Error Triage | No |
| `GET` | `/triage/worst-images?dataset_id=X` | Error Triage | No |

### New Zustand Stores

| Store | Feature | Slices |
|-------|---------|--------|
| `annotation-edit-store.ts` | Annotation Editing | editingAnnotations, selectedId, isDirty, save/discard actions |
| `triage-store.ts` | Error Triage | triageLabels map, highlightMode, worstImagesRanking |

Total stores: 3 existing + 2 new = **5 Zustand stores**

---

## Suggested Build Order

Based on dependency analysis:

```
Phase 1: Docker Deployment
  - Dockerfile.backend + Dockerfile.frontend
  - docker-compose.yml (backend, frontend, qdrant, nginx)
  - Qdrant client mode switch (local vs server)
  - Next.js standalone output
  - Nginx reverse proxy with SSE support
  DEPENDS ON: nothing
  ENABLES: cloud deployment, auth

Phase 2: Single-User Auth
  - app/auth.py (HTTPBasic + verify_credentials)
  - Router-level dependency injection
  - Frontend credential handling
  - SSE auth via cookies
  DEPENDS ON: Docker (for HTTPS context)
  ENABLES: secure cloud access

Phase 3: Smart Ingestion UI
  - FolderScanner service
  - /ingestion/scan endpoint
  - Ingestion wizard page + components
  - Split detection in existing parser
  DEPENDS ON: Auth (new endpoints need it)
  ENABLES: no-code dataset import

Phase 4: Error Triage Workflow
  - triage_labels table
  - Triage API endpoints
  - Triage Zustand store
  - Worst images ranking
  - Grid highlight/dim mode
  DEPENDS ON: existing error analysis (already built)
  CAN PARALLEL WITH: Phase 3

Phase 5: Annotation Editing
  - react-konva integration in detail modal
  - AnnotationEditor component with Transformer
  - AnnotationEditStore (new Zustand store)
  - PATCH /annotations/batch endpoint
  DEPENDS ON: nothing new (builds on existing modal)
  CAN PARALLEL WITH: Phases 3, 4

Phase 6: Keyboard Shortcuts
  - react-hotkeys-hook integration
  - Global and component-level shortcuts
  - Shortcut help modal
  DEPENDS ON: all other UI features complete (shortcuts reference them)
  BUILD LAST: shortcuts layer on top of everything
```

### Dependency Graph

```
Phase 1 (Docker)
    |
    v
Phase 2 (Auth)
    |
    v
Phase 3 (Smart Ingestion)

Phase 4 (Error Triage)     -- parallel, independent
Phase 5 (Annotation Edit)  -- parallel, independent
Phase 6 (Shortcuts)         -- last, references all UI
```

---

## Sources

### HIGH Confidence (Official Documentation + Codebase Analysis)
- DataVisor codebase: `app/main.py`, `app/dependencies.py`, `app/config.py`, `app/repositories/duckdb_repo.py`, `app/services/similarity_service.py`, `app/services/ingestion.py`, `app/services/error_analysis.py` -- verified existing architecture
- DataVisor codebase: `frontend/src/stores/*.ts`, `frontend/src/lib/api.ts`, `frontend/src/components/**/*.tsx` -- verified frontend architecture
- [FastAPI Dependency Injection vs Middleware (GitHub Discussion #8867)](https://github.com/fastapi/fastapi/discussions/8867) -- DI recommended for auth
- [FastAPI Auth with Dependency Injection (PropelAuth)](https://www.propelauth.com/post/fastapi-auth-with-dependency-injection) -- DI pattern reference
- [Konva Transformer for React](https://konvajs.org/docs/react/Transformer.html) -- select/resize/rotate shapes
- [Konva Drag and Resize Limits](https://konvajs.org/docs/select_and_transform/Resize_Limits.html) -- boundBoxFunc for clamping
- [Qdrant Installation Docker](https://qdrant.tech/documentation/guides/installation/) -- Docker service configuration
- [Qdrant Python Client](https://python-client.qdrant.tech/qdrant_client.qdrant_client) -- local mode vs server mode
- [react-hotkeys-hook (npm)](https://www.npmjs.com/package/react-hotkeys-hook) -- v5.2.4, actively maintained
- [DuckDB Docker Container](https://duckdb.org/docs/stable/operations_manual/duckdb_docker) -- volume mount patterns
- [Next.js Standalone Output](https://nextjs.org/docs/pages/api-reference/config/next-config-js/output) -- Docker-optimized builds

### MEDIUM Confidence (WebSearch + Cross-Verification)
- [FastAPI + Next.js Docker examples (GitHub)](https://github.com/YsrajSingh/nextjs-fastapi-docker) -- compose topology reference
- [Qdrant Docker Compose configuration (DeepWiki)](https://deepwiki.com/qdrant/qdrant_demo/2.1-quick-start-with-docker-compose) -- service definition
- [Building canvas-based editors with Konva](https://www.alikaraki.me/blog/canvas-editors-konva) -- production patterns for drag/resize
- [Next.js Dockerization 2025 guide](https://medium.com/front-end-world/dockerizing-a-next-js-application-in-2025-bacdca4810fe) -- multi-stage build best practices

---
*Architecture research for: DataVisor v1.1 Feature Integration*
*Researched: 2026-02-12*
*Grounded in: 12,720 LOC codebase analysis + official documentation*
