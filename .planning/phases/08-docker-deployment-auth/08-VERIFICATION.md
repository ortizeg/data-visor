---
phase: 08-docker-deployment-auth
verified: 2026-02-12T18:35:00Z
status: human_needed
score: 5/5 must-haves verified (automated checks)
human_verification:
  - test: "Start full Docker stack and verify auth prompt"
    expected: "Browser shows basic auth dialog before any page loads"
    why_human: "Auth prompt is browser UI behavior, cannot verify programmatically"
  - test: "Reject unauthenticated API request"
    expected: "curl without credentials returns 401 Unauthorized"
    why_human: "Requires running Docker stack and testing actual HTTP behavior"
  - test: "Access full UI after auth and verify all features work"
    expected: "Grid loads, embeddings render, error analysis functions"
    why_human: "Full feature integration test requires running system"
  - test: "Verify data persistence across container restart"
    expected: "docker compose down && docker compose up preserves DuckDB data, Qdrant vectors, thumbnails"
    why_human: "Requires running stack, creating data, stopping, and restarting"
  - test: "Run GCP deployment script and access via public IP"
    expected: "VM provisions, startup script runs, manual .env setup works, services start"
    why_human: "Requires GCP account, project, and actual VM provisioning"
  - test: "Configure custom domain and verify HTTPS"
    expected: "Let's Encrypt certificate auto-provisions, HTTPS works"
    why_human: "Requires DNS configuration and actual domain"
---

# Phase 08: Docker Deployment & Auth Verification Report

**Phase Goal:** DataVisor runs as a deployable Docker stack with single-user auth, accessible securely on a cloud VM or locally with a single command

**Verified:** 2026-02-12T18:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can run `docker compose up` and access DataVisor at `http://localhost` with all features working | ✓ VERIFIED | docker-compose.yml exists, orchestrates 3 services, scripts/run-local.sh validates .env before starting |
| 2 | User is prompted for username/password before accessing any page or API endpoint, and unauthenticated requests are rejected | ✓ VERIFIED | Caddyfile has basic_auth on all routes, AUTH_PASSWORD_HASH required (no default), Caddy is single entry point (only service exposing ports) |
| 3 | User can run a deployment script that provisions a GCP VM with persistent disk and starts DataVisor accessible at a public IP with HTTPS | ✓ VERIFIED | scripts/deploy-gcp.sh provisions VM with firewall rules, scripts/vm-startup.sh installs Docker, Caddyfile supports DOMAIN env var for auto-HTTPS |
| 4 | User can follow deployment documentation to configure environment variables, deploy to GCP, and set up a custom domain | ✓ VERIFIED | docs/deployment.md (278 lines) covers env vars, local setup, GCP deployment, custom domain HTTPS |
| 5 | DuckDB data, Qdrant vectors, and thumbnail cache persist across container restarts without data loss | ✓ VERIFIED | docker-compose.yml has ./data:/app/data bind mount, backend has CHECKPOINT on shutdown, data/ excluded from .dockerignore |

**Score:** 5/5 truths verified (automated structural checks)

**Note:** All automated checks pass. Human verification required to confirm runtime behavior (auth prompts, actual data persistence, GCP deployment, HTTPS provisioning).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `Dockerfile.backend` | Multi-stage Python 3.14 build with uv, CPU PyTorch, opencv-headless | ✓ VERIFIED | 37 lines, 2-stage build, uv sync + CPU torch replacement + opencv-headless |
| `Dockerfile.frontend` | Multi-stage Next.js standalone build | ✓ VERIFIED | 40 lines, 3-stage build (deps/builder/runner), NEXT_PUBLIC_API_URL=/api baked at build |
| `Caddyfile` | Reverse proxy with basic_auth, /api/* routing, auto-HTTPS | ✓ VERIFIED | 14 lines, basic_auth on all routes, strip_prefix /api, DOMAIN env var support |
| `docker-compose.yml` | 3-service orchestration with volumes and env config | ✓ VERIFIED | 54 lines, backend/frontend/caddy services, ./data bind mount, caddy exposes 80/443 only |
| `scripts/run-local.sh` | One-command local launcher with .env validation | ✓ VERIFIED | 48 lines, validates AUTH_PASSWORD_HASH, creates data dir, runs docker compose |
| `scripts/deploy-gcp.sh` | GCP VM provisioning script | ✓ VERIFIED | 72 lines, gcloud compute instance create, firewall rules, prints next steps |
| `scripts/vm-startup.sh` | VM bootstrap script | ✓ VERIFIED | 29 lines, installs Docker + git, clones repo, creates data dir |
| `docs/deployment.md` | Deployment documentation | ✓ VERIFIED | 278 lines, 10 sections (overview, quick start, env vars, GCP, custom domain, persistence, updating, troubleshooting, architecture) |
| `app/config.py` | behind_proxy setting | ✓ VERIFIED | Line 37: `behind_proxy: bool = False` with comment |
| `app/main.py` | Conditional CORS + DuckDB CHECKPOINT | ✓ VERIFIED | Conditional CORS (line ~60), CHECKPOINT on shutdown (line 88) |
| `frontend/next.config.ts` | output: standalone | ✓ VERIFIED | Line 4: `output: "standalone"` |
| `.dockerignore` | Build context exclusions | ✓ VERIFIED | 15 lines, excludes data/, .venv/, tests/, frontend/, .planning/ |
| `.env.example` | Auth config documented | ✓ VERIFIED | Has AUTH_USERNAME, AUTH_PASSWORD_HASH with hash generation instructions |

**Artifact Status:** 13/13 verified (all exist, substantive, no stubs)

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Caddy | Backend | reverse_proxy backend:8000 | ✓ WIRED | Caddyfile line 8, strip_prefix /api before forwarding |
| Caddy | Frontend | reverse_proxy frontend:3000 | ✓ WIRED | Caddyfile line 12, catch-all handle |
| Frontend | Backend API | NEXT_PUBLIC_API_URL=/api | ✓ WIRED | Dockerfile.frontend ARG, frontend/src/lib/constants.ts uses env var |
| docker-compose | Dockerfiles | build.dockerfile | ✓ WIRED | References Dockerfile.backend and Dockerfile.frontend |
| docker-compose | Data persistence | volumes: ./data:/app/data | ✓ WIRED | Backend service has bind mount, env vars point to /app/data paths |
| Backend | DuckDB flush | CHECKPOINT on shutdown | ✓ WIRED | app/main.py line 88 in lifespan shutdown |
| Backend | CORS conditional | behind_proxy setting | ✓ WIRED | app/main.py checks settings.behind_proxy before adding CORS middleware |
| run-local.sh | docker-compose.yml | docker compose up | ✓ WIRED | Script calls docker compose up --build -d after validation |
| deploy-gcp.sh | vm-startup.sh | metadata-from-file | ✓ WIRED | Script passes vm-startup.sh as startup-script metadata |

**Link Status:** 9/9 verified (all connections present and substantive)

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| DEPLOY-01: 3-service Docker Compose stack with persistent volumes | ✓ SATISFIED | docker-compose.yml exists, 3 services, ./data bind mount |
| DEPLOY-02: Single-user basic auth via Caddy with HTTPS | ✓ SATISFIED | Caddyfile basic_auth, DOMAIN env var for auto-HTTPS |
| DEPLOY-03: GCP VM deployment script | ✓ SATISFIED | scripts/deploy-gcp.sh provisions VM + firewall |
| DEPLOY-04: Local run script | ✓ SATISFIED | scripts/run-local.sh validates .env and starts stack |
| DEPLOY-05: Deployment documentation | ✓ SATISFIED | docs/deployment.md (278 lines, 10 sections) |

**Coverage:** 5/5 requirements satisfied (structural verification)

### Anti-Patterns Found

None. All Docker files are substantive, no TODO/FIXME/placeholder patterns found.

**Scan results:**
- Backend Dockerfile: 37 lines, multi-stage build, CPU torch optimization, opencv-headless fix applied
- Frontend Dockerfile: 40 lines, 3-stage build with standalone output
- Caddyfile: 14 lines, production-ready reverse proxy config
- docker-compose.yml: 54 lines, proper service orchestration with dependencies and healthchecks
- Deployment scripts: All executable, proper error handling (set -euo pipefail)

### Human Verification Required

#### 1. Docker Stack Startup and Auth Prompt

**Test:** Run `./scripts/run-local.sh` (with AUTH_PASSWORD_HASH configured in .env), then open http://localhost in browser
**Expected:** Browser shows basic auth dialog before any page loads. After entering credentials, UI loads normally.
**Why human:** Auth prompt is browser UI behavior. Automated verification would require browser automation (Playwright/Selenium) which is out of scope for structural verification.

#### 2. Unauthenticated Request Rejection

**Test:** With Docker stack running, attempt `curl http://localhost/api/datasets` without credentials
**Expected:** Receives `401 Unauthorized` response from Caddy
**Why human:** Requires running Docker stack and testing actual HTTP response codes. Structural verification confirms Caddyfile has basic_auth on all routes, but runtime behavior needs confirmation.

#### 3. Full Feature Functionality After Auth

**Test:** After authenticating, navigate through DataVisor: view grid, click sample detail, view embeddings scatter plot, run error analysis
**Expected:** All v1.0 features work identically to local dev mode (grid, embeddings, error analysis, VLM tagging, similarity search)
**Why human:** Full integration test requires running system with loaded dataset. Automated testing would require test dataset import and UI automation.

#### 4. Data Persistence Across Container Restart

**Test:** 
1. Start stack, import a small dataset (creates DuckDB data, Qdrant vectors, thumbnails)
2. Run `docker compose down`
3. Run `docker compose up`
4. Verify dataset still appears in UI with all annotations and embeddings intact

**Expected:** All data persists. No "dataset not found" errors. Thumbnails load without regeneration.
**Why human:** Requires running stack, creating state, and verifying persistence. The bind mount configuration is verified structurally (./data:/app/data), but actual persistence behavior needs runtime confirmation.

#### 5. GCP Deployment End-to-End

**Test:**
1. Run `export GCP_PROJECT_ID=your-project && ./scripts/deploy-gcp.sh`
2. Wait for VM startup (3-5 min)
3. SSH to VM, create .env with AUTH_PASSWORD_HASH, run `docker compose up -d --build`
4. Access via public IP

**Expected:** VM provisions successfully, Docker images build, services start, accessible at http://EXTERNAL_IP with auth prompt
**Why human:** Requires GCP account and project. Automated GCP provisioning testing would require service account setup and teardown automation.

#### 6. Custom Domain HTTPS with Let's Encrypt

**Test:**
1. Point DNS A record to VM external IP
2. Set `DOMAIN=yourdomain.com` in .env on VM
3. Restart Caddy: `docker compose restart caddy`
4. Access https://yourdomain.com

**Expected:** Let's Encrypt certificate auto-provisions on first request (~30 sec), HTTPS works, HTTP redirects to HTTPS
**Why human:** Requires actual domain ownership and DNS configuration. Let's Encrypt certificate issuance depends on external CA validation.

### Gaps Summary

No structural gaps found. All required artifacts exist, are substantive, and are properly wired together.

**Automated verification passed:**
- All 5 success criteria structurally verified
- All 13 required artifacts exist with substantive implementations
- All 9 key links properly wired
- All 5 DEPLOY-* requirements satisfied
- Zero anti-patterns detected

**Human verification pending:**
- Runtime behavior (auth prompt, request rejection, feature functionality)
- Data persistence across restarts (bind mount works in practice)
- GCP deployment end-to-end (VM provisions, services start, accessible)
- HTTPS auto-provisioning (Let's Encrypt integration)

The phase 08 SUMMARY.md claims "User-verified end-to-end Docker stack: auth prompt, UI loads, API responds, all 3 services healthy over Caddy HTTPS" in plan 08-05. This suggests human verification already occurred during plan execution. However, programmatic verification cannot confirm this — only that all structural components required for this behavior are present and correct.

**Recommendation:** Phase 08 goal is structurally achieved. All deployment infrastructure exists and is production-ready. Human verification items are standard deployment validation steps that should be run by end users during actual deployment. No gaps requiring additional development work.

---

_Verified: 2026-02-12T18:35:00Z_
_Verifier: Claude (gsd-verifier)_
