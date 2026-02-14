# DataVisor Deployment Guide

## 1. Overview

DataVisor runs as a 3-service Docker stack:

- **Backend** -- FastAPI server with DuckDB and embedded Qdrant for storage
- **Frontend** -- Next.js UI served via standalone output
- **Caddy** -- Reverse proxy handling routing, basic auth, and automatic HTTPS

All traffic enters through Caddy on ports 80 and 443. The backend and frontend containers are not exposed to the host network. Single-user basic auth is handled entirely by Caddy at the proxy layer -- no application code changes are needed.

```
User --> Caddy (80/443)
            |-- /api/*  --> Backend (8000)
            |-- /*      --> Frontend (3000)
```

Qdrant runs in local embedded mode inside the backend container, not as a separate service.

## 2. Prerequisites

- **Docker** and **Docker Compose v2** (`docker compose` command, not the legacy `docker-compose` binary)
- For GCP deployment: `gcloud` CLI authenticated with a project

Verify Docker Compose v2:

```bash
docker compose version
# Docker Compose version v2.x.x
```

## 3. Quick Start (Local)

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Generate a password hash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'

# 3. Edit .env and set AUTH_PASSWORD_HASH to the output from step 2
#    The hash starts with $2a$... -- paste the entire line

# 4. Start DataVisor
./scripts/run-local.sh
# Or directly:
docker compose up --build -d

# 5. Open http://localhost
#    Username: admin (or whatever AUTH_USERNAME is set to)
#    Password: the plaintext password you used in step 2

# 6. Stop
docker compose down
```

The `run-local.sh` script handles creating the `data/` directory, checking for `.env`, and validating that `AUTH_PASSWORD_HASH` is set before starting.

## 4. Environment Variables

All variables are defined in `.env.example`. Copy it to `.env` and adjust as needed.

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | `localhost` | Set to your domain for automatic HTTPS via Let's Encrypt |
| `AUTH_USERNAME` | `admin` | Basic auth username |
| `AUTH_PASSWORD_HASH` | *(required)* | Bcrypt hash from `caddy hash-password`. No default -- must be set explicitly |
| `DATAVISOR_DB_PATH` | `data/datavisor.duckdb` | DuckDB database path (mapped to `/app/data/datavisor.duckdb` in container) |
| `DATAVISOR_THUMBNAIL_CACHE_DIR` | `data/thumbnails` | Thumbnail cache directory |
| `DATAVISOR_PLUGIN_DIR` | `plugins` | Plugin directory |
| `DATAVISOR_HOST` | `0.0.0.0` | Backend listen address |
| `DATAVISOR_PORT` | `8000` | Backend listen port |
| `DATAVISOR_BEHIND_PROXY` | `false` (host) / `true` (Docker) | Disables CORS when running behind Caddy. Set automatically in `docker-compose.yml` |
| `DATAVISOR_GCS_CREDENTIALS_PATH` | *(empty)* | Path to GCS service account JSON for remote dataset access |
| `DATAVISOR_AGENT_MODEL` | `openai:gpt-4o` | AI agent model identifier |
| `DATAVISOR_VLM_DEVICE` | auto-detected | VLM inference device. Forced to `cpu` in Docker |

Generate a password hash:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'
```

## 5. GCP Deployment

### Provision the VM

```bash
# Required: set your GCP project
export GCP_PROJECT_ID=your-project-id

# Optional overrides (shown with defaults)
export GCP_ZONE=us-central1-a
export GCP_INSTANCE=datavisor
export GCP_MACHINE_TYPE=e2-standard-4
export GCP_DISK_SIZE=50

# Run the provisioning script
./scripts/deploy-gcp.sh
```

The script creates an Ubuntu 24.04 LTS VM with Docker pre-installed via the startup script (`scripts/vm-startup.sh`). It also creates firewall rules allowing HTTP and HTTPS traffic.

### Configure and Start on the VM

```bash
# SSH into the VM
gcloud compute ssh datavisor --project=your-project-id --zone=us-central1-a

# Navigate to the project
cd /opt/data-visor

# Create .env from template
cp .env.example .env

# Generate password hash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'

# Edit .env: set AUTH_PASSWORD_HASH (and DOMAIN if using a custom domain)
nano .env

# Build and start
docker compose up -d --build

# Verify
docker compose ps
```

Access DataVisor at `http://EXTERNAL_IP` (the IP is printed by `deploy-gcp.sh`).

## 6. Custom Domain with HTTPS

1. Point a DNS A record for your domain to the VM's external IP address
2. Set `DOMAIN=yourdomain.com` in `.env` on the VM
3. Restart Caddy to pick up the new domain:

```bash
docker compose restart caddy
```

Caddy automatically provisions a Let's Encrypt TLS certificate on the first request. The initial certificate issuance takes approximately 30 seconds. After that, HTTPS works at `https://yourdomain.com` and HTTP requests are redirected automatically.

## 7. Data Persistence

All application data is stored in the `./data/` directory on the host, bind-mounted to `/app/data` inside the backend container.

Contents:

| Path | Purpose |
|------|---------|
| `data/datavisor.duckdb` | Main DuckDB database |
| `data/datavisor.duckdb.wal` | DuckDB write-ahead log |
| `data/qdrant/` | Qdrant vector store (embeddings) |
| `data/thumbnails/` | Cached image thumbnails |

Data persists across `docker compose down` and `docker compose up` cycles. The `data/` directory is never deleted by Docker.

**Backups:** Copy the entire `data/` directory. DuckDB creates WAL and temporary files alongside the `.duckdb` file -- always back up the full directory, not individual files.

```bash
# Backup
cp -r data/ data-backup-$(date +%Y%m%d)/

# Restore
cp -r data-backup-20260212/ data/
```

## 8. Updating

```bash
# Pull latest code
git pull

# Rebuild and restart (data in ./data/ is preserved)
docker compose up --build -d
```

Images are rebuilt with the new code. The `data/` bind mount is unaffected by image rebuilds.

## 9. Troubleshooting

**"Connection refused" when accessing http://localhost**

Check that all services are running:

```bash
docker compose ps
docker compose logs caddy
```

All three services (backend, frontend, caddy) should show as "running" or "healthy".

**"401 Unauthorized" after entering credentials**

Verify `AUTH_PASSWORD_HASH` in `.env` is a valid bcrypt hash. Regenerate it:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'
```

The hash must start with `$2a$` or `$2b$`. Make sure there are no extra spaces or quotes around the value in `.env`.

**CORS errors in browser console**

Ensure `DATAVISOR_BEHIND_PROXY=true` is set in the backend environment. This is configured automatically in `docker-compose.yml` -- do not override it in `.env` when running via Docker.

**Broken images / missing thumbnails**

Datasets ingested before Docker may store host-specific file paths. Re-ingest datasets from within the Docker environment so paths resolve correctly inside the container.

**Timeout on GCP / cannot reach VM**

Check firewall rules:

```bash
gcloud compute firewall-rules list --filter="name=allow-http-https"
```

The rule should allow TCP ports 80 and 443 from `0.0.0.0/0` with target tags `http-server,https-server`.

**SSE streams not working (real-time updates stall)**

Caddy automatically flushes `text/event-stream` responses. If streams stall, check backend logs:

```bash
docker compose logs backend --tail=50
```

**First build is slow (5-15 minutes)**

The backend image installs PyTorch (CPU-only) which is a large download. Subsequent builds use Docker layer caching and are much faster.

**Container keeps restarting**

Check logs for the failing service:

```bash
docker compose logs backend --tail=100
docker compose logs frontend --tail=100
```

Common causes: missing `.env` file, invalid `AUTH_PASSWORD_HASH`, or port 80/443 already in use on the host.

## 10. Architecture

```
                    +------------------+
                    |      User        |
                    +--------+---------+
                             |
                    HTTP/HTTPS (80/443)
                             |
                    +--------+---------+
                    |      Caddy       |
                    |  (reverse proxy) |
                    |  - basic auth    |
                    |  - auto HTTPS    |
                    +---+---------+----+
                        |         |
               /api/*   |         |  /*
                        v         v
              +---------+--+  +---+---------+
              |  Backend   |  |  Frontend   |
              |  (FastAPI) |  |  (Next.js)  |
              |  port 8000 |  |  port 3000  |
              +-----+------+  +-------------+
                    |
          +---------+---------+
          |         |         |
       DuckDB   Qdrant   Thumbnails
       (data/)  (data/)   (data/)
```

- **Caddy** is the only service exposed to the host network. It handles TLS termination, basic auth, and request routing.
- **Backend** serves the FastAPI API. Qdrant runs in embedded mode within the same process (not a separate container). All persistent state lives in `./data/`.
- **Frontend** serves the Next.js standalone build. API requests are proxied by Caddy to the backend -- the frontend never contacts the backend directly from the browser.
- The `NEXT_PUBLIC_API_URL=/api` build arg ensures the frontend makes same-origin requests to `/api/*`, which Caddy routes to the backend after stripping the `/api` prefix.
