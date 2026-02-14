---
phase: 08-docker-deployment-auth
plan: 02
subsystem: infra
tags: [docker, nextjs, caddy, reverse-proxy, basic-auth, standalone]

# Dependency graph
requires:
  - phase: none
    provides: none (independent plan)
provides:
  - "Multi-stage Dockerfile.frontend with standalone Next.js output (~357MB image)"
  - "Caddyfile reverse proxy with basic_auth, /api/* to backend, /* to frontend"
  - "next.config.ts output: standalone for Docker-optimized builds"
affects: [08-03 docker-compose, 08-04 deployment scripts]

# Tech tracking
tech-stack:
  added: [caddy:2-alpine]
  patterns: [multi-stage-docker-build, standalone-nextjs, reverse-proxy-auth, same-origin-api]

key-files:
  created:
    - Dockerfile.frontend
    - Caddyfile
  modified:
    - frontend/next.config.ts

key-decisions:
  - "NEXT_PUBLIC_API_URL=/api baked at build time for same-origin API calls via Caddy"
  - "Caddy handles all auth at proxy layer -- zero application code changes needed"
  - "3-stage Docker build (deps, builder, runner) with non-root nextjs user"

patterns-established:
  - "Same-origin API pattern: frontend calls /api/*, Caddy strips prefix and forwards to backend"
  - "Proxy-level auth: basic_auth in Caddyfile protects all routes including SSE"

# Metrics
duration: 2min
completed: 2026-02-12
---

# Phase 8 Plan 02: Frontend Docker & Caddy Proxy Summary

**Multi-stage standalone Next.js Docker image (~357MB) with Caddy reverse proxy handling basic auth, /api/* routing to backend, and auto-HTTPS via env vars**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-12T22:00:58Z
- **Completed:** 2026-02-12T22:03:16Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Frontend Docker image builds successfully with standalone Next.js output (357MB vs ~1GB without standalone)
- Caddy configured as single entry point with basic_auth on all routes, /api/* forwarding to backend:8000 with prefix stripping, catch-all to frontend:3000
- NEXT_PUBLIC_API_URL=/api baked at build time so all frontend API calls go through same-origin Caddy proxy
- Environment-variable-driven configuration: DOMAIN (auto-HTTPS), AUTH_USERNAME, AUTH_PASSWORD_HASH (bcrypt)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create multi-stage frontend Dockerfile and update next.config.ts** - `59be9ea` (feat)
2. **Task 2: Create Caddyfile reverse proxy configuration** - `31ea7ba` (feat)

## Files Created/Modified
- `Dockerfile.frontend` - 3-stage Docker build: deps (npm ci), builder (next build with NEXT_PUBLIC_API_URL=/api), runner (node server.js as non-root user)
- `Caddyfile` - Caddy reverse proxy with basic_auth, /api/* strip prefix + forward to backend:8000, catch-all to frontend:3000
- `frontend/next.config.ts` - Added `output: "standalone"` for Docker-optimized builds

## Decisions Made
- Kept 3-stage build pattern (deps/builder/runner) for optimal layer caching -- deps stage only re-runs when package.json changes
- Used Caddy's env variable syntax `{$VAR:default}` for zero-config local dev (localhost) and auto-HTTPS in production (set DOMAIN)
- No AUTH_PASSWORD_HASH default -- Caddy errors without it, which is intentional to prevent running without auth
- Image size is 357MB (larger than the ideal 150MB due to heavy dependencies like deck.gl and recharts, but still much smaller than ~1GB without standalone mode)

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- Dockerfile.frontend and Caddyfile ready for docker-compose.yml integration (Plan 03)
- Dockerfile.backend already exists from Plan 01
- All three services (backend, frontend, caddy) can be wired together in docker-compose.yml

---
*Phase: 08-docker-deployment-auth*
*Completed: 2026-02-12*
