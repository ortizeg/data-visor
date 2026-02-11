# Pitfalls Research

**Domain:** CV Dataset Introspection Tooling (VisionLens -- Voxel51 alternative)
**Researched:** 2026-02-10
**Confidence:** MEDIUM-HIGH (verified against official docs for DuckDB, Qdrant, deck.gl, UMAP; some areas LOW where noted)

---

## Critical Pitfalls

Mistakes that cause rewrites, project-killing delays, or fundamental architecture failures.

### Pitfall 1: DuckDB Concurrent Access Deadlocks Under FastAPI Async Workers

**Severity:** CRITICAL

**What goes wrong:**
FastAPI runs async request handlers across multiple threads/workers. DuckDB enforces a single-writer-multiple-reader model per process. When two FastAPI endpoints attempt simultaneous writes (e.g., ingestion running while a user saves a filter preset), the second writer gets a transaction conflict error: `"Transaction conflict: cannot update a table that has been altered!"`. Under load testing with tools like Locust, the entire FastAPI process can stop responding with no error output -- a silent deadlock.

**Why it happens:**
Developers treat DuckDB like PostgreSQL, creating per-request connections. DuckDB's official documentation states: "One process can both read and write to the database. Multiple processes can read from the database, but no processes can write." Within a single process, multiple threads can write using MVCC with optimistic concurrency control, but only through cursors from the same connection. Appends never conflict, but row-level updates from two threads trigger errors. Instantiating a new DuckDB connection per request is explicitly documented as problematic.

**How to avoid:**
- Maintain a single DuckDB connection at the application level (FastAPI lifespan event).
- Use `connection.cursor()` to create thread-local cursors for each request, not separate connections.
- Serialize write operations through an async queue or background task worker (e.g., FastAPI `BackgroundTasks` or a dedicated write thread).
- Keep reads on cursor-per-request and writes on a single serialized channel.
- For ingestion (bulk writes), use DuckDB's bulk COPY/INSERT which are optimized for this pattern -- "DuckDB is optimized for bulk operations, so executing many small transactions is not a primary design goal."

**Warning signs:**
- Intermittent 500 errors during concurrent operations that disappear under single-user testing.
- FastAPI process hangs under load with no logged error.
- Transaction conflict errors in logs during ingestion while users are browsing.

**Phase to address:**
Phase 1 (Foundation). The connection management pattern must be established before any endpoints are written. Retrofitting is painful because every endpoint touches the database.

**Confidence:** HIGH -- verified against DuckDB official concurrency docs and GitHub Discussion #13719.

---

### Pitfall 2: DuckDB-Qdrant Dual Database Consistency Drift

**Severity:** CRITICAL

**What goes wrong:**
Metadata lives in DuckDB; embeddings live in Qdrant. When a user deletes images, re-ingests a dataset, or updates labels, both databases must be updated atomically. But Qdrant provides eventual consistency -- "if you ingest your data you can expect eventual consistency of it but it's not guaranteed at any level." DuckDB provides ACID guarantees. Result: a delete succeeds in DuckDB but the Qdrant point persists (or vice versa), causing ghost points in the embedding map that reference non-existent images, or images in the grid that have no embedding and crash the scatter plot.

**Why it happens:**
There is no distributed transaction coordinator between an embedded analytical DB and a vector DB. Developers implement the "happy path" (write to both) and never handle partial failures. The consistency models are fundamentally different: DuckDB is strongly consistent; Qdrant is eventually consistent.

**How to avoid:**
- Establish a canonical source of truth: DuckDB is the authority for "what exists." Qdrant is a derived index.
- Every mutation goes through a service layer that writes to DuckDB first, then Qdrant. If Qdrant write fails, log it for retry rather than rolling back DuckDB.
- Implement a reconciliation job: periodically compare DuckDB sample IDs against Qdrant point IDs and clean up orphans.
- Use Qdrant's `wait=true` parameter on upserts when strong consistency is needed (trades latency for consistency).
- Store the DuckDB sample ID as the Qdrant point ID (UUID or integer) so cross-referencing is trivial.
- Never query Qdrant for "what samples exist" -- always query DuckDB and then look up embeddings by known IDs.

**Warning signs:**
- Embedding map shows points that produce 404 when clicked.
- Grid count and embedding map point count diverge after deletions.
- Similarity search returns results for images that were deleted.

**Phase to address:**
Phase 1 (Foundation). The dual-write service layer and ID strategy must be designed before any data is persisted. Changing ID schemes later requires full re-ingestion.

**Confidence:** HIGH -- verified against DuckDB concurrency docs and Qdrant collection docs.

---

### Pitfall 3: WebGL Context Loss in deck.gl Embedding Visualization

**Severity:** CRITICAL

**What goes wrong:**
When the user has been browsing for a while, or the embedding map renders a large number of points with large radii, the browser's GPU runs out of memory and fires a `webglcontextlost` event. The embedding scatter plot goes black. deck.gl's official guidance: "Once the context is lost, there is no way to 'restore' the purged WebGL resources." The user must reload the page, losing all filter state.

**Why it happens:**
WebGL is a shared GPU resource. Chrome caps contiguous allocations at ~1GB. A ScatterplotLayer with 100K points is well within deck.gl's comfort zone (1M+ points at 60FPS), but combined with hover thumbnails, image grid rendering, and other browser tab GPU usage, memory pressure accumulates. The real danger is not initial render but accumulated state: reloading data, switching between datasets, or zooming into dense clusters that trigger high fragment shader load (a 10M-point scatter with 5px radius = ~1 billion fragment invocations).

**How to avoid:**
- Listen for the `webglcontextlost` event and display a user-friendly "GPU memory exceeded -- click to reload visualization" message instead of a black canvas.
- Implement deck.gl instance re-creation on `webglcontextrestored` (requires destroying and rebuilding the Deck instance).
- Limit point radius at low zoom levels to reduce fragment shader load.
- Disable `useDevicePixels` on high-DPI screens (4x pixel reduction).
- Use deck.gl's picking limit awareness: max 16M items per layer for picking.
- When switching datasets, explicitly destroy the previous Deck instance and release GPU buffers before creating a new one.
- Persist filter state in URL params or session storage so page reload does not lose context.

**Warning signs:**
- Increasing frame drops when zooming into dense embedding clusters.
- Browser tab memory climbing steadily during session.
- Black canvas with no error in console (context loss fires as an event, not an exception).

**Phase to address:**
Phase 2 (Embedding Visualization). Must be addressed when deck.gl is first integrated, not deferred.

**Confidence:** HIGH -- verified against deck.gl performance docs and GitHub Discussion #7841 / Issue #5398.

---

### Pitfall 4: Large COCO JSON Files Blow Up Memory During Ingestion

**Severity:** CRITICAL

**What goes wrong:**
A COCO annotation file for a 100K+ image dataset with dense bounding boxes can easily be 500MB-1GB. Python's `json.load()` on a 500MB file consumes 2-4GB of RAM and takes 30+ seconds. If you load the entire file into a dict and then iterate, you spike memory to 4-8GB during the transform step. On a 16GB dev machine with a GPU model loaded, this causes OOM kills.

**Why it happens:**
The COCO format stores all annotations in a single monolithic JSON file with `images`, `annotations`, and `categories` arrays. The `annotations` array for 100K images with 5+ boxes each contains 500K+ annotation objects. Developers use `json.load()` because it is the obvious approach and it works on small test datasets.

**How to avoid:**
- Use `ijson` (streaming JSON parser) to parse COCO files incrementally. Read `categories` first (small), then stream `images` and `annotations` in chunks.
- Build a lookup dict for `image_id -> annotations` incrementally rather than loading all annotations into memory.
- Process in batches: parse 1000 images worth of annotations, insert into DuckDB, release memory, repeat.
- For YOLO format (one .txt per image), this is not an issue -- but implement a unified streaming interface so the ingestion pipeline handles both patterns.
- Set a configurable `batch_size` on the ingestion pipeline. Default to 1000 images per batch.
- Profile memory during ingestion of your largest expected dataset EARLY -- do not wait until integration testing.

**Warning signs:**
- Ingestion works fine on 1K-image test sets but crashes or freezes on real 100K+ datasets.
- Python process memory spikes to 4GB+ during ingestion.
- OOM killer terminates the FastAPI process mid-ingestion.

**Phase to address:**
Phase 1 (Ingestion). The streaming parser must be the default path from the start. Retrofitting streaming into a `json.load()`-based parser requires rewriting the entire ingestion pipeline.

**Confidence:** HIGH -- verified against Python JSON streaming benchmarks (99.4% memory reduction with streaming).

---

### Pitfall 5: UMAP Compute Time Makes Interactive Exploration Impractical

**Severity:** CRITICAL

**What goes wrong:**
Running UMAP on 100K 512-dimensional image embeddings takes 5-15 minutes on CPU. t-SNE takes 45+ minutes. If the user imports a dataset and expects to see the embedding map, they face a multi-minute wait with no progress indicator. Worse: if they change parameters (n_neighbors, min_dist) or add new images, the entire UMAP must re-run. The tool feels broken for its core use case.

**Why it happens:**
UMAP's time complexity is approximately O(N^1.14) for construction of the fuzzy simplicial set and optimization. At 100K samples, this is substantial. Developers prototype with 1K samples where UMAP runs in seconds, then discover the scaling wall. The incremental update story is also weak: standard UMAP's `.transform()` can project new points into an existing embedding, but "the overall distribution in your higher-dimensional vectors [must] be consistent between training and testing data." When it isn't, you need Parametric UMAP with neural network training, adding significant complexity.

**How to avoid:**
- Pre-compute UMAP embeddings during ingestion as a background task. Store 2D coordinates in DuckDB alongside the sample metadata. The user sees the map immediately on next visit.
- Show a clear progress bar during embedding computation. Use UMAP's `verbose=True` and stream epoch progress to the frontend via WebSocket.
- Cache UMAP results keyed by (dataset_id, embedding_model, n_neighbors, min_dist). Only recompute when parameters change.
- For incremental updates (new images added), use UMAP's `.transform()` method to project new points into the existing space without re-fitting. This is fast (~335ms for test sets) but requires the original fitted model to be serialized and stored.
- Consider offering PCA as a fast fallback (seconds on 100K) for initial exploration, with UMAP as an async upgrade.
- Use `umap.UMAP(low_memory=True)` for datasets approaching memory limits.

**Warning signs:**
- Embedding page shows a spinner for minutes with no progress feedback.
- Users click away before UMAP completes, triggering wasted compute.
- "Recompute embeddings" button triggers a full refit when only 100 new images were added.

**Phase to address:**
Phase 2 (Embedding Visualization). The background compute + caching pattern is foundational to the embedding experience.

**Confidence:** HIGH -- verified against UMAP 0.5.8 official docs (transform method, parametric UMAP).

---

## Major Pitfalls

Mistakes that cause significant rework, degraded UX, or weeks of debugging.

### Pitfall 6: Qdrant Collection Schema Lock-In on Embedding Model Change

**Severity:** MAJOR

**What goes wrong:**
You create a Qdrant collection with 512-dimensional vectors (e.g., CLIP ViT-B/32). Later you want to switch to a better model with 768 dimensions (e.g., CLIP ViT-L/14). Qdrant collections have fixed vector dimensions -- "the vector of each point within the same collection must have the same dimensionality." You cannot ALTER the collection. You must create a new collection, re-embed all images, and migrate. For 100K images, re-embedding takes hours of GPU time.

**Why it happens:**
Vector databases enforce fixed-dimension collections for performance reasons (HNSW index optimization). Developers pick an embedding model early and do not plan for model upgrades. Qdrant explicitly does not support ALTER TABLE -- "it's a drop-and-recreate operation."

**How to avoid:**
- Use Qdrant's **named vectors** feature: create a collection with named vector fields (`{"clip_vit_b32": {...}, "clip_vit_l14": {...}}`). Each named vector can have independent dimensionality. This allows side-by-side embedding models without collection recreation.
- Store the embedding model name alongside the vector in Qdrant payloads. Version your embeddings.
- Design the embedding pipeline to be model-agnostic: accept any (model_name, dimension) pair and route to the correct named vector.
- Plan for migration: implement a background re-embedding job that can process images incrementally and populate a new named vector while the old one remains queryable.

**Warning signs:**
- Hardcoded `vector_size=512` in collection creation.
- No embedding model version stored in metadata.
- Desire to try a new embedding model triggers "we need to re-ingest everything" conversation.

**Phase to address:**
Phase 1 (Foundation). The Qdrant collection schema and named vector strategy must be decided before the first embedding is stored.

**Confidence:** HIGH -- verified against Qdrant official collection docs (named vectors, migration tool).

---

### Pitfall 7: Virtualized Image Grid Memory Leaks from Unreleased Blob URLs

**Severity:** MAJOR

**What goes wrong:**
The infinite-scroll grid creates thumbnails by fetching image data (from disk, GCS, or cache) and rendering them. If images are loaded as Blob URLs via `URL.createObjectURL()`, each URL holds a reference to the underlying binary data. As the user scrolls through 100K images, thousands of Blob URLs accumulate. Even though virtualization removes DOM elements, the Blob URLs persist in memory. Memory usage climbs from 200MB to 2GB+ during a single browsing session, eventually crashing the tab.

**Why it happens:**
Virtualization libraries (react-window, TanStack Virtual) unmount off-screen components but do not manage Blob URL lifecycle. Developers assume garbage collection handles cleanup. It does not: "Each time you call createObjectURL(), a new object URL is created, and each of these must be released by calling URL.revokeObjectURL()." Documented memory leaks in TanStack Virtual (Issue #196) show memory jumping to 143MB after scrolling just 2000 rows.

**How to avoid:**
- Call `URL.revokeObjectURL(url)` in the component's cleanup/unmount hook when the image leaves the viewport.
- Better yet: use a fixed-size LRU cache of Blob URLs (e.g., 500 entries). When the cache evicts an entry, revoke the URL. This bounds memory regardless of scroll distance.
- For GCS images, serve thumbnails via signed URLs with short expiry rather than downloading and creating Blob URLs. Let the browser's HTTP cache handle lifecycle.
- Use `<img src={url}>` with standard HTTP URLs where possible -- the browser manages memory for HTTP-cached images far better than for Blob URLs.
- Profile memory in Chrome DevTools during a scroll-through-all test early. Look for the "JS Heap" climbing linearly.

**Warning signs:**
- Chrome DevTools shows JS Heap growing linearly with scroll distance.
- Browser tab crashes after extended browsing sessions.
- "Aw, Snap!" errors on Chrome after viewing thousands of images.

**Phase to address:**
Phase 1 (Grid View). Must be designed into the image loading strategy from the start. Retrofitting Blob URL cleanup into an existing grid requires touching every image component.

**Confidence:** MEDIUM-HIGH -- verified against MDN Blob URL docs; TanStack Virtual Issue #196 confirms the pattern.

---

### Pitfall 8: Embedding Map <-> Grid View Filter Desynchronization

**Severity:** MAJOR

**What goes wrong:**
The user lasso-selects a cluster on the embedding map. The grid should filter to show only those images. But the filter state drifts: the grid shows 347 images while the embedding map highlights 352 points. Or the user applies a metadata filter in the sidebar, the grid updates, but the embedding map still shows all points. The tool feels untrustworthy -- the core value proposition (visual exploration) is undermined.

**Why it happens:**
Two independent visualization systems (deck.gl scatter plot, React virtualized grid) with separate data pipelines. Filter state lives in three places: URL params, React state, and server-side query results. Race conditions emerge when: (a) lasso selection sends IDs to the server while a metadata filter is still in-flight, (b) the grid paginates lazily so total count is estimated, (c) deck.gl's picking returns point indices that map to stale data after a re-sort.

**How to avoid:**
- Single source of truth for filter state: one Zustand/Jotai store that both the grid and the embedding map subscribe to. Never let either component maintain its own filter state.
- Filter pipeline: User action -> update store -> derive DuckDB query -> execute query -> return sample IDs -> both grid and map render from the same ID set.
- The embedding map does NOT query Qdrant for display -- it reads pre-computed 2D coordinates from DuckDB. Qdrant is only used for similarity search. This eliminates a cross-database consistency surface.
- For lasso selection: deck.gl returns point indices -> map to sample IDs via the data array -> set IDs in the filter store -> grid reads the same IDs.
- Debounce filter updates (200ms) to prevent rapid state thrashing during lasso drawing.
- Display the exact count in both views: "Showing 347 of 102,453 samples" must be identical in both the grid header and the embedding map legend.

**Warning signs:**
- Grid and embedding map show different counts for the same filter.
- Lasso selection sometimes includes/excludes edge points inconsistently.
- Applying a sidebar filter does not update the embedding map (or vice versa).
- Rapid filter changes cause the UI to flash between states.

**Phase to address:**
Phase 2 (Embedding Visualization + Filter Integration). The filter architecture must be designed when the embedding map is added, not bolted on later.

**Confidence:** MEDIUM -- based on common state management patterns; no specific prior art for this exact scenario was found.

---

### Pitfall 9: VLM Agent Hallucination and False Positive Recommendations

**Severity:** MAJOR

**What goes wrong:**
The Pydantic AI agent analyzes error distribution and recommends actions like "90% of False Negatives occur in low-light images." But the VLM (Moondream2) hallucinated: it described a well-lit image as "low-light" because of dark-colored objects. The agent confidently surfaces a pattern that does not exist. The user acts on it (augmenting training data with more low-light images), wasting time. Trust in the agentic workflow erodes permanently.

**Why it happens:**
Moondream2 is a 1.86B parameter model -- tiny by VLM standards. It is optimized for edge deployment, not for nuanced scene analysis. Its visual understanding has gaps, particularly for: lighting conditions, subtle occlusions, image quality assessment, and counting objects. The Pydantic AI agent trusts the VLM's structured output without calibration. LLM agents hallucinate with structured output just as readily as with free text -- the JSON schema constrains the format, not the accuracy.

**How to avoid:**
- Calibrate the VLM on a labeled validation set before deploying the agent. Measure precision/recall for each attribute the agent relies on (lighting, occlusion, blur, etc.). Document known failure modes.
- The agent must present findings as hypotheses, not facts: "Based on VLM analysis (73% agreement with manual review), the following pattern MAY exist..."
- Include a confidence score derived from VLM output consistency (run the same image through the VLM 3 times; report the agreement rate).
- Provide a "verify" workflow: when the agent identifies a pattern, show the user a sample of 10-20 images that triggered the pattern so they can spot-check.
- Set a minimum sample size for pattern detection. Do not surface "90% of X are Y" when N=10. Require N >= 50 for pattern claims.
- Use the agent for aggregation and statistics (which it does well) rather than per-image classification (which the VLM does poorly at the margins).

**Warning signs:**
- Agent recommendations change dramatically when re-run on the same dataset.
- The "pattern" the agent finds does not hold up when the user manually inspects flagged images.
- Users stop trusting agent recommendations after 2-3 false patterns.

**Phase to address:**
Phase 3 (VLM/Agent Integration). The calibration framework must be built alongside the agent, not after deployment.

**Confidence:** MEDIUM -- Moondream2 capabilities verified via HuggingFace model card; hallucination patterns based on general VLM literature, not Moondream2-specific benchmarks.

---

### Pitfall 10: GCS Image Serving Latency Destroys Grid Scroll Performance

**Severity:** MAJOR

**What goes wrong:**
Each image thumbnail requires a network round-trip to GCS. At ~80-150ms per request (depending on region), scrolling through a grid of 50 visible thumbnails means 50 sequential or parallel requests. Even with parallelization, loading 50 thumbnails takes 500ms-2s, causing visible pop-in and blank tiles during scrolling. The UX feels sluggish compared to local disk browsing, which is instant.

**Why it happens:**
Developers test with local images (instant) and add GCS support as a secondary path. The network latency is not felt until testing with real GCS-hosted datasets. GCS's built-in CDN caching only works for publicly accessible objects; private buckets (common for ML datasets) bypass the cache entirely.

**How to avoid:**
- Implement a local thumbnail cache: on first access, download and resize the image to thumbnail dimensions (e.g., 256x256), store the thumbnail locally, serve from local cache on subsequent views.
- Pre-generate thumbnails during ingestion as a background task. Store thumbnail paths in DuckDB alongside the full image path.
- Use GCS signed URLs with a backend proxy that handles authentication and adds `Cache-Control: max-age=3600` headers. This enables browser HTTP caching even for private buckets.
- Implement prefetching: when the user scrolls, prefetch thumbnails for the next 2-3 screens worth of images.
- Display a low-quality placeholder (colored rectangle matching the dominant color, or a tiny 8x8 blur-up) while the full thumbnail loads.
- Batch GCS requests using the JSON API's batch endpoint rather than individual object downloads.

**Warning signs:**
- Blank white tiles visible during scrolling with GCS-hosted datasets.
- Grid performance is fast with local datasets but noticeably laggy with GCS datasets.
- Network tab shows hundreds of sequential GCS requests during scroll.

**Phase to address:**
Phase 1 (Grid View + Ingestion). The thumbnail cache and prefetch strategy must be built alongside the image source abstraction.

**Confidence:** MEDIUM-HIGH -- verified against GCS caching docs; latency numbers based on typical GCS performance.

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or degraded functionality.

### Pitfall 11: Plugin System API Breakage Without Versioning Strategy

**Severity:** MODERATE

**What goes wrong:**
You ship a `BasePlugin` class with hooks like `on_ingest(sample)`, `on_transform(image)`, `on_ui_render(panel)`. Early adopters write plugins. Then you need to change the hook signatures to add a `context` parameter. All existing plugins break. Plugin authors are frustrated. You either maintain backward compatibility forever (accumulating cruft) or break plugins on every release (destroying trust).

**Why it happens:**
Plugin APIs are contracts with external developers. Internal refactoring does not break internal code (you update all call sites). But plugin authors cannot be updated by you. The API surface is frozen the moment the first external plugin is published. Developers underestimate how quickly this happens and how painful backward compatibility is.

**How to avoid:**
- Use `**kwargs` in all hook signatures from day one. Pass a context object rather than positional parameters: `on_ingest(self, *, context: IngestContext)` where `IngestContext` is a Pydantic model that can be extended without breaking existing plugins.
- Version the plugin API explicitly: `class BasePlugin(api_version=1)`. When you need breaking changes, create `api_version=2` and support both for at least one major release.
- Keep the initial plugin API minimal. Resist adding hooks for everything. Each hook is a compatibility surface. Start with 3-4 hooks and expand based on real usage.
- Write 3-4 example plugins yourself before releasing the API. This surfaces design flaws before external adoption.
- Adopt SemVer strictly for the plugin API. MAJOR bump = hook signature change.

**Warning signs:**
- Plugin hook signatures include more than 2-3 positional parameters.
- No explicit `api_version` field on `BasePlugin`.
- Desire to "just add one more parameter" to an existing hook.

**Phase to address:**
Phase 1 (Foundation). The plugin API contract must be designed carefully before any plugins are written. This is a "measure twice, cut once" decision.

**Confidence:** MEDIUM -- based on general plugin architecture patterns; Python-specific patterns verified against community guides.

---

### Pitfall 12: Annotation Format Edge Cases in YOLO and VOC Parsers

**Severity:** MODERATE

**What goes wrong:**
YOLO format: coordinates are normalized (0-1) relative to image dimensions. A label file contains `class_id x_center y_center width height`. Edge cases that crash parsers:
- Coordinates slightly outside [0, 1] due to floating point (e.g., `1.0000001`).
- Negative coordinates for boxes that extend beyond the image boundary.
- Empty `.txt` files for images with no annotations (valid, but parsers that expect at least one line crash).
- Class IDs that do not match the `classes.txt` / `data.yaml` mapping.
- Windows line endings (`\r\n`) in files created on different OS.

VOC format: XML files where `<object>` tags may be missing `<bndbox>` (object exists but is not localized). Or `<truncated>` and `<difficult>` flags that parsers ignore, losing metadata.

COCO format: `iscrowd` flag on annotations that use RLE-encoded segmentation instead of polygon format. Parsers expecting polygons crash on crowd annotations.

**Why it happens:**
Each format has real-world variations created by different annotation tools (CVAT, LabelImg, Roboflow, custom scripts). No dataset perfectly conforms to the spec. Developers test with clean, tool-generated examples and never encounter the edge cases that appear in production datasets.

**How to avoid:**
- Implement lenient parsing with strict validation: parse what you can, log warnings for anomalies, reject only truly corrupt data.
- Clamp YOLO coordinates to [0, 1] with a warning rather than crashing.
- Handle empty annotation files gracefully (image with zero annotations is valid).
- Strip `\r` from all line input before parsing.
- For COCO: check `iscrowd` flag and handle RLE segmentation separately or skip with a warning.
- Build a validation report during ingestion: "Parsed 102,453 images. 47 had out-of-bounds coordinates (clamped). 3 had missing class mappings (skipped). 12 had empty annotation files (treated as unannotated)."
- Test parsers against deliberately malformed datasets. Create a `test_fixtures/malformed/` directory with known edge cases.

**Warning signs:**
- Parser crashes on a real dataset that "should work."
- Annotation count from parser does not match expected count from the source.
- Silent data loss: images ingested but their annotations were silently dropped.

**Phase to address:**
Phase 1 (Ingestion). The parser robustness must be built and tested during initial ingestion development.

**Confidence:** HIGH -- COCO iscrowd/RLE is documented in the COCO dataset spec; YOLO edge cases are well-documented in community conversion tools.

---

### Pitfall 13: Moondream2 GPU Memory Contention with Embedding Generation

**Severity:** MODERATE

**What goes wrong:**
Both the VLM inference (Moondream2, 1.86B params) and embedding model (CLIP, ~400M params) need GPU memory. Moondream2 in fp16 requires ~3.7GB VRAM. CLIP ViT-L/14 requires ~1.6GB. Batch embedding generation with batch_size=32 adds ~2GB for intermediate activations. Total: ~7.3GB, which fits on an 8GB GPU only barely -- and fails if CUDA allocator fragmentation is high. Running both models simultaneously (VLM analyzing while embeddings are being generated) causes CUDA OOM.

**Why it happens:**
Developers test models individually and each fits comfortably. The combined memory footprint is not tested until integration. CUDA memory fragmentation means actual usable memory is less than total VRAM. "Large-batch inference remains memory-bound, with most GPU compute capabilities underutilized due to DRAM bandwidth saturation as the primary bottleneck."

**How to avoid:**
- Never run VLM inference and embedding generation simultaneously. Implement a GPU task queue that serializes GPU-bound work.
- Profile actual VRAM usage with both models loaded using `torch.cuda.memory_allocated()` and `torch.cuda.memory_reserved()`.
- Use dynamic batch sizing: start with batch_size=32, catch CUDA OOM, halve batch size, retry. Converge on the maximum safe batch size.
- Unload the embedding model before loading the VLM for inference (and vice versa). Use `model.cpu()` or `del model; torch.cuda.empty_cache()`.
- Support offloading to cloud GPU for heavy lifting while keeping the local GPU for interactive tasks.
- Consider quantized variants: Moondream2 in INT4 reduces VRAM to ~1GB, leaving room for CLIP.

**Warning signs:**
- CUDA OOM errors that appear only when running "full pipeline" but not individual components.
- GPU utilization looks low (30-40%) but VRAM is at 95% -- memory-bound, not compute-bound.
- Embedding generation slows dramatically when VLM is loaded in memory (even if not actively inferring).

**Phase to address:**
Phase 3 (VLM Integration). GPU memory management must be explicitly designed when the VLM is added alongside the existing embedding pipeline.

**Confidence:** MEDIUM -- Moondream2 model size verified via HuggingFace model card; combined memory analysis is estimated, not measured.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `json.load()` for COCO files | Simple, works on test data | OOM on 100K+ datasets, requires full rewrite to streaming | Never -- use `ijson` from the start |
| Hardcoded embedding dimension (512) | Simpler Qdrant setup | Cannot switch models without recreating collection; hours of re-embedding | Never -- use named vectors |
| Single global filter state as React useState | Quick prototyping | Race conditions, desync between grid and map, impossible to debug | MVP only -- migrate to Zustand by Phase 2 |
| Synchronous UMAP on the API thread | User sees result immediately | Blocks FastAPI worker for 5-15 min; timeouts, no progress feedback | Never -- always background task |
| Per-request DuckDB connections | Familiar PostgreSQL pattern | Silent deadlocks, transaction conflicts under load | Never -- use cursor-per-request from single connection |
| Storing full image paths in Qdrant payloads | Easy to query images from Qdrant | Data duplication with DuckDB; staleness when paths change; violates single-source-of-truth | Only if Qdrant is the sole DB (not applicable here) |
| No thumbnail pre-generation | Faster initial ingestion | 80-150ms latency per image on GCS; grid feels broken | MVP with local-only images -- must add for GCS |

## Integration Gotchas

Common mistakes when connecting the specific services in VisionLens.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| FastAPI + DuckDB | Creating new connection per request | Single app-level connection, `cursor()` per request |
| DuckDB + Qdrant | No reconciliation for partial write failures | DuckDB as source of truth; async Qdrant sync with retry |
| deck.gl + React state | Passing new data array on every render (triggers full GPU buffer rebuild) | Memoize data array; use `updateTriggers` for partial updates |
| UMAP + FastAPI | Running UMAP in the request handler | Background task with WebSocket progress updates |
| Moondream2 + CLIP | Loading both models into GPU simultaneously | GPU task queue; unload one before loading the other |
| GCS + Image Grid | Direct GCS signed URL per thumbnail | Local thumbnail cache; pre-generate during ingestion |
| Pydantic AI + VLM | Trusting VLM output as ground truth | Calibration set; present findings as hypotheses with confidence scores |
| Plugin hooks + Core API | Positional parameters in hook signatures | `**kwargs` + context objects; explicit API versioning |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Non-streaming COCO JSON parsing | Works fine on 10K images | Use `ijson` streaming parser | >50K images (~200MB+ JSON) |
| Full UMAP recompute on filter change | Acceptable at 1K samples | Pre-compute and cache; use `.transform()` for incremental | >10K samples (~30s+ compute) |
| All-points-visible on embedding map | Smooth at 10K points | Level-of-detail: aggregate distant points; reduce radius at zoom-out | >500K points (fragment shader bottleneck) |
| DuckDB full table scan for filtering | Fast at 10K rows | Create indexes on commonly filtered columns; use columnar predicates | >100K rows with complex filters |
| Blob URL per image without revocation | No visible issue at 100 images | LRU cache with `revokeObjectURL()` on eviction | >2000 images scrolled (memory climbs past 1GB) |
| Synchronous GCS downloads in grid render | Works locally, acceptable for 10 GCS images | Async fetch with thumbnail cache and prefetch | >50 visible GCS images (2s+ load time) |
| Single Qdrant collection for all embedding models | Works with one model | Named vectors per model; version payloads | When switching embedding models |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| GCS service account key committed to repo or embedded in frontend | Full bucket access exposure; data breach | Use Workload Identity Federation or service account impersonation; keys only in environment variables / secret manager |
| Plugin system executes arbitrary Python without sandboxing | Malicious plugin can read filesystem, exfiltrate data, delete DB | Run plugins in subprocess with restricted permissions; whitelist importable modules; review plugins before loading |
| Signed GCS URLs with long expiry (24h+) shared in browser history | URLs leaked via browser history grant temporary bucket access | Use short-lived signed URLs (15 min); refresh via backend proxy |
| DuckDB file readable by any local process | Other applications or scripts can read/modify dataset metadata | Set file permissions to owner-only (0600); consider encryption at rest for sensitive datasets |
| VLM prompt injection via annotation text | Malicious annotation labels could manipulate VLM agent behavior | Sanitize annotation text before including in VLM prompts; treat all dataset content as untrusted |

## UX Pitfalls

Common user experience mistakes in CV dataset introspection tools.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No progress feedback during ingestion of large datasets | User thinks the app is frozen; kills the process | Progress bar with samples/sec, ETA, and current stage (parsing, embedding, indexing) |
| Embedding map loads before UMAP completes -- empty canvas | User sees a blank page, assumes it is broken | Show "Computing embeddings..." with progress; offer PCA preview while UMAP runs |
| Annotation overlay colors conflict with image content | Cannot distinguish boxes from image regions | Deterministic color hashing is correct; additionally provide configurable opacity and outline-only mode |
| Grid shows raw image with no metadata until clicked | User cannot identify images without opening each one | Show filename, class distribution mini-bar, and annotation count on hover |
| Error messages expose stack traces | Confusing and unprofessional | User-facing error messages with "Details" expander for technical info |
| No way to undo filter operations | User gets lost in filter chains, cannot return to starting point | Filter history stack with breadcrumb trail; "Clear all filters" always visible |
| FiftyOne's known pain: 10+ minute load times on 145K samples | Users abandon the tool | Virtualize everything; lazy-load metadata; never load full dataset into memory |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **COCO Ingestion:** Often missing `iscrowd` RLE handling -- verify that RLE-encoded segmentation masks do not crash the parser
- [ ] **YOLO Ingestion:** Often missing empty file handling -- verify that images with no annotations (empty .txt) are ingested as unannotated, not skipped
- [ ] **Embedding Map:** Often missing WebGL context loss recovery -- verify that GPU memory exhaustion shows a user-friendly message and allows re-initialization
- [ ] **Grid Virtualization:** Often missing Blob URL cleanup -- verify that scrolling through 5000+ images does not cause memory to climb unboundedly
- [ ] **DuckDB Writes:** Often missing concurrent write serialization -- verify that two simultaneous write operations do not deadlock the process
- [ ] **Qdrant Sync:** Often missing orphan cleanup -- verify that deleting a dataset from DuckDB also removes all corresponding Qdrant points
- [ ] **UMAP Caching:** Often missing parameter-keyed invalidation -- verify that changing n_neighbors triggers recompute but re-opening the same dataset does not
- [ ] **Plugin Hooks:** Often missing error isolation -- verify that a crashing plugin does not take down the main application
- [ ] **GCS Integration:** Often missing authentication refresh -- verify that expired credentials trigger a re-auth flow, not a cryptic 403
- [ ] **VLM Agent:** Often missing minimum sample size -- verify that pattern claims are not made on fewer than 50 samples
- [ ] **Filter Sync:** Often missing bidirectional sync -- verify that lasso selection updates the grid AND sidebar metadata filters update the embedding map

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| DuckDB deadlocks | LOW | Restart FastAPI process; implement connection pooling fix; no data loss (ACID) |
| DuckDB-Qdrant drift | MEDIUM | Run reconciliation job to sync IDs; delete Qdrant orphans; re-embed missing points |
| WebGL context loss | LOW | Reload the page; if state was persisted in URL params, no work is lost |
| COCO OOM during ingestion | HIGH | Rewrite parser to use streaming; all ingested data from crashed run may need re-ingestion |
| UMAP blocking the API | MEDIUM | Kill the long-running request; move to background task; re-trigger UMAP computation |
| Qdrant schema lock-in | HIGH | Create new collection with named vectors; re-embed all images (hours of GPU time); migrate data |
| Blob URL memory leak | LOW | Implement LRU cache with revocation; user refreshes page for immediate relief |
| Filter desync | MEDIUM | Refactor to single filter store; requires touching all filter-consuming components |
| VLM false positives | LOW | Add calibration framework; recalibrate agent on labeled validation set |
| GCS latency | MEDIUM | Implement thumbnail cache layer; pre-generate during ingestion; existing datasets need thumbnail backfill |
| Plugin API breakage | HIGH | Version the API; maintain backward compatibility adapter; all existing plugins need review |
| Annotation edge cases | LOW | Add lenient parsing with warnings; re-ingest affected datasets to pick up previously dropped annotations |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| DuckDB concurrent access (P1) | Phase 1: Foundation | Load test with 10 concurrent requests; verify no transaction conflicts |
| Dual DB consistency (P2) | Phase 1: Foundation | Delete a dataset; verify DuckDB and Qdrant both clean; check for orphan points |
| Large JSON OOM (P4) | Phase 1: Ingestion | Ingest a 100K+ COCO dataset; monitor memory stays under 2GB |
| Annotation edge cases (P12) | Phase 1: Ingestion | Run parser against malformed test fixtures; verify lenient handling |
| Blob URL leaks (P7) | Phase 1: Grid View | Scroll through 5000 images; verify memory does not exceed 500MB |
| GCS latency (P10) | Phase 1: Image Sources | Browse a GCS dataset; verify thumbnail load < 200ms after cache warm |
| Plugin API stability (P11) | Phase 1: Plugin Architecture | Write 3 example plugins; evolve API once; verify plugins still work |
| WebGL context loss (P3) | Phase 2: Embedding Viz | Render 100K points; force context loss via DevTools; verify recovery |
| UMAP compute time (P5) | Phase 2: Embedding Viz | Run UMAP on 100K embeddings; verify background task + progress bar |
| Filter desync (P8) | Phase 2: Filter Integration | Apply filter; verify grid count = map count; lasso select; verify sync |
| Qdrant schema lock-in (P6) | Phase 1: Foundation (schema) / Phase 2 (migration tooling) | Switch embedding model; verify named vector migration works |
| GPU memory contention (P13) | Phase 3: VLM Integration | Run VLM + CLIP sequentially; verify no CUDA OOM |
| VLM hallucination (P9) | Phase 3: Agent Integration | Run agent on calibration set; verify false positive rate < 15% |

## Sources

### Official Documentation (HIGH confidence)
- [DuckDB Concurrency](https://duckdb.org/docs/stable/connect/concurrency) -- single writer model, MVCC, concurrent access patterns
- [DuckDB Multiple Python Threads](https://duckdb.org/docs/stable/guides/python/multiple_threads) -- cursor-per-thread pattern
- [Qdrant Collections](https://qdrant.tech/documentation/concepts/collections/) -- fixed dimensions, named vectors, migration
- [deck.gl Performance](https://deck.gl/docs/developer-guide/performance) -- 1M point limit, buffer regeneration, picking limits, DPI
- [UMAP Transform](https://umap-learn.readthedocs.io/en/latest/transform.html) -- incremental projection, distribution consistency requirement
- [UMAP Parametric](https://umap-learn.readthedocs.io/en/latest/transform_landmarked_pumap.html) -- neural network approach for incremental updates
- [GCS Caching](https://cloud.google.com/storage/docs/caching) -- Cache-Control, CDN behavior, private bucket limitations
- [WebGL Context Loss](https://www.khronos.org/webgl/wiki/HandlingContextLost) -- recovery protocol, event handling
- [MDN Blob URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob) -- revokeObjectURL, memory management

### GitHub Issues and Discussions (MEDIUM confidence)
- [DuckDB + FastAPI Discussion #13719](https://github.com/duckdb/duckdb/discussions/13719) -- in-memory DuckDB concurrency with FastAPI
- [deck.gl Context Loss Discussion #7841](https://github.com/visgl/deck.gl/discussions/7841) -- restoring Deck after context loss
- [deck.gl Context Loss Issue #5398](https://github.com/visgl/deck.gl/issues/5398) -- basic handling of context lost event
- [TanStack Virtual Memory Leak Issue #196](https://github.com/TanStack/virtual/issues/196) -- memory leak with virtualization
- [FiftyOne Performance Issue #1740](https://github.com/voxel51/fiftyone/issues/1740) -- large dataset performance (145K+ samples)
- [FiftyOne Memory Issue #675](https://github.com/voxel51/fiftyone/issues/675) -- memory issues with large datasets
- [Qdrant Embedding Change Discussion #3797](https://github.com/orgs/qdrant/discussions/3797) -- best way to change embeddings

### Community and Research (LOW-MEDIUM confidence)
- [Moondream2 HuggingFace Model Card](https://huggingface.co/vikhyatk/moondream2) -- 1.86B params, edge deployment focus
- [Python JSON Streaming](https://pythonspeed.com/articles/json-memory-streaming/) -- ijson, 99.4% memory reduction on 500MB files
- [GPU Memory Management for LLMs](https://www.runpod.io/articles/guides/gpu-memory-management-for-large-language-models-optimization-strategies-for-production-deployment) -- VRAM bottlenecks, batch sizing

---
*Pitfalls research for: VisionLens -- CV Dataset Introspection Tooling*
*Researched: 2026-02-10*
