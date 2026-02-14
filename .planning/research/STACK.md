# Stack Research: v1.1 Additions

**Project:** DataVisor v1.1 -- Deployment, Workflow & Competitive Parity
**Researched:** 2026-02-12
**Scope:** New stack additions ONLY. Existing stack (FastAPI, DuckDB, Qdrant, Next.js, Tailwind, deck.gl, Recharts, Pydantic AI, Moondream2) is validated and NOT re-researched.
**Overall confidence:** HIGH

---

## 1. Docker Compose Architecture

### Service Topology

Four services in a single `docker-compose.yml`:

| Service | Image | Purpose | Port | Volume Mounts |
|---------|-------|---------|------|---------------|
| `backend` | Custom (Dockerfile.backend) | FastAPI + DuckDB + Qdrant (local mode) + ML models | 8000 | `./data:/app/data`, `./plugins:/app/plugins` |
| `frontend` | Custom (Dockerfile.frontend) | Next.js standalone server | 3000 | none (static build) |
| `caddy` | `caddy:2-alpine` | Reverse proxy, HTTPS, basic auth | 80, 443 | `./Caddyfile:/etc/caddy/Caddyfile`, `caddy_data:/data` |

**Three services, not four.** Qdrant stays in local/embedded mode (current approach via `QdrantClient(path=...)`) rather than running as a separate Docker container. Rationale:

- The current codebase uses `qdrant-client` in local mode with on-disk persistence at `data/qdrant/`. This works without a Qdrant server process.
- For a single-user tool with <1M vectors, local mode is equivalent in performance to server mode.
- Eliminates a container, reduces memory footprint, and simplifies the compose file.
- If Qdrant server mode is ever needed (e.g., multiple workers), the code change is one line: `QdrantClient(path=...)` to `QdrantClient(url="http://qdrant:6333")`.

**Why not keep it to two services (combine backend + frontend)?** Separate containers for backend and frontend allow independent rebuilds. The FastAPI container has heavy Python/ML dependencies (~4GB with torch); the Next.js container is ~150MB standalone. Rebuilding frontend CSS does not trigger a 10-minute Python image rebuild.

### Docker Compose File

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data          # DuckDB + Qdrant + thumbnails persist here
      - ./plugins:/app/plugins    # Plugin directory
    environment:
      - DATAVISOR_DB_PATH=/app/data/datavisor.duckdb
      - DATAVISOR_QDRANT_PATH=/app/data/qdrant
      - DATAVISOR_THUMBNAIL_CACHE_DIR=/app/data/thumbnails
      - DATAVISOR_AUTH_USERNAME=${AUTH_USERNAME:-admin}
      - DATAVISOR_AUTH_PASSWORD=${AUTH_PASSWORD}
      - DATAVISOR_VLM_DEVICE=cpu  # Override for GPU: cuda
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.frontend
      args:
        - NEXT_PUBLIC_API_URL=http://backend:8000
    ports:
      - "3000:3000"
    environment:
      - HOSTNAME=0.0.0.0
    depends_on:
      - backend
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - frontend
      - backend
    restart: unless-stopped

volumes:
  caddy_data:
  caddy_config:
```

### Confidence: HIGH
Sources: [FastAPI Docker docs](https://fastapi.tiangolo.com/deployment/docker/), [Next.js output standalone docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Caddy Docker docs](https://hub.docker.com/_/caddy)

---

## 2. Backend Dockerfile

### Recommended: Multi-stage build with uv

```dockerfile
# Stage 1: Build dependencies
FROM python:3.14-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-editable

# Stage 2: Runtime
FROM python:3.14-slim AS runner

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app/ ./app/
COPY plugins/ ./plugins/

ENV PATH="/app/.venv/bin:$PATH"
ENV DATAVISOR_HOST=0.0.0.0
ENV DATAVISOR_PORT=8000

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Key decisions:**
- `python:3.14-slim` not `alpine` -- avoids musl compilation issues with numpy/torch/scipy wheels.
- `uv sync --frozen` for deterministic installs from lockfile.
- No `gunicorn` needed -- single-user tool, one uvicorn worker is sufficient. Gunicorn adds complexity with no benefit for single-user.
- Volume-mount `data/` at runtime, not baked into image. Data persists across container rebuilds.

### New Python dependency: None

No new Python packages needed for Docker. The existing `pyproject.toml` already has everything. Auth additions (see section 3) use FastAPI's built-in `fastapi.security` module -- zero new dependencies.

### Confidence: HIGH

---

## 3. Frontend Dockerfile

### Recommended: Next.js standalone multi-stage build

Requires adding `output: "standalone"` to `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
};
```

```dockerfile
# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# Stage 3: Runner (~150MB total)
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
```

**Key decision:** `NEXT_PUBLIC_API_URL` is baked at build time (Next.js inlines env vars prefixed with `NEXT_PUBLIC_` during `next build`). For Docker Compose, the build arg sets this to the internal service name. For external access, Caddy proxies both frontend and backend under the same domain, so the browser hits `/api/` which Caddy routes to the backend.

### Confidence: HIGH
Source: [Next.js standalone Docker docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)

---

## 4. Single-User Authentication

### Recommended: FastAPI HTTPBasic + Caddy basic_auth (defense in depth)

**Layer 1: Caddy reverse proxy (primary auth gate)**

Caddy handles basic auth at the edge. The browser prompts for credentials before any request reaches FastAPI or Next.js. This protects the entire application (frontend + backend + API docs) with zero code changes.

```
your-domain.com {
    basic_auth {
        admin $2a$14$HASHED_PASSWORD
    }

    handle /api/* {
        reverse_proxy backend:8000
    }

    handle {
        reverse_proxy frontend:3000
    }
}
```

Generate the password hash with: `caddy hash-password --plaintext 'your-password'`

**Layer 2: FastAPI HTTPBasic (API-level protection)**

For defense in depth and for direct API access (bypassing Caddy during development), add FastAPI's built-in HTTPBasic:

```python
import secrets
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from app.config import get_settings

security = HTTPBasic()

def verify_credentials(
    credentials: HTTPBasicCredentials = Depends(security),
) -> str:
    settings = get_settings()
    is_user = secrets.compare_digest(
        credentials.username.encode("utf8"),
        settings.auth_username.encode("utf8"),
    )
    is_pass = secrets.compare_digest(
        credentials.password.encode("utf8"),
        settings.auth_password.encode("utf8"),
    )
    if not (is_user and is_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username
```

Add to `Settings`:
```python
auth_username: str = "admin"
auth_password: str = ""  # Empty = auth disabled (local dev)
auth_enabled: bool = False  # Toggle via DATAVISOR_AUTH_ENABLED=true
```

**Why NOT JWT, OAuth2, or session-based auth:**
- This is a single-user personal tool deployed on a cloud VM.
- HTTP Basic Auth is built into FastAPI (zero dependencies), supported by every browser natively (credentials dialog), and sufficient for single-user protection.
- JWT adds token management complexity with no benefit for one user.
- OAuth2 requires an identity provider -- massive overkill.
- Session cookies require server-side session storage -- unnecessary complexity.

**Why Caddy over Nginx:**
- Caddy has automatic HTTPS (Let's Encrypt) with zero configuration. Nginx requires certbot setup, cron renewal, and manual config.
- Caddy is a single static binary. Config is ~10 lines vs Nginx's verbose syntax.
- `basic_auth` is a built-in Caddy directive. Nginx requires `htpasswd` file generation.
- For a single-user tool, Caddy's simplicity wins decisively.

### New dependencies: None (backend), caddy:2-alpine Docker image (infrastructure)
### Confidence: HIGH
Source: [FastAPI HTTP Basic Auth docs](https://fastapi.tiangolo.com/advanced/security/http-basic-auth/), [Caddy basic_auth directive](https://caddyserver.com/docs/caddyfile/directives/basic_auth)

---

## 5. GCP Compute Engine Deployment

### Recommended: Shell script with `gcloud` CLI (not Terraform)

**Why not Terraform:** This is a single VM for a personal tool. Terraform adds a dependency (Terraform binary + state management + HCL learning curve) for managing one resource. A shell script using `gcloud` CLI is simpler, auditable, and reproducible.

### Deployment script: `scripts/deploy-gcp.sh`

```bash
#!/usr/bin/env bash
# Creates a GCP Compute Engine VM with Docker + Docker Compose,
# then deploys DataVisor via docker compose.

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
ZONE="${GCP_ZONE:-us-central1-a}"
INSTANCE_NAME="${GCP_INSTANCE:-datavisor}"
MACHINE_TYPE="${GCP_MACHINE_TYPE:-e2-standard-4}"  # 4 vCPU, 16GB RAM

# Create VM with Container-Optimized OS
gcloud compute instances create "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family=cos-stable \
  --image-project=cos-cloud \
  --boot-disk-size=50GB \
  --tags=http-server,https-server \
  --metadata-from-file=startup-script=scripts/vm-startup.sh

# Open firewall for HTTP/HTTPS
gcloud compute firewall-rules create allow-http-https \
  --project="$PROJECT_ID" \
  --allow=tcp:80,tcp:443 \
  --target-tags=http-server,https-server \
  --description="Allow HTTP and HTTPS for DataVisor"
```

### VM startup script: `scripts/vm-startup.sh`

```bash
#!/usr/bin/env bash
# Runs on first boot of Container-Optimized OS VM.
# Installs Docker Compose and starts DataVisor.

# COS already has Docker; install docker-compose plugin
docker compose version || {
    mkdir -p ~/.docker/cli-plugins/
    curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
        -o ~/.docker/cli-plugins/docker-compose
    chmod +x ~/.docker/cli-plugins/docker-compose
}

# Clone repo and start
cd /opt
git clone https://github.com/YOUR_USER/data-visor.git
cd data-visor

# Create .env with auth credentials
cat > .env <<EOF
AUTH_USERNAME=admin
AUTH_PASSWORD=CHANGE_ME_ON_DEPLOY
EOF

docker compose up -d --build
```

**Machine type recommendation:**
- `e2-standard-4` (4 vCPU, 16GB RAM): Sufficient for DINOv2 embedding generation (CPU mode) and Moondream2 inference. ~$100/month.
- For GPU (faster VLM/embedding inference): `n1-standard-4` + NVIDIA T4 GPU. ~$250/month. Add `--accelerator=type=nvidia-tesla-t4,count=1` to gcloud create.
- For cost savings: Use preemptible/spot VMs (`--provisioning-model=SPOT`). DataVisor is stateful but can tolerate restarts.

**Alternative: Local development script** (`scripts/run-local.sh`):
```bash
#!/usr/bin/env bash
# Start DataVisor locally without Docker
cd "$(dirname "$0")/.."
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &
cd frontend && npm run dev &
wait
```

### New dependencies: None (uses gcloud CLI, assumed available)
### Confidence: HIGH
Source: [GCP Container-Optimized OS docs](https://cloud.google.com/container-optimized-os/docs), [GCP Compute Engine docs](https://cloud.google.com/compute/docs)

---

## 6. Annotation Editing (Canvas Library)

### Recommended: react-konva 19.2.0 + konva 10.2.0

| Library | Version | Purpose |
|---------|---------|---------|
| `konva` | 10.2.0 | HTML5 Canvas 2D framework with built-in Transformer (resize/rotate handles) |
| `react-konva` | 19.2.0 | React 19 bindings for Konva (required: react-konva@19 for react@19) |

**Why react-konva over Fabric.js:**

The existing v1.0 annotation overlay uses SVG (`<svg>` with `<rect>` elements) in read-only mode with `pointer-events-none`. For editing (move/resize/delete), we need interactive canvas elements. The decision is between:

1. **react-konva** (recommended): First-class React integration via declarative JSX (`<Rect>`, `<Transformer>`, `<Stage>`). Works within React's component model. The `Transformer` component provides resize handles out of the box. react-konva@19.2.0 is explicitly built for React 19 -- the exact version this project uses.

2. **Fabric.js**: More built-in features (SVG export, rich text on canvas, image filters). But no official React wrapper -- requires imperative DOM manipulation via `useRef` + `useEffect`, fighting React's declarative model. The React ecosystem for Fabric.js is fragmented (multiple unofficial wrappers, none well-maintained).

3. **Keep SVG + make interactive**: SVG `<rect>` elements can be made draggable/resizable with mouse event handlers. However, SVG drag-and-resize requires manual coordinate math, hit-testing, and handle rendering. Canvas libraries solve this problem completely.

**react-konva wins because:**
- Declarative React API (`<Rect x={...} draggable onDragEnd={...} />`)
- Built-in `Transformer` component for resize handles (no manual implementation)
- react-konva@19 is verified compatible with React 19.2.3 and Konva 10.2.0
- Already in the v1.0 STACK.md as the recommended canvas library (was not used in v1.0 because annotations were read-only, but the recommendation stands)
- Used by multiple annotation tools in production (Konva docs have specific bounding box annotation examples)

**Architecture for annotation editing:**

The sample modal currently renders a full-resolution `<img>` with an SVG overlay. For editing mode:

```
Read-only mode (default):
  <img> + <AnnotationOverlay> (existing SVG, unchanged)

Edit mode (toggle):
  <Stage> (Konva canvas, same dimensions as image)
    <Layer>  (background image)
      <Image> (Konva Image, not HTML img)
    </Layer>
    <Layer>  (annotations -- interactive)
      <Rect draggable /> (for each bbox)
      <Transformer />   (resize handles on selected rect)
    </Layer>
  </Stage>
```

This means the existing SVG overlay is PRESERVED for the read-only grid view (lightweight, no canvas overhead for 50+ thumbnails). The Konva canvas is only mounted in the sample modal when edit mode is toggled.

**SSR compatibility:** react-konva requires browser DOM. Use Next.js dynamic import:
```typescript
const AnnotationEditor = dynamic(
  () => import("@/components/detail/annotation-editor"),
  { ssr: false }
);
```

### Installation

```bash
cd frontend
npm install konva@^10.2.0 react-konva@^19.2.0
```

### What NOT to use

| Avoid | Why |
|-------|-----|
| Fabric.js | No official React wrapper. Imperative API fights React's model. |
| paper.js | Scriptographer port -- legacy design, small community, no React bindings. |
| pixi.js | WebGL-focused game renderer. Overkill for 2D bounding boxes. |
| SVG-only editing | Manual coordinate math for drag/resize/handles. Reinventing what Konva provides. |
| react-konva@18 | Incompatible with React 19. Must use react-konva@19.x. |

### Confidence: HIGH
Sources: [react-konva npm](https://www.npmjs.com/package/react-konva) (v19.2.0 verified), [konva npm](https://www.npmjs.com/package/konva) (v10.2.0 verified), [Konva Transformer docs](https://konvajs.org/docs/react/Transformer.html), [Konva bounding box annotation example](https://blog.intzone.com/using-konva-js-to-annotate-image-with-bounding-boxes/)

---

## 7. Keyboard Shortcuts

### Recommended: react-hotkeys-hook 5.2.4

| Library | Version | Purpose |
|---------|---------|---------|
| `react-hotkeys-hook` | 5.2.4 | Declarative keyboard shortcut hook for React |

**Why react-hotkeys-hook:**

- **Declarative hook API:** `useHotkeys('ctrl+s', () => save())` -- no setup, no providers, no configuration objects. Fits naturally into React functional components.
- **Scoped shortcuts:** Can scope hotkeys to specific elements via ref. This is critical for annotation editing (arrow keys move selected bbox) vs grid view (arrow keys navigate grid).
- **Active maintenance:** v5.2.4 published 9 days ago (as of research date). 692 dependent packages on npm.
- **React 19 compatible:** Hook-based, no class components, no deprecated lifecycle methods.
- **Modifier support:** `ctrl+z`, `shift+click`, `meta+s` (Mac Cmd), sequential keys (`g then i` for vim-style).
- **Tiny:** ~3KB gzipped. No dependencies.

**Alternatives considered:**

| Library | Why Not |
|---------|---------|
| `cmdk` (v1.1.1) | Command palette component, not a shortcut framework. Complementary -- could use cmdk for Cmd+K command palette AND react-hotkeys-hook for shortcuts. But cmdk is NOT needed for v1.1 scope (just navigation shortcuts, not a command palette). |
| `react-hotkeys` (v2.0.0) | Last published 6 years ago. Unmaintained. Uses deprecated class-component HOC pattern. |
| `@react-hook/hotkey` | Minimal, but lacks scoping and modifier key combinations. |
| Custom `useEffect` + `addEventListener` | Works for trivial cases, but becomes unmaintainable with 15+ shortcuts. No conflict resolution, no scoping, no disable/enable. |
| `tinykeys` | Minimal (<1KB), no React-specific features. Would need custom wrapper for scoping and component lifecycle. |

**Planned shortcut map (for roadmap context):**

| Shortcut | Action | Scope |
|----------|--------|-------|
| `j` / `k` | Next / previous sample in modal | Modal |
| `Escape` | Close modal / deselect annotation | Global |
| `Delete` / `Backspace` | Delete selected annotation | Edit mode |
| `Ctrl+Z` / `Cmd+Z` | Undo annotation edit | Edit mode |
| `e` | Toggle edit mode in modal | Modal |
| `1-5` | Quick-tag error category (FP/FN/LE etc.) | Triage mode |
| `Space` | Toggle annotation visibility | Grid/Modal |
| `g` | Toggle grid/embedding view | Global |
| `f` | Focus filter search | Global |
| `?` | Show keyboard shortcuts help | Global |

### Installation

```bash
cd frontend
npm install react-hotkeys-hook@^5.2.4
```

### Confidence: HIGH
Sources: [react-hotkeys-hook npm](https://www.npmjs.com/package/react-hotkeys-hook) (v5.2.4 verified), [react-hotkeys-hook docs](https://react-hotkeys-hook.vercel.app/)

---

## 8. Dataset Ingestion UI

### Recommended: No new libraries needed

The smart ingestion UI (point at folder, auto-detect structure, import) is a frontend UX feature with backend logic. No new dependencies:

**Backend (Python):**
- `pathlib` (stdlib) + `fsspec`/`gcsfs` (already installed) for directory traversal and structure detection.
- The existing `app/ingestion/` module already handles COCO JSON parsing via `ijson`. Extend it with a structure detection service.
- DuckDB (already installed) for storing split metadata.

**Frontend (TypeScript):**
- Stepper/wizard UI for the import flow: built with existing Tailwind CSS components. No component library needed.
- File tree visualization: flat list with indentation (CSS-only), or simple recursive component. No tree library needed for the scope (showing detected splits, not a full file explorer).

**What the ingestion detector does (backend service):**
1. Accept a root path (local or GCS).
2. Walk directory structure looking for patterns:
   - `train/`, `val/`, `test/` subdirectories -> split detection
   - `images/` + `annotations/` or `labels/` -> format detection
   - `*.json` files -> check for COCO format keys (`images`, `annotations`, `categories`)
   - `*.txt` files alongside images -> YOLO format detection
3. Return a detection result: `{ format: "coco", splits: ["train", "val"], annotation_file: "path/to/instances.json", image_dirs: [...] }`
4. User confirms/adjusts in UI, then triggers import with the validated config.

### What NOT to add

| Avoid | Why |
|-------|-----|
| `react-dropzone` | DataVisor reads from server-side paths (local disk or GCS), not browser file uploads. The user provides a path, not drag-and-drop files. |
| `react-arborist` or `react-complex-tree` | Over-engineered for showing a simple detected folder structure. A flat list with indentation suffices. |
| Any upload library | Images stay on disk/GCS. DataVisor reads them in-place. No upload flow needed. |

### Confidence: HIGH (no new dependencies, pure application logic)

---

## 9. Error Triage Workflow

### Recommended: No new libraries needed

The error triage workflow (tag errors, highlight/dim, rank worst images) builds on existing infrastructure:

**Backend:**
- DuckDB already stores error categories (`error_type` column in annotations/analysis tables).
- Extend with a `triage_status` column (enum: `unreviewed`, `confirmed`, `dismissed`, `needs_review`).
- "Worst images" ranking: composite score from existing DuckDB data (error count + confidence spread + embedding outlier distance). Pure SQL aggregation query.

**Frontend:**
- Tag buttons (FP/FN/Label Error/Confirmed): Tailwind-styled buttons + existing `apiPatch` calls.
- Highlight/dim: CSS opacity on grid cells based on triage status. Already have the pattern from source discriminator (GT vs predictions solid/dashed lines).
- Keyboard shortcuts for quick-tagging: covered by react-hotkeys-hook (section 7).
- Progress indicator (e.g., "47/312 errors triaged"): simple counter from DuckDB aggregation.

### What NOT to add

| Avoid | Why |
|-------|-----|
| `@dnd-kit` (drag-and-drop) | Not needed. Triage is tag-based, not drag-and-drop-based. |
| Any kanban/board library | Triage is not a kanban workflow. It is sequential review with keyboard shortcuts. |
| Separate triage database | DuckDB already handles this. Adding a column to existing tables is sufficient. |

### Confidence: HIGH (no new dependencies, extends existing patterns)

---

## 10. Caddy Reverse Proxy

### Recommended: caddy:2-alpine Docker image

| Technology | Version | Purpose |
|------------|---------|---------|
| Caddy | 2.x (latest `caddy:2-alpine`) | Reverse proxy, automatic HTTPS, basic auth |

**Why Caddy over Nginx/Traefik:**

| Criterion | Caddy | Nginx | Traefik |
|-----------|-------|-------|---------|
| Automatic HTTPS | Built-in, zero-config Let's Encrypt | Requires certbot + cron | Built-in but more complex config |
| Config simplicity | 10-line Caddyfile | 30+ line nginx.conf | YAML/TOML, label-based discovery |
| Basic auth | Built-in directive | Requires htpasswd file | Middleware config |
| Docker image size | ~40MB (alpine) | ~25MB (alpine) | ~100MB |
| Learning curve | Minimal | Moderate | Moderate |

For a single-VM, single-user tool, Caddy's automatic HTTPS alone is decisive. No certbot setup, no renewal cron, no debugging expired certificates.

**Caddyfile:**

```
{$DOMAIN:localhost} {
    basic_auth {
        {$AUTH_USERNAME:admin} {$AUTH_PASSWORD_HASH}
    }

    handle /api/* {
        uri strip_prefix /api
        reverse_proxy backend:8000
    }

    handle {
        reverse_proxy frontend:3000
    }
}
```

**For local development (no Caddy):** Access backend at `localhost:8000` and frontend at `localhost:3000` directly. Caddy is only needed in the Docker Compose deployment on the VM.

**HTTPS for local dev:** Not needed. Caddy only runs in the cloud deployment. For local development, HTTP is fine.

### Configuration: Caddyfile at project root
### Confidence: HIGH
Sources: [Caddy Docker image](https://hub.docker.com/_/caddy), [Caddy reverse proxy quickstart](https://caddyserver.com/docs/quick-starts/reverse-proxy), [Caddy basic_auth directive](https://caddyserver.com/docs/caddyfile/directives/basic_auth)

---

## Complete New Dependencies Summary

### Frontend (npm)

```bash
cd frontend
npm install konva@^10.2.0 react-konva@^19.2.0 react-hotkeys-hook@^5.2.4
```

| Package | Version | Size (gzipped) | Purpose |
|---------|---------|----------------|---------|
| `konva` | 10.2.0 | ~65KB | Canvas 2D framework |
| `react-konva` | 19.2.0 | ~8KB | React 19 bindings for Konva |
| `react-hotkeys-hook` | 5.2.4 | ~3KB | Keyboard shortcuts |

**Total new frontend footprint:** ~76KB gzipped. Minimal impact.

### Backend (Python)

```
No new Python dependencies.
```

Auth uses FastAPI's built-in `fastapi.security.HTTPBasic`. Docker uses the existing `uvicorn`. Ingestion detection uses `pathlib` + existing `fsspec`. Triage uses existing DuckDB columns.

### Infrastructure (Docker images)

| Image | Size | Purpose |
|-------|------|---------|
| `caddy:2-alpine` | ~40MB | Reverse proxy + HTTPS + auth |
| `python:3.14-slim` | ~150MB | Backend base image |
| `node:22-alpine` | ~180MB | Frontend build base |

---

## What NOT to Add (and Why)

| Technology | Why Skip |
|------------|----------|
| **Qdrant Docker container** | Already using local mode (`QdrantClient(path=...)`). Works in-process. No server needed for single-user. |
| **Gunicorn** | Single-user tool. One uvicorn worker is sufficient. Gunicorn adds process management complexity for zero benefit. |
| **Nginx** | Caddy is simpler for this use case (auto HTTPS, built-in basic auth). |
| **Terraform** | One VM. Shell script with `gcloud` CLI is simpler and more auditable. |
| **JWT/OAuth2/Auth0** | Single-user tool. HTTP Basic Auth is sufficient. JWT adds token lifecycle management for one user. |
| **Fabric.js** | No official React wrapper. Imperative API fights React's declarative model. |
| **cmdk** | Command palette is a nice-to-have, not needed for v1.1 keyboard shortcuts. Could add in v1.2. |
| **react-dropzone** | DataVisor reads server-side paths, not browser uploads. |
| **Kubernetes/Cloud Run** | One VM running Docker Compose. K8s is massive overkill. Cloud Run does not support persistent volumes for DuckDB/Qdrant. |
| **PostgreSQL** | DuckDB is sufficient. PostgreSQL adds a container, connection management, and migrations for no analytical query benefit. |
| **Redis** | No caching layer needed. DuckDB queries are fast enough for single-user. No session store needed (HTTP Basic Auth is stateless). |
| **shadcn/ui** | Was recommended in v1.0 STACK.md but was not used -- v1.0 shipped with hand-written Tailwind components. The existing component patterns are consistent and sufficient. Adding shadcn/ui now would create style inconsistency between old and new components. |

---

## Integration Points with Existing Stack

### Backend auth integration

Add auth dependency to FastAPI routers. The existing router pattern (`app.include_router(...)`) supports `dependencies` parameter for blanket protection:

```python
# In main.py -- protect all API routes
if get_settings().auth_enabled:
    from app.auth import verify_credentials
    for router in [datasets.router, samples.router, ...]:
        router.dependencies.append(Depends(verify_credentials))
```

Or use FastAPI middleware for simpler blanket auth (preferred for single-user):

```python
# Middleware approach -- every request except /health
@app.middleware("http")
async def auth_middleware(request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if not settings.auth_enabled:
        return await call_next(request)
    # Validate Basic auth header...
```

### Frontend API calls with auth

The existing `apiFetch` function in `lib/api.ts` needs auth header injection when deployed with auth. Two approaches:

**Option A (recommended): Caddy handles auth, frontend unchanged.**
Caddy validates Basic Auth at the edge. If credentials are valid, requests pass through to backend. The frontend never sees or sends auth headers -- Caddy strips them. This means ZERO frontend changes for auth.

**Option B (direct backend auth): Add credentials to fetch.**
If accessing the backend directly (without Caddy), add `Authorization` header:
```typescript
const headers: HeadersInit = { "Content-Type": "application/json" };
if (process.env.NEXT_PUBLIC_AUTH_ENABLED === "true") {
    headers["Authorization"] = `Basic ${btoa(`${username}:${password}`)}`;
}
```

**Recommendation: Option A.** Caddy-level auth means the frontend code stays unchanged. The browser's native Basic Auth dialog handles credential entry. No login page, no token storage, no auth state management.

### Konva integration with existing modal

The existing `SampleModal` renders `<AnnotationOverlay>` (SVG) over an `<img>`. The edit mode wraps the same image + annotations in a Konva `<Stage>`:

```
SampleModal
  |-- read-only mode: <img> + <AnnotationOverlay> (existing, unchanged)
  |-- edit mode: <AnnotationEditor> (new, lazy-loaded Konva component)
        |-- <Stage>
              |-- <Layer> <Image /> </Layer>  (background)
              |-- <Layer> <Rect draggable /> ... <Transformer /> </Layer>  (editable annotations)
```

The annotation data model stays the same (`bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`). Konva `Rect` coordinates map directly. On save, updated coordinates are sent to the backend via existing `apiPatch` pattern.

### Keyboard shortcuts integration with Zustand stores

react-hotkeys-hook calls Zustand store actions directly:

```typescript
useHotkeys("j", () => useUIStore.getState().selectNextSample());
useHotkeys("escape", () => useUIStore.getState().closeDetailModal());
useHotkeys("e", () => useUIStore.getState().toggleEditMode());
```

No new store needed. Extend existing `useUIStore` with edit mode state and triage shortcuts.

---

## Version Compatibility Matrix

| Package A | Package B | Compatibility | Notes |
|-----------|-----------|---------------|-------|
| react-konva@19.2.0 | react@19.2.3 | Verified | react-konva@19 requires React 19 |
| react-konva@19.2.0 | konva@10.2.0 | Verified | Works out of the box since konva@10 |
| react-hotkeys-hook@5.2.4 | react@19.2.3 | Verified | Hook-based, React 19 compatible |
| konva@10.2.0 | Next.js 16.1.6 | Verified | Must use `dynamic()` with `{ ssr: false }` |
| caddy:2-alpine | Docker Compose v2 | Verified | Standard Docker image |
| python:3.14-slim | uv (latest) | Verified | uv supports Python 3.14 |
| node:22-alpine | Next.js 16.1.6 | Verified | Next.js 16 supports Node 22 |

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DuckDB single-writer lock inside Docker | Low | Medium | Already handled -- single-user tool, one uvicorn worker. No concurrent writes. |
| Konva Transformer quirks with scaled coordinates | Medium | Low | Konva `Transformer` works in local coordinate space. Use `scaleX/scaleY` or resize via `boundBoxFunc`. Konva docs have specific examples. |
| torch Docker image size (~4GB) | High | Low | Accept the size. Use multi-stage build to exclude dev deps. Pin torch version in lockfile to avoid pulling larger versions. Consider `torch-cpu` package if no GPU needed. |
| `NEXT_PUBLIC_API_URL` baked at build time | Medium | Medium | For Docker Compose, set via build arg. For changing API URLs without rebuild, use Next.js middleware or runtime config (but adds complexity). Keep it simple: rebuild frontend container when API URL changes. |
| Caddy Let's Encrypt rate limits | Low | Medium | Only an issue if deploying/redeploying many times to different domains. For a single stable domain, no problem. Use staging CA for testing. |

---

## Sources

### Verified (HIGH confidence)
- [FastAPI HTTP Basic Auth docs](https://fastapi.tiangolo.com/advanced/security/http-basic-auth/) -- auth pattern
- [Next.js standalone output docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) -- Docker build
- [react-konva npm](https://www.npmjs.com/package/react-konva) -- v19.2.0, React 19 compatibility
- [konva npm](https://www.npmjs.com/package/konva) -- v10.2.0
- [react-hotkeys-hook npm](https://www.npmjs.com/package/react-hotkeys-hook) -- v5.2.4
- [Konva Transformer docs](https://konvajs.org/docs/react/Transformer.html) -- resize/rotate handles
- [Caddy Docker image](https://hub.docker.com/_/caddy) -- caddy:2-alpine
- [Caddy reverse proxy docs](https://caddyserver.com/docs/quick-starts/reverse-proxy)
- [Caddy basic_auth docs](https://caddyserver.com/docs/caddyfile/directives/basic_auth)
- [FastAPI Docker deployment](https://fastapi.tiangolo.com/deployment/docker/)
- [Qdrant local mode](https://deepwiki.com/qdrant/qdrant-client/2.2-local-mode) -- path-based client
- [GCP Container-Optimized OS](https://cloud.google.com/container-optimized-os/docs)

### Cross-referenced (MEDIUM confidence)
- [Konva bounding box annotation tutorial](https://blog.intzone.com/using-konva-js-to-annotate-image-with-bounding-boxes/)
- [DevMuscle Konva annotation tool](https://devmuscle.com/blog/react-konva-image-annotation)
- [Caddy Docker HTTPS guide (Feb 2026)](https://oneuptime.com/blog/post/2026-02-08-how-to-run-caddy-with-docker-and-automatic-https-wildcard-certificates/view)

---
*Stack research for: DataVisor v1.1 -- Deployment, Workflow & Competitive Parity*
*Researched: 2026-02-12*
