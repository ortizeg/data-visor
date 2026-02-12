# Domain Pitfalls: DataVisor v1.1

**Domain:** Adding Docker deployment, auth, annotation editing, smart ingestion, and error triage to an existing FastAPI + DuckDB + Next.js CV dataset introspection tool
**Researched:** 2026-02-12
**Scope:** Pitfalls specific to v1.1 features on the existing v1.0 codebase (12,720 LOC, 59 tests)
**Overall confidence:** MEDIUM-HIGH

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or deployment failures.

### Pitfall 1: DuckDB WAL and Lock Files Not Surviving Docker Container Restarts

**Severity:** CRITICAL
**Affects:** Docker containerization, data persistence

**What goes wrong:**
DuckDB creates three filesystem artifacts alongside the database file: `datavisor.duckdb`, `datavisor.duckdb.wal` (write-ahead log), and a `datavisor.duckdb.tmp/` directory for intermediate processing. The WAL file is deleted on clean shutdown but persists if the container is killed (SIGKILL from `docker stop` after the 10s grace period, OOM kill, or crash). On next container start, DuckDB replays the WAL to recover uncommitted data. If the WAL file is missing (because the volume mount was only for the `.duckdb` file, not the directory), data loss occurs silently -- DuckDB opens without error but the last transactions are gone.

The existing `DuckDBRepo.__init__` in `app/repositories/duckdb_repo.py` creates the parent directory via `db_path.parent.mkdir(parents=True, exist_ok=True)` and connects to a file at `data/datavisor.duckdb` (from `config.py`). In Docker, this `data/` directory must be a volume mount, not just the `.duckdb` file.

**Why it happens:**
Developers volume-mount only the database file (`-v ./data/datavisor.duckdb:/app/data/datavisor.duckdb`) instead of the entire directory. The WAL and tmp files are created as siblings on the container filesystem (ephemeral layer) and vanish when the container restarts. DuckDB's official documentation states: "If DuckDB exits normally, the WAL file is deleted upon exit. If DuckDB crashes, the WAL file is required to recover data."

Additionally, Docker's default stop signal is SIGTERM with a 10-second timeout before SIGKILL. If FastAPI's shutdown handler (the `lifespan` context manager's cleanup in `app/main.py`) takes longer than 10 seconds -- possible during a large ingestion with thumbnail generation -- the container is killed before `db.close()` runs, leaving the WAL behind.

**Prevention:**
1. Volume-mount the entire `data/` directory, never individual files: `volumes: ["./data:/app/data"]`
2. Add a `STOPSIGNAL SIGTERM` to the Dockerfile and set `stop_grace_period: 30s` in docker-compose.yml to give the lifespan handler time to close DuckDB cleanly
3. Add an explicit `CHECKPOINT` call in the lifespan shutdown before `db.close()` to flush the WAL to the database file: `self.connection.execute("CHECKPOINT")`
4. Ensure the container user has write permission to the entire mounted directory, not just the `.duckdb` file
5. Set `checkpoint_threshold` via `PRAGMA checkpoint_threshold='8MB'` to checkpoint more frequently (default is 16MB), reducing WAL size and recovery window

**Warning signs:**
- Data disappears after `docker-compose restart` but not after `docker-compose down && docker-compose up`
- A `.wal` file appears in the data directory after `docker stop` but is missing after `docker start`
- `docker logs` shows DuckDB opening successfully but with fewer rows than expected

**Phase to address:** Docker containerization (Phase 1 of v1.1)

**Confidence:** HIGH -- verified against DuckDB official documentation on [files created by DuckDB](https://duckdb.org/docs/stable/operations_manual/footprint_of_duckdb/files_created_by_duckdb) and [WAL recovery behavior](https://duckdb.org/docs/stable/connect/concurrency). WAL lock file issue confirmed in [DuckDB Issue #10002](https://github.com/duckdb/duckdb/issues/10002).

---

### Pitfall 2: Qdrant Local Mode Cannot Run in Docker -- Must Migrate to Server Mode

**Severity:** CRITICAL
**Affects:** Docker containerization, Qdrant integration

**What goes wrong:**
The current codebase uses Qdrant in **local embedded mode**: `QdrantClient(path=str(path))` in `app/services/similarity_service.py`. This runs Qdrant as an in-process Python library with on-disk persistence at `data/qdrant/`. In Docker, you need Qdrant as a separate container service (server mode) because: (a) the embedded Qdrant client does not support concurrent access, which matters when multiple uvicorn workers run, (b) it adds ~500MB to the FastAPI container image, and (c) Qdrant's Docker image (`qdrant/qdrant`) is the canonical deployment path and provides proper health checks, metrics, and persistence.

Switching from `QdrantClient(path=...)` to `QdrantClient(host="qdrant", port=6333)` is a one-line code change, but the data migration is not. The local-mode on-disk format is not compatible with the server-mode storage. All existing embeddings synced to Qdrant must be re-synced from DuckDB after the migration.

**Why it happens:**
Local mode is the recommended development path ("useful for development, prototyping and testing") and the existing code was designed for single-process local execution. Developers assume the migration is just changing the constructor, but forget about: (a) data format incompatibility, (b) network connectivity in docker-compose, (c) the need for an API key for security, and (d) health check dependencies (FastAPI should wait for Qdrant to be healthy before starting).

**Prevention:**
1. In `docker-compose.yml`, add Qdrant as a service with a volume for persistence:
   ```yaml
   qdrant:
     image: qdrant/qdrant:latest
     volumes: ["./data/qdrant_server:/qdrant/storage"]
     ports: ["6333:6333"]
   ```
2. Update `SimilarityService.__init__` to accept either `path` (local) or `url` (server) based on environment:
   ```python
   if qdrant_url:
       self.client = QdrantClient(url=qdrant_url)
   else:
       self.client = QdrantClient(path=str(path))
   ```
3. Add `DATAVISOR_QDRANT_URL` environment variable to `config.py` Settings class (default None for local dev)
4. Add a `depends_on` with health check in docker-compose so FastAPI waits for Qdrant:
   ```yaml
   depends_on:
     qdrant:
       condition: service_healthy
   ```
5. On first Docker startup, the `ensure_collection` + `_sync_from_duckdb` flow in `SimilarityService` already handles syncing -- but verify it works when the collection is empty in a fresh Qdrant server

**Warning signs:**
- `ConnectionRefusedError` on FastAPI startup because Qdrant container is not yet ready
- Similarity search returns empty results in Docker but works locally
- FastAPI container image is 8GB+ because it bundles the Qdrant Rust binaries via qdrant-client's local mode

**Phase to address:** Docker containerization (Phase 1 of v1.1)

**Confidence:** HIGH -- verified against [Qdrant quickstart docs](https://qdrant.tech/documentation/quickstart/) and [qdrant-client README](https://github.com/qdrant/qdrant-client) which explicitly states "If you require concurrent access to local mode, you should use Qdrant server instead."

---

### Pitfall 3: NEXT_PUBLIC_API_URL Baked at Build Time, Not Configurable at Runtime

**Severity:** CRITICAL
**Affects:** Docker containerization, deployment flexibility

**What goes wrong:**
The frontend's API base URL is set in `frontend/src/lib/constants.ts`:
```typescript
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
```

`NEXT_PUBLIC_` environment variables are **inlined into the JavaScript bundle at `next build` time**. They are string-replaced in the compiled JS -- there is no runtime resolution. If you build the Docker image with `NEXT_PUBLIC_API_URL=http://localhost:8000` (or leave it unset), the compiled JS will contain the literal string `"http://localhost:8000"`. When you deploy to a GCP VM at `http://35.202.x.x:8000`, the frontend still calls `localhost:8000`, which fails because the browser is on the user's machine, not the VM.

**Why it happens:**
Next.js explicitly documents this: "Public environment variables will be inlined into the JavaScript bundle during `next build`." Developers either: (a) hardcode the URL and rebuild per environment, (b) set it at build time and forget it cannot change, or (c) try to set it in `docker run -e` and discover it has no effect.

**Prevention:**
1. **Option A (simplest for this project):** Use a reverse proxy (nginx/caddy) that serves both frontend and API from the same origin, eliminating the need for a separate API URL. Frontend calls `/api/...` which the proxy routes to the FastAPI backend. No CORS issues, no URL configuration.
2. **Option B:** Use Next.js `publicRuntimeConfig` with `getServerSideProps` to inject the API URL at request time. But this forces SSR for every page.
3. **Option C:** Use the `next-runtime-env` library to read environment variables at runtime via a thin server-side injection.
4. **Option D:** Pass the API URL via a `<script>` tag injected into `_document.tsx` at container startup (entrypoint script replaces a placeholder in the built HTML).

**Recommendation:** Option A is strongly preferred. A single-origin setup via reverse proxy eliminates CORS entirely and makes basic auth work seamlessly (see Pitfall 4). The existing `allow_origins=["*"]` in `app/main.py` can then be tightened.

**Warning signs:**
- Frontend works in local dev but shows "Failed to fetch" errors when deployed to GCP VM
- Browser console shows requests to `http://localhost:8000` even though the app is accessed via a public IP
- Setting `NEXT_PUBLIC_API_URL` in `docker run -e` has no effect

**Phase to address:** Docker containerization (Phase 1 of v1.1)

**Confidence:** HIGH -- verified against [Next.js environment variables documentation](https://nextjs.org/docs/pages/guides/environment-variables) and [multiple GitHub discussions](https://github.com/vercel/next.js/discussions/17641) confirming this is a build-time-only mechanism.

---

### Pitfall 4: Basic Auth Over HTTP Sends Credentials in Cleartext

**Severity:** CRITICAL
**Affects:** Authentication, GCP VM deployment

**What goes wrong:**
HTTP Basic Authentication encodes credentials as `base64(username:password)` in the `Authorization` header. Base64 is encoding, not encryption. Without HTTPS, every request sends the password in cleartext over the network. On a GCP VM accessed over the public internet, anyone on the network path (ISP, coffee shop WiFi, GCP internal routing) can intercept the credentials. This is not a theoretical risk -- it is trivially exploitable with tools like Wireshark or `tcpdump`.

Additionally, the existing SSE streams (ingestion progress, embedding progress, VLM progress) use the browser's native `EventSource` API, which **cannot set custom HTTP headers**. The `EventSource` constructor only supports `withCredentials: true` (for cookies) -- not `Authorization` headers. This means SSE endpoints either: (a) must use cookie-based auth instead of header-based auth, (b) must accept a token in the URL query string, or (c) must use a polyfill like `event-source-plus` or `@microsoft/fetch-event-source` that uses `fetch` under the hood.

**Why it happens:**
"Single-user basic auth" sounds simple, but the interaction between HTTP Basic Auth, HTTPS requirements, SSE limitations, and CORS creates a surprisingly complex surface. Developers implement basic auth on the API, test in the browser (which shows a native auth dialog), confirm it works, then deploy to HTTP and do not realize the credentials are exposed. The SSE issue is discovered only when progress streams break after adding auth middleware.

**Prevention:**
1. **HTTPS is mandatory.** Use one of:
   - Caddy as a reverse proxy (automatic HTTPS via Let's Encrypt, zero configuration for a domain)
   - nginx with certbot
   - GCP load balancer with managed SSL certificate (overkill for single-user)
2. **For SSE + auth:** Use a session cookie set by a login endpoint rather than per-request Basic Auth headers. The flow: POST `/auth/login` with credentials -> server sets `HttpOnly, Secure, SameSite=Strict` cookie -> all subsequent requests (including `EventSource`) include the cookie automatically
3. **If using reverse proxy (recommended from Pitfall 3):** Caddy/nginx can handle basic auth at the proxy layer, before requests reach FastAPI. This means zero auth code in FastAPI and SSE streams work without modification.
4. **Never put credentials in URL query strings** -- they end up in server logs, browser history, and proxy logs

**Warning signs:**
- SSE streams break after adding `Depends(verify_auth)` to endpoints because `EventSource` does not send the `Authorization` header
- Browser shows the native Basic Auth dialog on every page load (no session persistence)
- Penetration test flags "credentials transmitted over unencrypted channel"

**Phase to address:** Docker containerization / deployment (Phase 1 of v1.1)

**Confidence:** HIGH -- EventSource header limitation verified against [MDN EventSource docs](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials) and [WHATWG HTML spec issue #2177](https://github.com/whatwg/html/issues/2177).

---

### Pitfall 5: SVG-to-Canvas Coordinate System Mismatch When Adding Interactive Annotation Editing

**Severity:** CRITICAL
**Affects:** Annotation editing feature

**What goes wrong:**
The current annotation overlay in `frontend/src/components/grid/annotation-overlay.tsx` uses SVG with a `viewBox` matching the original image dimensions (`viewBox="0 0 ${imageWidth} ${imageHeight}"`). Annotation coordinates are in **original pixel space** and the SVG `preserveAspectRatio` handles all scaling automatically. This is elegant and correct for read-only display.

For interactive editing (move, resize, delete bounding boxes), you need to switch to react-konva (Canvas-based) because SVG does not have built-in drag handles, transform controls, or efficient hit testing. But react-konva's coordinate system works differently:

1. **Konva uses Stage/Layer coordinates**, not viewBox. There is no equivalent of SVG's `preserveAspectRatio="xMidYMid meet"`. You must manually compute the scale factor between the displayed image size and the original image dimensions.
2. **Konva's Transformer modifies `scaleX`/`scaleY`, not `width`/`height`**. After a resize, the shape's `width()` is unchanged but `scaleX()` is 2.0. If you save `width()` to the database without multiplying by `scaleX()`, the annotation silently shrinks back to its original size.
3. **Zoom and pan change the coordinate space.** If the user zooms in on an image, pointer events return coordinates in the zoomed space. Converting back to original pixel space requires `stage.getPointerPosition()` -> divide by stage scale -> subtract stage offset. Getting this wrong means annotations drift from their intended positions when zoomed.
4. **The current system stores absolute pixel coordinates** (`bbox_x`, `bbox_y`, `bbox_w`, `bbox_h` in `annotations` table). Mutations must write back in the same coordinate space, not in display-space or stage-space.

**Why it happens:**
SVG handles coordinate transforms transparently; Canvas does not. Developers who have only worked with SVG overlays underestimate the manual coordinate math required by Canvas. The Transformer tool's scale-vs-dimension behavior is a [well-documented source of confusion](https://longviewcoder.com/2022/04/28/what-the-hell-did-the-transformer-actually-do-to-my-shape/) in the Konva community.

**Prevention:**
1. **Compute a single scale factor** when the image loads:
   ```typescript
   const scale = Math.min(
     containerWidth / imageWidth,
     containerHeight / imageHeight
   );
   ```
   Store this in component state. All coordinate conversions go through it.
2. **In `onTransformEnd`, always normalize scale back to 1:**
   ```typescript
   const node = shapeRef.current;
   const sx = node.scaleX(), sy = node.scaleY();
   node.scaleX(1); node.scaleY(1);
   const newW = node.width() * sx;
   const newH = node.height() * sy;
   // Convert display coords to original pixel space
   const bboxX = node.x() / scale;
   const bboxW = newW / scale;
   ```
3. **Set `boundBoxFunc` on the Transformer** to prevent annotations from being dragged outside the image bounds
4. **In `onDragEnd`, convert position back to pixel space** before persisting
5. **Keep the SVG overlay for read-only contexts** (grid thumbnails, non-edit modal). Only use Konva in the edit modal. This limits the migration surface.
6. **Write a `toPixelSpace(displayCoords, scale)` and `toDisplaySpace(pixelCoords, scale)` utility** and use it everywhere. Never do ad-hoc coordinate math.

**Warning signs:**
- Annotations appear in the correct position but after save-and-reload they are offset by a fixed amount
- Annotations "jump" when the user starts dragging (because initial position was in wrong coordinate space)
- Resizing an annotation and saving causes it to shrink or grow unexpectedly
- Annotations drift when the user zooms in/out during editing

**Phase to address:** Annotation editing (Phase 3 of v1.1)

**Confidence:** HIGH -- Transformer scale behavior verified against [Konva official Transformer docs](https://konvajs.org/docs/react/Transformer.html) and [Konva Issue #830](https://github.com/konvajs/konva/issues/830) on coordinate changes with zoom. The [Konva Issue #1296](https://github.com/konvajs/konva/issues/1296) confirms bounding box calculation issues with stroke and scale.

---

## Major Pitfalls

Mistakes that cause significant rework, broken features, or deployment delays.

### Pitfall 6: Docker Image Bloat from PyTorch + Transformers (8-12GB)

**Severity:** MAJOR
**Affects:** Docker containerization, deployment speed

**What goes wrong:**
The current `pyproject.toml` includes `torch>=2.10.0` and `transformers>=5.1.0` as direct dependencies. A naive `pip install` of these in a Docker image results in:
- PyTorch with CUDA support: ~2.5GB
- Transformers library: ~500MB
- Combined with Python, DuckDB, Pillow, scikit-learn, etc.: **8-12GB total image**

This makes `docker pull` take 10+ minutes on a GCP VM, `docker build` takes 20+ minutes, and disk usage on the VM is excessive.

Python 3.14 adds a complication: as of the project's `requires-python = ">=3.14"`, the official `python:3.14-slim` images are available on Docker Hub, but some ML packages may not have pre-built wheels for 3.14 yet, forcing source compilation and further increasing build time.

**Why it happens:**
ML dependencies are massive. PyTorch bundles CUDA libraries by default even if you only need CPU inference. The `transformers` library pulls in many transitive dependencies. Developers build the image once, accept the size, and only discover the problem when CI/CD pipelines time out or GCP VM disk fills up.

**Prevention:**
1. **Use CPU-only PyTorch** for the Docker image unless GPU inference is needed in Docker:
   ```dockerfile
   RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
   ```
   This reduces PyTorch from ~2.5GB to ~200MB.
2. **Multi-stage build:** Build dependencies in a `builder` stage, copy only site-packages and the app to a slim runtime stage:
   ```dockerfile
   FROM python:3.14-slim AS builder
   RUN pip install --no-cache-dir --target=/deps ...
   FROM python:3.14-slim AS runtime
   COPY --from=builder /deps /usr/local/lib/python3.14/site-packages
   ```
3. **Use `--no-cache-dir` everywhere** to avoid pip cache bloating the image
4. **Pin exact versions** to avoid pulling unnecessary updates during builds
5. **For GPU support on GCP VMs:** Use NVIDIA Container Toolkit and mount the host GPU at runtime rather than bundling CUDA in the image
6. **Consider MPS is NOT available in Docker on macOS** -- the DINOv2 embedding and Moondream2 VLM services will fall back to CPU. The `_detect_device()` function in `config.py` will return "cpu" in Docker.

**Warning signs:**
- `docker build` takes 30+ minutes
- GCP VM disk fills up after a few image pulls
- `docker push` to registry takes 20+ minutes

**Phase to address:** Docker containerization (Phase 1 of v1.1)

**Confidence:** HIGH -- verified against [PyTorch Docker optimization guide](https://mveg.es/posts/optimizing-pytorch-docker-images-cut-size-by-60percent/) and [Docker Hub Python 3.14 images](https://hub.docker.com/_/python).

---

### Pitfall 7: DuckDB Annotation Mutations Without Transactions Cause Inconsistent State

**Severity:** MAJOR
**Affects:** Annotation editing, error triage workflow

**What goes wrong:**
The annotation editing feature will introduce **write mutations** to the `annotations` table (UPDATE for move/resize, DELETE for remove). The error triage workflow will also mutate data (adding tags, changing error classifications). The current codebase is **read-heavy with append-only writes** -- ingestion inserts in bulk, predictions insert in bulk, and all reads use cursors. There are no UPDATE operations anywhere in the existing code.

Adding per-annotation UPDATEs introduces new failure modes:
1. **No primary key enforcement.** The DuckDB schema in `duckdb_repo.py` explicitly avoids PRIMARY KEY constraints ("No PRIMARY KEY or FOREIGN KEY constraints are used -- this yields ~3.8x faster bulk inserts"). This means UPDATE must use composite WHERE clauses (`WHERE id = ? AND dataset_id = ?`), and there is no unique constraint to prevent duplicate annotation IDs.
2. **Cursor-per-request writes may conflict.** The existing `get_cursor` dependency yields a cursor from the single connection. Two concurrent annotation edits from the same user (e.g., rapid-fire drag operations) create two cursors both attempting writes. DuckDB uses optimistic concurrency control -- the second write may fail with a transaction conflict if both touch the same row.
3. **Annotation count denormalization.** The `datasets` table stores `annotation_count`. Deleting an annotation must update this counter. If the DELETE succeeds but the UPDATE to `datasets` fails (or the user's connection drops mid-request), the count drifts.

**Why it happens:**
Append-only systems do not need transactions or unique constraints. The v1.0 architecture was correctly designed for its workload (bulk ingestion + reads). v1.1 changes the workload to include interactive single-row mutations, which is a fundamentally different access pattern.

**Prevention:**
1. **Add annotation IDs as unique identifiers.** While not enforcing a PRIMARY KEY (to preserve bulk insert performance), verify annotation ID uniqueness in application code before UPDATE.
2. **Wrap mutation operations in explicit transactions:**
   ```python
   cursor = db.connection.cursor()
   try:
       cursor.begin()
       cursor.execute("UPDATE annotations SET bbox_x=?, bbox_y=?, bbox_w=?, bbox_h=? WHERE id=? AND dataset_id=?", [...])
       cursor.execute("UPDATE datasets SET annotation_count = (SELECT COUNT(*) FROM annotations WHERE dataset_id=?) WHERE id=?", [...])
       cursor.commit()
   except Exception:
       cursor.rollback()
       raise
   finally:
       cursor.close()
   ```
3. **Debounce annotation mutations on the frontend.** Do not send a PATCH request on every mouse move during drag. Send one PATCH on `onDragEnd` / `onTransformEnd`.
4. **Consider adding a `modified_at` timestamp column** to annotations for conflict detection (optimistic locking).
5. **Recompute denormalized counts** from source tables rather than incrementing/decrementing (avoids drift).

**Warning signs:**
- Annotation count in the sidebar does not match the actual number of annotations after edits
- Rapid annotation edits occasionally fail with "Transaction conflict" errors
- Deleted annotations reappear after page refresh (DELETE executed on cursor but transaction not committed)

**Phase to address:** Annotation editing (Phase 3 of v1.1)

**Confidence:** HIGH -- verified against existing schema in `duckdb_repo.py` and DuckDB's [concurrency documentation](https://duckdb.org/docs/stable/connect/concurrency) on optimistic concurrency control.

---

### Pitfall 8: Smart Folder Structure Detection Has Unbounded Edge Cases

**Severity:** MAJOR
**Affects:** Smart dataset ingestion UI

**What goes wrong:**
The smart ingestion feature must auto-detect dataset folder structures. Real-world CV datasets use dozens of conventions:

**Standard COCO:**
```
dataset/
  annotations/
    instances_train2017.json
    instances_val2017.json
  train2017/
  val2017/
```

**Standard YOLO:**
```
dataset/
  images/
    train/
    val/
  labels/
    train/
    val/
  data.yaml
```

**Roboflow exports:**
```
dataset/
  train/
    images/
    labels/
  valid/
    images/
    labels/
  test/
    images/
    labels/
  data.yaml
```

**FiftyOne exports, CVAT exports, custom layouts** all differ further. The detection heuristic must handle: (a) split names in folder names (`train`, `training`, `trn`, `val`, `valid`, `validation`, `test`, `testing`), (b) splits at different directory levels (top-level vs. inside images/), (c) missing splits (no test set), (d) annotation files at different levels, (e) symlinks to shared image directories, (f) datasets with NO split structure (flat single folder).

The dangerous edge case: a dataset with folder names that coincidentally match split names (e.g., a `train/` directory that contains images of trains, not training data).

**Why it happens:**
There is no standard. Every annotation tool exports differently. Every ML team has their own conventions. Developers implement detection for the 3 formats they have seen and discover the other 20 in user bug reports.

**Prevention:**
1. **Detection is a suggestion, not an action.** Show the detected structure to the user and let them confirm/correct before ingestion. Never auto-ingest without confirmation.
2. **Use a scoring/confidence system.** Score each candidate split detection by:
   - Presence of known annotation files (`.json`, `.yaml`, `.xml`, `.txt`)
   - Image file ratio (a real split directory has mostly images)
   - Naming conventions (weighted: `train` > `trn`)
   - Sibling directory patterns (if `train/` and `val/` exist as siblings, confidence is higher)
3. **Support manual override.** If detection fails, let the user manually specify: "This folder is train, this folder is val, this file is the annotation file."
4. **Start with COCO only (since v1.0 only parses COCO).** Detect COCO-style structures first. The existing `COCOParser` expects a single annotation JSON and a single image directory. Smart ingestion for v1.1 should: find `.json` files that look like COCO, find image directories, let the user map them.
5. **Ignore symlinks on first pass.** Following symlinks can cause infinite loops and unexpected cross-filesystem traversal. Use `os.walk(followlinks=False)` or `Path.iterdir()` (which does not follow symlinks by default).
6. **Set a directory scan depth limit** (e.g., max 3 levels deep) to avoid accidentally scanning a mounted filesystem root.

**Warning signs:**
- Auto-detection picks the wrong directory as "training images"
- A dataset with subdirectories organized by class (ImageNet-style) is misinterpreted as split-based
- User reports that "the ingestion imported my test images as training images"

**Phase to address:** Smart ingestion (Phase 2 of v1.1)

**Confidence:** MEDIUM -- based on analysis of common dataset formats from [YOLO dataset structure](https://github.com/ultralytics/ultralytics/blob/main/docs/en/datasets/detect/index.md) and COCO convention documentation. Edge cases are experiential knowledge.

---

### Pitfall 9: GCP Firewall Rules Block All Ports by Default

**Severity:** MAJOR
**Affects:** GCP VM deployment

**What goes wrong:**
GCP Compute Engine has a **default-deny inbound** firewall policy. When you create a VM and run `docker-compose up`, the services bind to their ports inside the VM, but no external traffic can reach them. The developer SSHs into the VM, runs `curl localhost:3000` and sees the frontend. They open `http://35.202.x.x:3000` in their browser -- connection timeout. They spend 30 minutes debugging Docker port mapping before realizing it is a GCP firewall issue.

Even after creating a firewall rule for port 3000 (frontend) and 8000 (API), developers forget: (a) Qdrant port 6333 should NOT be exposed publicly (internal only), (b) the DuckDB file is accessible via the API, so exposing port 8000 without auth is equivalent to exposing the database, (c) firewall rules apply to all VMs with the matching network tag -- accidentally broad rules expose other VMs.

**Why it happens:**
AWS opens ports 22/80/443 in common security groups. GCP's default is more restrictive -- only SSH (port 22), ICMP, and RDP (port 3389) are allowed by default via the `default-allow-ssh` and `default-allow-icmp` rules. Developers familiar with AWS muscle-memory expect ports to be open.

**Prevention:**
1. **Deployment script must create firewall rules automatically:**
   ```bash
   gcloud compute firewall-rules create datavisor-web \
     --allow tcp:80,tcp:443 \
     --target-tags datavisor \
     --source-ranges 0.0.0.0/0
   ```
2. **Use a reverse proxy (Caddy/nginx) on port 80/443 only.** Never expose port 8000 (FastAPI) or 3000 (Next.js dev) directly. All traffic goes through the proxy.
3. **Do NOT expose Qdrant port 6333 externally.** It should only be accessible within the docker-compose network. In docker-compose.yml, do not publish the port:
   ```yaml
   qdrant:
     expose: ["6333"]  # internal only, no 'ports:' mapping
   ```
4. **Tag the VM** with a specific network tag and scope firewall rules to that tag
5. **Document the firewall rules** in the deployment script README -- this is the #1 support question for GCP deployments

**Warning signs:**
- "Connection timed out" when accessing the VM's public IP
- Services work fine via SSH tunnel but not via direct access
- Qdrant dashboard is accidentally accessible from the internet

**Phase to address:** GCP deployment (Phase 1 of v1.1)

**Confidence:** HIGH -- verified against [GCP firewall documentation](https://cloud.google.com/compute/docs/networking/firewalls) and common deployment patterns.

---

### Pitfall 10: Error Triage State Not Persisted -- Lost on Page Refresh

**Severity:** MAJOR
**Affects:** Error triage workflow

**What goes wrong:**
The error triage workflow involves the user reviewing error samples and tagging them (FP, TP, FN, confirmed mistake, etc.). If this triage state lives only in the frontend Zustand store (like the current `filter-store.ts` and `ui-store.ts`), all triage progress is lost when the user refreshes the page, navigates away, or the browser crashes.

A 100K-image dataset with 5000 error detections requires significant manual review time. Losing 30 minutes of triage work because of a page refresh makes the feature unusable.

**Why it happens:**
The v1.0 architecture stores transient UI state in Zustand and persistent data in DuckDB. Developers add triage state to Zustand for speed (no API call on each tag) and plan to "persist later," but the persistence never gets built or gets deferred because it requires a new API endpoint + DuckDB schema change.

**Prevention:**
1. **Persist triage decisions to DuckDB immediately.** Add a `triage_status` column to the `annotations` table (or a separate `triage_decisions` table) and PATCH on each tag action.
2. **Debounce but persist.** Debounce the API call by 500ms to batch rapid changes, but always persist before the user moves to the next image.
3. **Use optimistic updates:** Update the Zustand store immediately (for snappy UI), then persist to DuckDB in the background. If the persist fails, show a non-blocking error and retry.
4. **Add the `tags` column on `samples` table (already exists in the schema as `VARCHAR[]`)** for sample-level triage tags. For annotation-level triage, add a new column or use the existing `metadata` JSON column on annotations.
5. **Consider using the existing saved views system** to persist triage filter state (which errors are visible, what filters are applied).

**Warning signs:**
- User tags 50 error samples, refreshes, all tags are gone
- Triage progress is not visible to the same user in a different browser tab
- "Save triage" button exists but is easy to forget

**Phase to address:** Error triage workflow (Phase 4 of v1.1)

**Confidence:** HIGH -- based on analysis of existing Zustand stores in the codebase, which are all transient. The `samples.tags` column exists for persistence.

---

## Moderate Pitfalls

Mistakes that cause delays, degraded UX, or technical debt.

### Pitfall 11: Docker Compose File Mounts Break Image Path Resolution

**Severity:** MODERATE
**Affects:** Docker containerization, image serving

**What goes wrong:**
The current `StorageBackend` in `app/repositories/storage.py` resolves local image paths with `Path(path).resolve()`. During ingestion, the user provides an image directory like `/Users/ortizeg/datasets/coco/images/`. This absolute host path is stored in the `datasets.image_dir` column and used to serve images.

In Docker, this host path does not exist inside the container. The container filesystem has a different root. Even with a volume mount (`-v /Users/ortizeg/datasets:/data/datasets`), the stored path (`/Users/ortizeg/datasets/coco/images/`) does not match the container path (`/data/datasets/coco/images/`).

**Why it happens:**
The v1.0 system was designed for local execution where host paths and process paths are identical. Docker introduces a path namespace boundary. The DuckDB database remembers absolute host paths from ingestion, which become invalid inside the container.

**Prevention:**
1. **Store relative paths in DuckDB, not absolute paths.** During ingestion, strip the base dataset directory and store only the relative portion. The base directory is configured at runtime via environment variable.
2. **Alternatively, use a canonical mount point.** Require datasets to be mounted at a fixed container path (e.g., `/data/datasets/`) and store paths relative to that root.
3. **For existing datasets (v1.0 migration):** Provide a path remapping configuration:
   ```yaml
   # docker-compose.yml
   environment:
     DATAVISOR_PATH_REMAP: "/Users/ortizeg/datasets:/data/datasets"
   ```
4. **Update `StorageBackend.resolve_image_path()`** to apply the path remap before resolution.
5. **Test image serving in Docker immediately** after the first successful build -- this will break early.

**Warning signs:**
- Thumbnails show broken image icons in Docker but work locally
- `FileNotFoundError` in logs for paths that exist on the host but not in the container
- Ingesting a dataset inside Docker works, but datasets ingested before dockerization cannot serve images

**Phase to address:** Docker containerization (Phase 1 of v1.1)

**Confidence:** HIGH -- verified by reading the existing `storage.py` code which uses `Path(path).resolve()` and the `datasets.image_dir` column which stores absolute paths.

---

### Pitfall 12: Keyboard Shortcuts Conflict with Browser and Input Field Defaults

**Severity:** MODERATE
**Affects:** Keyboard shortcuts feature

**What goes wrong:**
Common keyboard shortcut choices conflict with browser defaults or text input:
- `Delete` / `Backspace`: Navigates back in Firefox; deletes text in input fields
- `Space`: Scrolls the page; toggles checkboxes
- Arrow keys: Scroll the page; move cursor in text inputs
- `Ctrl+A`: Select all (browser default)
- `Ctrl+Z`: Browser undo in text fields
- `Escape`: Closes the detail modal (already implemented); also closes browser dialogs

If shortcuts are registered globally (`document.addEventListener('keydown', ...)`), they fire even when the user is typing in the search input (`search-input.tsx`), the saved view name input, or the annotation label field (if editing annotations). Pressing `Delete` to clear a search term instead deletes the selected annotation.

**Why it happens:**
Developers test shortcuts with no focus on input elements. The shortcut handler does not check `document.activeElement` or `event.target.tagName`. Global event listeners are the easiest to implement but the hardest to get right.

**Prevention:**
1. **Check focus before handling.** In the keydown handler:
   ```typescript
   const tag = (e.target as HTMLElement).tagName;
   if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
   if ((e.target as HTMLElement).isContentEditable) return;
   ```
2. **Use a shortcut library** like `react-hotkeys-hook` that handles focus scoping automatically.
3. **Scope shortcuts to specific components.** Navigation shortcuts (arrow keys for next/prev image) should only work when the grid or modal is focused, not globally.
4. **Avoid single-key shortcuts** that conflict with browser defaults. Use modifier keys for destructive actions: `Shift+Delete` to delete annotation, not just `Delete`.
5. **Show a shortcut overlay** (triggered by `?` key) that lists available shortcuts -- this also serves as documentation.

**Warning signs:**
- User cannot type the letter "d" in the search box because it triggers "delete annotation"
- Arrow keys scroll the page instead of navigating images
- `Escape` closes both the annotation editor and the modal simultaneously

**Phase to address:** Keyboard shortcuts (Phase 5 of v1.1)

**Confidence:** HIGH -- standard web development pattern, verified against current codebase which has the `search-input.tsx` component and `<dialog>` elements that consume keyboard events.

---

### Pitfall 13: CORS Configuration Must Change from Wildcard to Specific Origin in Production

**Severity:** MODERATE
**Affects:** Authentication, deployment

**What goes wrong:**
The current `app/main.py` has:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for dev -- will restrict later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Per the CORS specification, `allow_origins=["*"]` and `allow_credentials=True` is **invalid**. Browsers reject this combination -- you cannot use wildcards with credentials. When basic auth is added (which sends credentials), the browser will block all cross-origin requests.

Even if you switch to `allow_origins=["http://35.202.x.x:3000"]`, you must update this value for every deployment. This is fragile.

**Why it happens:**
The wildcard was intentional for development (the comment says "will restrict later"). But the interaction between `allow_credentials=True` and `allow_origins=["*"]` is a spec violation that browsers enforce silently -- the request fails with a cryptic CORS error in the console.

**Prevention:**
1. **Use a reverse proxy (repeated from Pitfalls 3 and 4).** If frontend and API share the same origin, CORS is not needed at all. Remove the CORS middleware entirely.
2. **If CORS is needed:** Set `allow_origins` from an environment variable:
   ```python
   origins = settings.allowed_origins.split(",") if settings.allowed_origins else ["http://localhost:3000"]
   ```
3. **Never combine `allow_origins=["*"]` with `allow_credentials=True`.** The spec forbids it.
4. **Test CORS from a real browser** (not curl/httpx which do not enforce CORS). Open the browser console and check for CORS errors.

**Warning signs:**
- API calls work from curl but fail from the browser with "CORS policy" errors
- Adding basic auth breaks all frontend requests
- The error says `Access-Control-Allow-Origin` must not be `*` when credentials are included

**Phase to address:** Docker containerization / auth (Phase 1 of v1.1)

**Confidence:** HIGH -- verified against [FastAPI CORS documentation](https://fastapi.tiangolo.com/tutorial/cors/) and the CORS specification.

---

### Pitfall 14: GCP Persistent Disk Not Mounted on VM Restart

**Severity:** MODERATE
**Affects:** GCP VM deployment

**What goes wrong:**
The deployment script creates a GCP VM and attaches a persistent disk for data storage. Docker volumes point to a directory on this disk. But if the VM restarts (maintenance event, preemptible VM, manual restart), the persistent disk may not auto-mount. The VM comes back up, Docker starts, but the volume mount points to an empty directory. DuckDB creates a new empty database, Qdrant creates empty collections, and the user thinks their data is gone.

**Why it happens:**
Attaching a disk to a GCP VM does not auto-mount it. You must: (a) format the disk (first time), (b) create a mount point, (c) mount it, and (d) add an entry to `/etc/fstab` for persistence across reboots. Developers do steps (a)-(c) manually during setup and forget step (d). The VM restarts fine -- but the disk is attached, not mounted.

**Prevention:**
1. **Deployment script must add an fstab entry:**
   ```bash
   echo "UUID=$(blkid -s UUID -o value /dev/sdb) /mnt/data ext4 defaults,nofail 0 2" >> /etc/fstab
   ```
2. **Use `nofail` option** so the VM boots even if the disk mount fails (prevents boot loops)
3. **Add a health check** in the startup script that verifies the data directory is mounted before starting Docker:
   ```bash
   if ! mountpoint -q /mnt/data; then
     mount /dev/sdb /mnt/data || echo "FATAL: Data disk not mounted"
   fi
   ```
4. **Use GCP startup scripts** that run on every boot, not just first boot
5. **Prefer standard persistent disks** over local SSDs (which do NOT survive VM stop/start)

**Warning signs:**
- Data disappears after VM restart but returns after manual `mount` command
- `df -h` shows the data directory is on the root filesystem (small) instead of the persistent disk (large)
- Docker logs show DuckDB initializing a fresh schema on startup (because it created a new empty database file)

**Phase to address:** GCP deployment (Phase 1 of v1.1)

**Confidence:** HIGH -- standard GCP operational knowledge, verified against [GCP persistent disk documentation](https://cloud.google.com/compute/docs/disks/add-persistent-disk).

---

## Minor Pitfalls

Mistakes that cause annoyance or minor rework.

### Pitfall 15: Annotation Delete Without Undo Causes Data Loss Anxiety

**Severity:** MINOR
**Affects:** Annotation editing

**What goes wrong:**
The user accidentally deletes an annotation. There is no undo. The annotation is gone from DuckDB. The user must re-create it from scratch or re-ingest the dataset (losing all other edits). This makes users hesitant to use the editing feature.

**Prevention:**
1. **Soft delete first.** Add a `deleted_at` timestamp column. Mark annotations as deleted rather than removing them. Purge after 30 days or on explicit "purge deleted" action.
2. **Undo buffer.** Keep the last N deleted annotations in Zustand state. Show an "Undo" toast for 10 seconds after deletion. On undo, re-insert the annotation.
3. **At minimum:** Show a confirmation dialog for delete actions. "Delete this 'person' annotation? This cannot be undone."

**Phase to address:** Annotation editing (Phase 3 of v1.1)

**Confidence:** HIGH -- standard UX pattern.

---

### Pitfall 16: `docker-compose up` OOMs on Small GCP VMs with Embedding Model

**Severity:** MINOR
**Affects:** GCP deployment

**What goes wrong:**
The `EmbeddingService.load_model()` in `app/main.py`'s lifespan loads the DINOv2-base model at startup. On a GCP `e2-standard-2` (2 vCPU, 8GB RAM) running Docker (overhead: ~200MB), Qdrant (overhead: ~500MB), Next.js (overhead: ~200MB), and DINOv2 (overhead: ~1.5GB in CPU mode), total memory pressure approaches 4-5GB before any data is loaded. Loading a 100K-sample dataset into DuckDB can add another 1-2GB.

**Prevention:**
1. **Lazy model loading is partially implemented** (VLM is lazy, but EmbeddingService loads at startup). Make embedding model loading lazy too -- only load when the user triggers embedding generation.
2. **Document minimum VM specs:** Recommend `e2-standard-4` (4 vCPU, 16GB RAM) for comfortable operation, `e2-standard-2` (8GB) as absolute minimum.
3. **Add memory limits to docker-compose services** to prevent one service from OOM-killing others:
   ```yaml
   services:
     api:
       deploy:
         resources:
           limits:
             memory: 6G
     qdrant:
       deploy:
         resources:
           limits:
             memory: 2G
   ```

**Phase to address:** GCP deployment (Phase 1 of v1.1)

**Confidence:** MEDIUM -- memory estimates based on typical model sizes; actual numbers depend on the specific DINOv2 variant and batch size.

---

## Integration Pitfalls Matrix

How new v1.1 features interact with the existing v1.0 system.

| New Feature | Existing Component | Integration Risk | Specific Pitfall |
|---|---|---|---|
| Docker | DuckDB file | WAL file loss on unclean shutdown | P1: Must mount entire `data/` directory |
| Docker | Qdrant local mode | Cannot run embedded in multi-container setup | P2: Must migrate to server mode |
| Docker | Image path storage | Host absolute paths invalid in container | P11: Must use relative paths or path remapping |
| Docker | Next.js env vars | `NEXT_PUBLIC_API_URL` baked at build time | P3: Must use reverse proxy or runtime injection |
| Docker | PyTorch/Transformers | 8-12GB image size | P6: Use CPU-only torch, multi-stage build |
| Basic Auth | SSE streams | EventSource cannot set auth headers | P4: Must use cookie-based auth or fetch polyfill |
| Basic Auth | CORS middleware | Wildcard + credentials is spec-invalid | P13: Remove CORS via reverse proxy |
| Annotation Edit | SVG overlay | SVG coord system differs from Canvas | P5: Separate read-only (SVG) from edit (Konva) |
| Annotation Edit | DuckDB writes | No existing UPDATE pattern, no transactions | P7: Add explicit transactions for mutations |
| Annotation Edit | `annotations` table | No unique constraints | P7: Verify ID uniqueness in app code |
| Smart Ingestion | COCOParser | Expects single JSON + single image dir | P8: Must handle multi-split structures |
| Error Triage | Zustand stores | UI state lost on refresh | P10: Persist triage decisions to DuckDB |
| Keyboard Shortcuts | Search input | Global handlers capture input keystrokes | P12: Check activeElement before handling |
| GCP Deploy | Firewall | Default deny blocks all ports | P9: Script must create rules |
| GCP Deploy | Persistent disk | Disk not auto-mounted on restart | P14: Add fstab entry |
| GCP Deploy | Memory | Model loading exhausts small VM RAM | P16: Lazy loading, document minimum specs |

---

## Phase-Specific Warnings

Which pitfalls to address in which phase, and what to watch for.

| Phase | Pitfalls to Address | Critical Action | Verification |
|---|---|---|---|
| Docker + Deploy | P1, P2, P3, P4, P6, P9, P11, P13, P14, P16 | Use reverse proxy (Caddy), mount `data/` dir, migrate Qdrant to server mode | Access app from browser (not curl) via public IP; restart VM; verify data persists |
| Smart Ingestion | P8 | Detection is suggestion, not action; confirm before ingest | Test with 5+ dataset layouts including edge cases |
| Annotation Editing | P5, P7, P15 | Konva coordinate normalization; DuckDB transactions; soft delete | Edit annotation, save, refresh, verify position unchanged |
| Error Triage | P10 | Persist triage state to DuckDB, not just Zustand | Tag 10 errors, refresh page, verify tags persist |
| Keyboard Shortcuts | P12 | Check focus before handling; modifier keys for destructive actions | Type in search box with shortcuts enabled |

---

## "What Might I Have Missed?" Review

Areas of uncertainty that could not be fully verified:

1. **Python 3.14 + torch in Docker:** The `requires-python = ">=3.14"` constraint means the Docker image must use Python 3.14. While official Docker images exist (`python:3.14-slim`), not all ML packages have pre-built wheels for 3.14. Source compilation in Docker adds build time and image size. **Confidence: MEDIUM** -- wheels availability not verified for torch 2.10 on Python 3.14.

2. **DuckDB file locking across Docker volume backends:** Docker volume mounts use different storage drivers (overlay2, btrfs, devicemapper). DuckDB relies on POSIX file locking for WAL safety. NFS-backed volumes (common in Kubernetes, not typical for Compose) may not support file locking correctly. For standard Docker Compose with bind mounts on ext4/APFS, this should be fine. **Confidence: MEDIUM** -- not verified for all storage drivers.

3. **Konva performance with many annotation boxes:** The existing SVG overlay handles arbitrary annotation counts. If an image has 500+ annotations and all are rendered as Konva shapes with Transformers, canvas performance may degrade. **Confidence: LOW** -- not measured; Konva documentation claims good performance but does not specify limits for interactive Transformer usage.

4. **Qdrant data migration from local to server mode:** The exact steps to migrate existing data from the embedded SQLite-based Qdrant local mode to the Qdrant server's RocksDB-based storage are not documented. The existing `_sync_from_duckdb` method re-creates the collection from DuckDB embeddings, which is a workaround but means the first Docker startup must re-sync all embeddings. For 100K samples, this may take several minutes. **Confidence: MEDIUM** -- the code path exists but has not been tested at scale for this migration.

---

## Sources

### Official Documentation (HIGH confidence)
- [DuckDB Files Created](https://duckdb.org/docs/stable/operations_manual/footprint_of_duckdb/files_created_by_duckdb) -- WAL, lock files, tmp directory behavior
- [DuckDB Concurrency](https://duckdb.org/docs/stable/connect/concurrency) -- MVCC, optimistic concurrency, single-writer model
- [Qdrant Installation](https://qdrant.tech/documentation/guides/installation/) -- Docker deployment, server mode
- [qdrant-client README](https://github.com/qdrant/qdrant-client) -- local mode vs server mode migration
- [Konva Transformer Docs](https://konvajs.org/docs/react/Transformer.html) -- scale vs dimension behavior, normalization pattern
- [Next.js Environment Variables](https://nextjs.org/docs/pages/guides/environment-variables) -- NEXT_PUBLIC build-time inlining
- [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/) -- wildcard + credentials restriction
- [GCP Persistent Disks](https://cloud.google.com/compute/docs/disks/add-persistent-disk) -- mount, fstab, restart behavior
- [GCP Firewall Rules](https://cloud.google.com/compute/docs/networking/firewalls) -- default deny policy
- [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials) -- header limitations

### GitHub Issues (MEDIUM confidence)
- [DuckDB WAL Lock File Issue #10002](https://github.com/duckdb/duckdb/issues/10002) -- lock file not cleaned on forced close
- [DuckDB WAL Issue #10952](https://github.com/duckdb/duckdb/issues/10952) -- .wal stays open after parquet import
- [Konva Coordinate Issue #830](https://github.com/konvajs/konva/issues/830) -- dragging and zooming alter coordinates
- [Konva Transformer BBox Issue #1296](https://github.com/konvajs/konva/issues/1296) -- incorrect bounding box with stroke and scale
- [WHATWG EventSource Headers Issue #2177](https://github.com/whatwg/html/issues/2177) -- cannot set headers on EventSource
- [Next.js Docker Env Vars Discussion #17641](https://github.com/vercel/next.js/discussions/17641) -- NEXT_PUBLIC in Docker

### Community Sources (LOW-MEDIUM confidence)
- [Konva Transformer Explained](https://longviewcoder.com/2022/04/28/what-the-hell-did-the-transformer-actually-do-to-my-shape/) -- detailed walkthrough of Transformer behavior
- [Building Canvas Editors in React](https://www.alikaraki.me/blog/canvas-editors-konva) -- Konva patterns and gotchas
- [Next.js Runtime Env Vars](https://nemanjamitic.com/blog/2025-12-13-nextjs-runtime-environment-variables/) -- solutions for Docker runtime configuration
- [PyTorch Docker Optimization](https://mveg.es/posts/optimizing-pytorch-docker-images-cut-size-by-60percent/) -- 60% image size reduction strategies
- [Running Qdrant with Docker Compose](https://www.spasov.me/blog/running-qdrant-with-docker-compose-api-access-networking-and-api-keys) -- networking and API key configuration
- [Secure EventSource Authentication](https://openillumi.com/en/en-eventsource-auth-header-solution/) -- workarounds for SSE auth
- [FastAPI Security Best Practices](https://blog.greeden.me/en/2025/07/29/fastapi-security-best-practices-from-authentication-authorization-to-cors/) -- auth and CORS configuration

---
*Pitfalls research for: DataVisor v1.1 -- Docker deployment, auth, annotation editing, smart ingestion, error triage*
*Researched: 2026-02-12*
