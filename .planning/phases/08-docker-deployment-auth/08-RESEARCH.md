# Phase 8: Docker Deployment & Auth - Research

**Researched:** 2026-02-12
**Domain:** Docker Compose orchestration, Caddy reverse proxy, HTTP Basic Auth, GCP Compute Engine deployment
**Confidence:** HIGH

## Summary

Phase 8 transforms DataVisor from a local-development-only tool into a deployable Docker stack with single-user authentication. The phase involves creating a 3-service Docker Compose stack (backend, frontend, Caddy), adding HTTP Basic Auth at the Caddy reverse proxy layer, writing a GCP VM deployment script, a local run script, and deployment documentation.

The standard approach is well-established: multi-stage Docker builds for both Python (backend) and Node.js (frontend), Caddy as the reverse proxy handling both HTTPS and basic auth at the edge, and a `gcloud` CLI shell script for GCP provisioning. The critical architectural decision -- using Caddy for auth at the proxy layer rather than implementing auth in FastAPI -- means zero application code changes for authentication. The browser's native Basic Auth dialog handles credential entry, SSE streams work without modification (Caddy authenticates the initial connection), and the frontend code requires no auth headers.

The existing codebase has several properties that directly affect Docker deployment: (1) Qdrant runs in local embedded mode which works inside the backend container without a separate service, (2) `NEXT_PUBLIC_API_URL` is baked at build time by Next.js, requiring a reverse proxy to unify frontend and backend under one origin, (3) the CORS config (`allow_origins=["*"]` + `allow_credentials=True`) is spec-invalid and must be fixed, and (4) four SSE endpoints must proxy correctly through Caddy.

**Primary recommendation:** Use Caddy as the single entry point handling auth + HTTPS + reverse proxy. Route `/api/*` to the backend and everything else to the frontend. Keep Qdrant in local embedded mode inside the backend container. Use Ubuntu 24.04 (not Container-Optimized OS) for the GCP VM to avoid Docker Compose installation friction.

---

## Standard Stack

The established tools for this domain:

### Core

| Component | Version/Image | Purpose | Why Standard |
|-----------|---------------|---------|--------------|
| Docker Compose | v2 (bundled with Docker Desktop / `docker-compose-plugin`) | Multi-service orchestration | Standard for single-host multi-container apps |
| Caddy | `caddy:2-alpine` (~40MB) | Reverse proxy, auto-HTTPS, basic auth | Automatic Let's Encrypt, built-in `basic_auth`, 10-line config vs 30+ for nginx |
| Python base | `python:3.14-slim` | Backend Docker base image | Slim variant avoids musl compilation issues with numpy/torch; Python 3.14 matches `requires-python` |
| Node base | `node:22-alpine` | Frontend Docker build & runtime base | Alpine for small image; Node 22 LTS supports Next.js 16 |
| uv | `ghcr.io/astral-sh/uv:latest` (COPY binary) | Python dependency installation in Docker | 10-50x faster than pip; deterministic `uv sync --frozen` from lockfile |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `gcloud` CLI | GCP VM provisioning | Deployment script -- creates VM, firewall rules, SSH |
| `caddy hash-password` | Generate bcrypt password hashes for Caddyfile | One-time setup when configuring auth credentials |
| `.env` file | Docker Compose environment variables | Store `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `DOMAIN` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Caddy | nginx | nginx requires manual certbot/cron for HTTPS, htpasswd file for auth, verbose config. Caddy wins for single-user simplicity. |
| Caddy basic_auth | FastAPI HTTPBasic | Would require auth code in FastAPI, frontend auth header injection, and SSE auth workaround (EventSource cannot set headers). Caddy-level auth avoids all of this. |
| `gcloud` CLI script | Terraform | Terraform adds binary dependency + state management + HCL for managing one VM. Shell script is simpler and auditable. |
| Container-Optimized OS | Ubuntu 24.04 LTS | COS does NOT include Docker Compose by default; requires workaround scripts. Ubuntu + `apt install docker-compose-plugin` is straightforward. |
| Qdrant Docker container | Qdrant local/embedded mode | Local mode works in-process, eliminates a container, reduces memory. For single-user with <1M vectors, no benefit to server mode. One-line change if ever needed. |

### No New Application Dependencies

Zero new Python packages and zero new npm packages are needed for this phase. Auth uses Caddy's built-in `basic_auth` directive. Docker uses existing `uvicorn` and `next start`. The only new artifact is the `caddy:2-alpine` Docker image.

---

## Architecture Patterns

### Recommended Project Structure (New Files)

```
data-visor/
+-- Dockerfile.backend         # Multi-stage Python build
+-- Dockerfile.frontend        # Multi-stage Next.js standalone build
+-- docker-compose.yml         # 3 services: backend, frontend, caddy
+-- Caddyfile                  # Reverse proxy + basic auth config
+-- .dockerignore              # Exclude data/, .git/, node_modules/, .venv/
+-- .env.example               # Template for required env vars
+-- scripts/
|   +-- deploy-gcp.sh          # GCP VM provisioning script
|   +-- run-local.sh           # Local Docker Compose launcher
+-- docs/
    +-- deployment.md          # Deployment documentation
```

### Pattern 1: Single-Origin Reverse Proxy (Caddy)

**What:** Caddy serves as the single entry point on ports 80/443. It routes `/api/*` to the FastAPI backend (port 8000) and everything else to the Next.js frontend (port 3000). Auth is enforced at this layer.

**When to use:** Always in Docker deployment. This eliminates CORS entirely (same origin), makes auth transparent to the application, and solves the `NEXT_PUBLIC_API_URL` build-time problem.

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

Source: [Caddy basic_auth docs](https://caddyserver.com/docs/caddyfile/directives/basic_auth), [Caddy reverse_proxy docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

**Key details:**
- `{$DOMAIN:localhost}` uses Caddy's env variable syntax with fallback. When `DOMAIN=yourdomain.com` is set, Caddy auto-provisions HTTPS via Let's Encrypt. When unset, defaults to `localhost` (HTTP only, for local dev).
- `uri strip_prefix /api` removes `/api` before forwarding, so the backend sees `/datasets` not `/api/datasets`.
- `{$AUTH_PASSWORD_HASH}` must be a bcrypt hash, generated via `caddy hash-password --plaintext 'your-password'`. Format: `$2a$14$...`.
- In `docker-compose.yml`, literal `$` signs in bcrypt hashes must be doubled (`$$`) to avoid Docker Compose interpolation. Using `.env` file avoids this issue.
- SSE streams (`text/event-stream`) are flushed immediately by Caddy by default -- no `flush_interval` configuration needed. Caddy detects the content type and disables buffering automatically.

### Pattern 2: Multi-Stage Docker Build (Backend)

**What:** Two-stage build: install dependencies with `uv` in a builder stage, copy only the virtualenv to a slim runtime stage.

**Why:** Separates build tools from runtime, reducing image size. The `uv` binary and build caches stay in the discarded builder stage.

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

Source: [FastAPI Docker deployment docs](https://fastapi.tiangolo.com/deployment/docker/), [uv Docker docs](https://docs.astral.sh/uv/guides/integration/docker/)

**Key details:**
- `python:3.14-slim` NOT `alpine` -- avoids musl compilation issues with numpy/torch/scipy wheels.
- `uv sync --frozen` installs from lockfile deterministically. `--no-dev` excludes test deps. `--no-editable` avoids symlinks.
- No `gunicorn` -- single-user tool, one uvicorn worker is sufficient.
- Data volume (`data/`) is mounted at runtime, never baked into the image.
- No explicit `--workers` flag needed -- uvicorn defaults to 1 worker which is correct for DuckDB's single-writer constraint.

### Pattern 3: Next.js Standalone Build (Frontend)

**What:** Three-stage build: install deps, build with standalone output, copy minimal files to runner.

**Why:** Next.js `output: "standalone"` produces a self-contained `server.js` with only necessary dependencies, reducing image from ~1GB to ~150MB.

**Requires** adding to `frontend/next.config.ts`:
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

ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# Stage 3: Runner (~150MB)
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

Source: [Next.js standalone output docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)

**Critical detail:** `NEXT_PUBLIC_API_URL=/api` is set at build time. Since Caddy proxies `/api/*` to the backend, the frontend calls `/api/datasets` which Caddy routes to `backend:8000/datasets`. This means:
- The frontend code changes from `http://localhost:8000/datasets` to `/api/datasets`
- The `API_BASE` constant in `lib/constants.ts` uses `/api` in Docker
- No CORS needed (same origin)
- SSE `EventSource` URLs also use `/api/...` paths (same origin, no auth header issue)

### Pattern 4: Docker Compose Service Topology

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    volumes:
      - ./data:/app/data          # DuckDB + Qdrant + thumbnails
    environment:
      - DATAVISOR_DB_PATH=/app/data/datavisor.duckdb
      - DATAVISOR_QDRANT_PATH=/app/data/qdrant
      - DATAVISOR_THUMBNAIL_CACHE_DIR=/app/data/thumbnails
      - DATAVISOR_VLM_DEVICE=cpu
    restart: unless-stopped
    stop_grace_period: 30s

  frontend:
    build:
      context: ./frontend
      dockerfile: ../Dockerfile.frontend
      args:
        - NEXT_PUBLIC_API_URL=/api
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
    environment:
      - DOMAIN=${DOMAIN:-localhost}
      - AUTH_USERNAME=${AUTH_USERNAME:-admin}
      - AUTH_PASSWORD_HASH=${AUTH_PASSWORD_HASH}
    depends_on:
      - frontend
      - backend
    restart: unless-stopped

volumes:
  caddy_data:
  caddy_config:
```

**Key details:**
- 3 services, NOT 4. Qdrant stays in local embedded mode inside the backend container.
- Only Caddy exposes ports (80, 443). Backend and frontend are internal only.
- `stop_grace_period: 30s` on backend gives the FastAPI lifespan handler time to close DuckDB cleanly (default is 10s which may not be enough during large ingestion).
- `./data:/app/data` bind mount persists DuckDB, Qdrant, and thumbnails across container restarts.
- `caddy_data` named volume stores Let's Encrypt certificates.

### Pattern 5: GCP Deployment with Ubuntu

**What:** Shell script using `gcloud` CLI to create an Ubuntu 24.04 VM, install Docker, clone repo, and start DataVisor.

**Why Ubuntu over Container-Optimized OS:** COS does not include Docker Compose by default. Installing it on COS requires workaround scripts (running Docker Compose as a container or manual binary download). Ubuntu with `apt install docker-compose-plugin` is straightforward.

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
ZONE="${GCP_ZONE:-us-central1-a}"
INSTANCE_NAME="${GCP_INSTANCE:-datavisor}"
MACHINE_TYPE="${GCP_MACHINE_TYPE:-e2-standard-4}"
DISK_SIZE="${GCP_DISK_SIZE:-50}"

# Create VM with Ubuntu 24.04 and persistent disk
gcloud compute instances create "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size="${DISK_SIZE}GB" \
  --boot-disk-type=pd-balanced \
  --tags=http-server,https-server \
  --metadata-from-file=startup-script=scripts/vm-startup.sh

# Create firewall rules (idempotent)
gcloud compute firewall-rules create allow-http-https \
  --project="$PROJECT_ID" \
  --allow=tcp:80,tcp:443 \
  --target-tags=http-server,https-server \
  --source-ranges=0.0.0.0/0 \
  --description="Allow HTTP/HTTPS for DataVisor" \
  2>/dev/null || true
```

Source: [GCP Compute Engine docs](https://cloud.google.com/compute/docs), [GCP firewall docs](https://cloud.google.com/compute/docs/networking/firewalls)

### Anti-Patterns to Avoid

- **Exposing backend port (8000) or frontend port (3000) directly:** All external traffic must go through Caddy. Only ports 80/443 should be published.
- **Volume-mounting individual files instead of directories:** Mount `./data:/app/data` not `./data/datavisor.duckdb:/app/data/datavisor.duckdb`. DuckDB creates sibling WAL and temp files that must persist.
- **Setting `NEXT_PUBLIC_API_URL` at runtime via `docker run -e`:** Next.js inlines `NEXT_PUBLIC_*` vars at build time. Runtime env vars have no effect. Use the build arg.
- **Putting plaintext passwords in docker-compose.yml:** Use `.env` file (excluded from git) and `${VAR}` interpolation.
- **Using `allow_origins=["*"]` with `allow_credentials=True`:** This is a CORS spec violation. Browsers silently reject it. With Caddy proxy (same origin), CORS middleware is unnecessary entirely.

---

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTPS certificate management | certbot + cron + nginx config | Caddy (auto-HTTPS built-in) | Caddy handles Let's Encrypt provisioning, renewal, and OCSP stapling automatically. Zero config. |
| Password hashing | Custom bcrypt implementation | `caddy hash-password` CLI | Generates bcrypt hashes with correct cost factor. One command. |
| Auth for SSE streams | Custom EventSource polyfill + auth headers | Caddy proxy-level auth | Caddy authenticates the HTTP connection before it reaches the app. SSE streams work without modification. |
| Docker health checks | Custom scripts | Docker's built-in `healthcheck` + Caddy auto-health | `healthcheck: test: ["CMD", "curl", "-f", "http://localhost:8000/health"]` |
| Python dependency management in Docker | `pip install -r requirements.txt` | `uv sync --frozen` from lockfile | Deterministic, 10-50x faster, respects lockfile exactly |
| Frontend Docker optimization | Manual file copying | Next.js `output: "standalone"` | Produces minimal self-contained server, ~150MB vs ~1GB |

**Key insight:** The biggest "don't hand-roll" for this phase is authentication. Implementing auth in FastAPI requires: (1) auth module, (2) dependency injection on all routers, (3) frontend auth header injection, (4) SSE auth workaround (EventSource cannot set headers), (5) session/cookie management. Using Caddy's `basic_auth` at the proxy layer does all of this with 3 lines of config and zero application code changes.

---

## Common Pitfalls

### Pitfall 1: DuckDB WAL Files Lost on Unclean Container Shutdown

**What goes wrong:** DuckDB creates `.wal` (write-ahead log) and `.tmp/` files alongside the database file. If the container is killed before a clean shutdown (SIGKILL after grace period, OOM), the WAL persists. If the volume mount only covers the `.duckdb` file (not the parent directory), the WAL is lost and uncommitted data disappears silently.

**Why it happens:** Developers mount individual files instead of directories: `-v ./datavisor.duckdb:/app/data/datavisor.duckdb` instead of `-v ./data:/app/data`.

**How to avoid:**
1. Mount the entire `data/` directory: `volumes: ["./data:/app/data"]`
2. Set `stop_grace_period: 30s` in docker-compose.yml (default 10s may not be enough)
3. Add explicit `CHECKPOINT` in lifespan shutdown before `db.close()` to flush WAL
4. Ensure container user has write permissions to the entire mounted directory

**Warning signs:** Data disappears after `docker-compose restart` but not after `docker-compose down && up`.

**Confidence:** HIGH -- [DuckDB files documentation](https://duckdb.org/docs/stable/operations_manual/footprint_of_duckdb/files_created_by_duckdb)

### Pitfall 2: NEXT_PUBLIC_API_URL Baked at Build Time

**What goes wrong:** `NEXT_PUBLIC_*` environment variables are string-replaced into the JavaScript bundle during `next build`. Setting them at container runtime via `docker run -e` has zero effect. If built with `NEXT_PUBLIC_API_URL=http://localhost:8000`, the frontend calls localhost from the user's browser, not the server.

**Why it happens:** Next.js documents this behavior, but developers expect env vars to work at runtime like backend frameworks.

**How to avoid:** Use the reverse proxy pattern. Set `NEXT_PUBLIC_API_URL=/api` at build time. Caddy routes `/api/*` to the backend. Frontend and API share the same origin. No URL configuration needed per deployment.

**Warning signs:** Frontend shows "Failed to fetch" errors when deployed; browser console shows requests to `http://localhost:8000`.

**Confidence:** HIGH -- [Next.js environment variables docs](https://nextjs.org/docs/pages/guides/environment-variables)

### Pitfall 3: CORS Wildcard + Credentials Spec Violation

**What goes wrong:** The current `app/main.py` has `allow_origins=["*"]` with `allow_credentials=True`. Per CORS specification, browsers reject this combination silently. When auth is added (sending credentials), all cross-origin requests fail with a cryptic CORS error.

**Why it happens:** The wildcard was intentional for development. The spec violation is not enforced by curl/httpx, only by browsers.

**How to avoid:** With Caddy proxy (same origin), remove CORS middleware entirely in Docker mode. For local dev without Caddy, set specific origin: `allow_origins=["http://localhost:3000"]`.

**Warning signs:** API works from curl but fails from browser; `Access-Control-Allow-Origin must not be *` error.

**Confidence:** HIGH -- [FastAPI CORS docs](https://fastapi.tiangolo.com/tutorial/cors/)

### Pitfall 4: SSE Streams Break If Auth Is Added at Application Level

**What goes wrong:** The frontend uses `new EventSource(url)` for 4 SSE streams (ingestion, embeddings, reduction, VLM). The browser's `EventSource` API cannot set custom HTTP headers like `Authorization`. If auth is enforced at the FastAPI level, SSE connections fail with 401.

**Why it happens:** EventSource is a legacy API designed for simple connections. The WHATWG spec does not support custom headers.

**How to avoid:** Use Caddy-level auth. Caddy authenticates the HTTP connection before it reaches FastAPI. The browser sends credentials via the native Basic Auth dialog (which applies to all requests from the same origin, including EventSource). No application-level auth needed.

**Warning signs:** Regular API calls work after login but SSE progress streams fail with 401 or connection errors.

**Confidence:** HIGH -- [MDN EventSource docs](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials), [WHATWG Issue #2177](https://github.com/whatwg/html/issues/2177)

### Pitfall 5: Docker Image Bloat from PyTorch (~8GB)

**What goes wrong:** `torch>=2.10.0` pulls CUDA libraries by default, adding ~2.5GB. Combined with transformers, numpy, scikit-learn, the image reaches 8-12GB. Builds take 20+ minutes, pulls take 10+ minutes.

**Why it happens:** PyTorch bundles CUDA by default. Developers accept the size during initial testing and only discover the problem at deployment scale.

**How to avoid:**
1. Use CPU-only PyTorch for Docker: `uv pip install torch --index-url https://download.pytorch.org/whl/cpu` or configure `uv` to use the CPU index
2. Multi-stage build to exclude build caches
3. Use `--no-cache-dir` everywhere
4. Note: Python 3.14 CPU wheels are available for PyTorch 2.10.0 on Linux x86_64

**Warning signs:** `docker build` takes 30+ minutes; GCP VM disk fills up.

**Confidence:** HIGH -- [PyTorch CPU wheels](https://download.pytorch.org/whl/cpu), [PyTorch Python 3.14 support](https://github.com/pytorch/pytorch/issues/169929)

### Pitfall 6: GCP Firewall Default-Deny Blocks All Traffic

**What goes wrong:** GCP Compute Engine has default-deny inbound policy. Services bind inside the VM, but `http://EXTERNAL_IP` times out. Developer spends 30 minutes debugging Docker before realizing it is a firewall issue.

**Why it happens:** GCP is more restrictive than AWS by default. Only SSH (22), ICMP, and RDP (3389) are allowed.

**How to avoid:** Deployment script must create firewall rules for TCP 80,443 with `--target-tags` matching the VM. Never expose ports 8000 or 3000 directly.

**Warning signs:** Services work via SSH tunnel but not via public IP.

**Confidence:** HIGH -- [GCP firewall docs](https://cloud.google.com/compute/docs/networking/firewalls)

### Pitfall 7: Docker Compose `$` in Bcrypt Hashes

**What goes wrong:** Bcrypt hashes contain literal `$` characters (e.g., `$2a$14$...`). Docker Compose interprets `$` as variable interpolation and silently replaces them. The password hash becomes corrupted and all auth attempts fail.

**How to avoid:** Store the hash in a `.env` file and reference it as `${AUTH_PASSWORD_HASH}`. Docker Compose reads `.env` values literally without interpolation. Alternatively, double every `$` as `$$` in `docker-compose.yml` if inline.

**Warning signs:** Auth always returns 401 even with correct password; Caddy logs show hash mismatch.

**Confidence:** HIGH -- [Caddy community: basic_auth Docker Compose](https://caddy.community/t/setting-up-caddy-docker-proxy-for-basic-auth-sso/15655)

### Pitfall 8: Image Path Resolution Breaks in Docker

**What goes wrong:** The `datasets.image_dir` column stores absolute host paths from ingestion (e.g., `/Users/ortizeg/datasets/coco/images/`). Inside the Docker container, these paths do not exist. Image serving returns `FileNotFoundError`.

**Why it happens:** The v1.0 system was designed for local execution where host and process paths are identical. Docker introduces a path namespace boundary.

**How to avoid:**
1. For Docker: images must be bind-mounted into the container at a known path
2. Add a `DATAVISOR_IMAGE_BASE_DIR` environment variable for path remapping
3. Datasets ingested inside Docker will have container paths (correct)
4. Datasets ingested before Docker need a path remap or re-ingestion

**Warning signs:** Thumbnails show broken images in Docker; `FileNotFoundError` in logs for host-specific paths.

**Confidence:** HIGH -- verified against `app/repositories/storage.py:29` which uses `Path(path).resolve()`

---

## Code Examples

Verified patterns from official sources:

### Generating Caddy Password Hash

```bash
# Generate bcrypt hash for auth password
# Run inside the Caddy container or with caddy installed locally
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-secure-password'
# Output: $2a$14$Zkx19XLiW6VYouLHR5NmfOFU0z2GTNmpkT/5qqR7hx4IjWJPDhjvG
```

Source: [Caddy basic_auth docs](https://caddyserver.com/docs/caddyfile/directives/basic_auth)

### .env File for Docker Compose

```bash
# .env (git-ignored, created per-deployment)
DOMAIN=localhost                  # Set to your-domain.com for HTTPS
AUTH_USERNAME=admin
AUTH_PASSWORD_HASH=$2a$14$Zkx19XLiW6VYouLHR5NmfOFU0z2GTNmpkT/5qqR7hx4IjWJPDhjvG
```

### Frontend API_BASE Change for Docker

```typescript
// frontend/src/lib/constants.ts -- works for both local dev and Docker
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
// Local dev: NEXT_PUBLIC_API_URL unset -> "http://localhost:8000" (direct to backend)
// Docker:    NEXT_PUBLIC_API_URL=/api -> "/api" (through Caddy proxy)
```

No code change needed -- the existing fallback pattern already works. The Docker build sets `NEXT_PUBLIC_API_URL=/api` via build arg.

### CORS Fix for Docker Deployment

```python
# app/main.py -- conditional CORS based on environment
settings = get_settings()

# In Docker with Caddy proxy: same origin, no CORS needed
# In local dev: allow localhost:3000
if not settings.behind_proxy:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
```

New setting in `config.py`:
```python
behind_proxy: bool = False  # Set DATAVISOR_BEHIND_PROXY=true in Docker
```

### DuckDB Checkpoint on Shutdown

```python
# app/main.py lifespan shutdown -- add CHECKPOINT before close
yield

# Shutdown
plugin_registry.shutdown()
similarity_service.close()
db.connection.execute("CHECKPOINT")  # Flush WAL to database file
db.close()
```

### Docker Health Check

```yaml
# In docker-compose.yml backend service
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s  # Backend needs time to load embedding model
```

### .dockerignore

```
.git
.venv
__pycache__
data/
*.pyc
.planning/
tests/
.env
.env.*
node_modules/
.next/
```

### Local Run Script

```bash
#!/usr/bin/env bash
# scripts/run-local.sh -- Start DataVisor locally via Docker Compose
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check for .env
if [ ! -f .env ]; then
    echo "Creating default .env file..."
    cp .env.example .env
    echo "Edit .env to set AUTH_PASSWORD_HASH, then re-run."
    exit 1
fi

docker compose up --build -d
echo "DataVisor is running at http://localhost"
echo "Stop with: docker compose down"
```

### VM Startup Script Pattern

```bash
#!/usr/bin/env bash
# scripts/vm-startup.sh -- Runs on GCP VM first boot
set -euo pipefail

# Install Docker + Docker Compose
apt-get update
apt-get install -y docker.io docker-compose-plugin git
systemctl enable docker
systemctl start docker

# Clone and start
cd /opt
git clone https://github.com/YOUR_USER/data-visor.git
cd data-visor

# .env must be created separately (via SCP or metadata)
docker compose up -d --build
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| nginx + certbot for HTTPS | Caddy auto-HTTPS | Caddy 2.0 (2020) | Zero-config HTTPS, no cron renewal |
| `pip install` in Docker | `uv sync --frozen` | uv 0.1+ (2024) | 10-50x faster, deterministic installs |
| `docker-compose` (v1, Python) | `docker compose` (v2, Go plugin) | Docker Compose v2 (2022) | Faster, integrated into Docker CLI |
| GCP Container-Optimized OS + manual compose | Ubuntu 24.04 + apt docker-compose-plugin | 2024+ | COS Docker Compose support still unofficial |
| gunicorn + uvicorn workers | uvicorn single worker | N/A for single-user | Gunicorn adds complexity with no benefit for one user |
| JWT/OAuth2 for single-user | HTTP Basic Auth via reverse proxy | N/A | Massively simpler; sufficient for single-user personal tool |

**Deprecated/outdated:**
- `docker-compose` (v1, Python-based): Use `docker compose` (v2, Go-based plugin)
- `requirements.txt` in Docker: Use `uv.lock` with `uv sync --frozen`
- nginx for single-service proxying: Caddy is simpler for auto-HTTPS + basic auth
- GCP Container-Optimized OS for Docker Compose: Docker Compose is not bundled; use Ubuntu instead

---

## Specific Integration Points with Existing Codebase

### Files to Create

| File | Purpose |
|------|---------|
| `Dockerfile.backend` | Multi-stage Python 3.14 + uv build |
| `Dockerfile.frontend` | Multi-stage Next.js standalone build |
| `docker-compose.yml` | 3-service orchestration |
| `Caddyfile` | Reverse proxy + basic auth |
| `.dockerignore` | Exclude data, venv, git, tests |
| `.env.example` | Template showing required vars |
| `scripts/deploy-gcp.sh` | GCP VM provisioning |
| `scripts/vm-startup.sh` | VM bootstrap (Docker install, clone, start) |
| `scripts/run-local.sh` | Local Docker Compose launcher |
| `docs/deployment.md` | Deployment documentation |

### Files to Modify

| File | Change | Rationale |
|------|--------|-----------|
| `frontend/next.config.ts` | Add `output: "standalone"` | Required for Docker-optimized Next.js build |
| `app/config.py` | Add `behind_proxy: bool = False` setting | Conditional CORS: skip in Docker (same origin via Caddy) |
| `app/main.py` | Conditional CORS middleware; add `CHECKPOINT` on shutdown | Fix spec-invalid CORS; ensure clean DuckDB shutdown |

### Files That Need NO Changes

| File | Why Unchanged |
|------|---------------|
| `frontend/src/lib/constants.ts` | Already uses `NEXT_PUBLIC_API_URL` env var with fallback -- works as-is |
| `frontend/src/lib/api.ts` | No auth headers needed -- Caddy handles auth at proxy layer |
| `frontend/src/hooks/use-*-progress.ts` | SSE EventSource works through Caddy without modification |
| `app/services/similarity_service.py` | Qdrant stays in local mode -- no change |
| All `app/routers/*.py` | No auth dependency injection needed -- Caddy handles auth |
| `app/repositories/duckdb_repo.py` | Schema unchanged for this phase |

### SSE Endpoints That Must Work Through Proxy

| Endpoint | Router | Content-Type |
|----------|--------|-------------|
| `POST /datasets/ingest` | `datasets.py` | `text/event-stream` (StreamingResponse) |
| `POST /embeddings/generate` | `embeddings.py` | `text/event-stream` (EventSourceResponse) |
| `POST /embeddings/reduce` | `embeddings.py` | `text/event-stream` (EventSourceResponse) |
| `POST /vlm/describe` | `vlm.py` | `text/event-stream` (EventSourceResponse) |

All four use `text/event-stream` content type which Caddy flushes immediately by default. No special configuration needed.

---

## Open Questions

Things that could not be fully resolved:

1. **PyTorch CPU-only installation via `uv`**
   - What we know: PyTorch 2.10.0 CPU wheels exist for Python 3.14 on Linux x86_64 at `https://download.pytorch.org/whl/cpu`
   - What's unclear: Whether `uv sync --frozen` can be configured to use a custom index URL for a single package (torch) while using PyPI for everything else. May need `uv pip install torch --index-url ...` as a separate step in the Dockerfile.
   - Recommendation: Test during implementation. Worst case, add a `RUN uv pip install torch --index-url https://download.pytorch.org/whl/cpu` line before `uv sync`.

2. **Image path remapping for pre-Docker datasets**
   - What we know: Datasets ingested before Docker store absolute host paths in `datasets.image_dir`.
   - What's unclear: Whether a simple `DATAVISOR_IMAGE_BASE_DIR` remap is sufficient, or if a migration script is needed.
   - Recommendation: For v1.1, document that datasets should be re-ingested in Docker mode. A path remap feature can be added later if needed. Focus on ensuring datasets ingested inside Docker work correctly.

3. **GCP persistent disk auto-mount on reboot**
   - What we know: The boot disk itself persists. For the deployment script using a single boot disk (not a separate data disk), data in `/opt/data-visor/data/` persists across reboots.
   - What's unclear: Whether Docker auto-restarts (via `restart: unless-stopped`) work correctly after VM reboot if Docker itself needs to start first.
   - Recommendation: The VM startup script should ensure Docker service is enabled (`systemctl enable docker`). Docker's `unless-stopped` policy will restart containers once Docker daemon starts.

---

## Sources

### Primary (HIGH confidence)
- [Caddy basic_auth directive](https://caddyserver.com/docs/caddyfile/directives/basic_auth) -- auth syntax, bcrypt hashing
- [Caddy reverse_proxy directive](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) -- SSE flush_interval auto-detection for text/event-stream
- [Caddy Caddyfile concepts](https://caddyserver.com/docs/caddyfile/concepts) -- `{$ENV_VAR:default}` syntax for environment variables
- [Caddy Docker image](https://hub.docker.com/_/caddy) -- caddy:2-alpine
- [Next.js standalone output docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) -- Docker-optimized builds
- [Next.js environment variables docs](https://nextjs.org/docs/pages/guides/environment-variables) -- NEXT_PUBLIC build-time inlining
- [FastAPI Docker deployment docs](https://fastapi.tiangolo.com/deployment/docker/) -- multi-stage build pattern
- [FastAPI CORS docs](https://fastapi.tiangolo.com/tutorial/cors/) -- wildcard + credentials restriction
- [DuckDB files documentation](https://duckdb.org/docs/stable/operations_manual/footprint_of_duckdb/files_created_by_duckdb) -- WAL, lock files, tmp directory
- [GCP Compute Engine docs](https://cloud.google.com/compute/docs) -- VM creation, firewall rules
- [GCP firewall docs](https://cloud.google.com/compute/docs/networking/firewalls) -- default-deny policy
- [MDN EventSource docs](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials) -- cannot set custom headers

### Secondary (MEDIUM confidence)
- [Caddy SSE community discussion](https://caddy.community/t/server-sent-events-buffering-with-reverse-proxy/11722) -- confirmed: Caddy auto-flushes text/event-stream, no config needed
- [PyTorch Python 3.14 issue #169929](https://github.com/pytorch/pytorch/issues/169929) -- CPU wheels available for 3.14, CUDA limited
- [GCP COS Docker Compose gist](https://gist.github.com/kurokobo/25e41503eb060fee8d8bec1dd859eff3) -- COS requires workaround for Compose
- [Docker Compose bcrypt hash interpolation](https://caddy.community/t/setting-up-caddy-docker-proxy-for-basic-auth-sso/15655) -- `$$` escaping or `.env` file

### Tertiary (LOW confidence)
- [PyTorch Docker optimization](https://mveg.es/posts/optimizing-pytorch-docker-images-cut-size-by-60percent/) -- CPU-only torch reduces image 60%

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Caddy, Docker Compose, multi-stage builds are well-established patterns with verified documentation
- Architecture: HIGH -- reverse proxy pattern verified against Caddy docs; SSE auto-flush confirmed
- Pitfalls: HIGH -- all pitfalls verified against official documentation and existing codebase analysis
- GCP deployment: MEDIUM -- Ubuntu approach is straightforward but startup script testing needed
- PyTorch Docker size: MEDIUM -- CPU wheel availability confirmed but `uv` integration with custom index not fully verified

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (stable domain, slow-moving ecosystem)
