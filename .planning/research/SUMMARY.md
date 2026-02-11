# Project Research Summary

**Project:** VisionLens (CV Dataset Introspection Tool)
**Domain:** Computer Vision Dataset Exploration and Model Debugging
**Researched:** 2026-02-10
**Confidence:** HIGH

## Executive Summary

VisionLens is a FiftyOne alternative focused on dataset introspection and model debugging for CV engineers. Research across 100+ sources reveals a clear architecture: **dual-database system (DuckDB for analytical metadata + Qdrant for vector similarity) with a FastAPI backend serving a Next.js frontend**. This architecture delivers 10-100x performance over FiftyOne's MongoDB for analytical queries while enabling embedding visualization at 1M+ points (vs FiftyOne's ~50K Plotly limit).

The recommended approach prioritizes the **browse-filter-compare feedback loop** as the core value proposition. Phase 1 establishes the data foundation and basic browsing; Phase 2 adds embedding visualization with deck.gl; Phase 3 layers on AI agents for pattern detection. The stack is validated as production-ready: FastAPI 0.128.7, DuckDB 1.4.4, Qdrant 1.16.0, Next.js 16, deck.gl 9.2.6, Pydantic AI 1.58.0. Every choice is verified against official documentation and actively maintained.

The critical risks are **DuckDB concurrent access deadlocks** (requires single connection with cursor-per-request), **dual-database consistency drift** (requires service layer with DuckDB as source of truth), and **WebGL context loss** (requires recovery handler). These must be addressed in Phase 1 foundation — retrofitting is painful. With proper architecture patterns, the project can handle 100K+ image datasets at production quality.

## Key Findings

### Recommended Stack

The user's proposed stack (FastAPI + DuckDB + Qdrant + Next.js + Tailwind + deck.gl + Pydantic AI) is **validated as excellent**. Stack research confirmed each choice against alternatives and identified critical gaps.

**Core technologies:**
- **FastAPI 0.128.7**: Python API framework with async-native Pydantic v2 integration, automatic OpenAPI docs. The standard for data-intensive Python APIs.
- **DuckDB 1.4.4**: In-process columnar analytical database, 10-100x faster than SQLite on GROUP BY/aggregations, Parquet/Arrow native. Perfect for 100K+ sample metadata.
- **Qdrant 1.16.0**: Rust-based vector DB with payload filtering during HNSW search. Handles 100K+ embeddings locally via Docker with GPU-accelerated indexing.
- **Next.js 16**: React framework with Turbopack (5x faster builds), App Router stable, React 19 support. De facto standard for modern data UIs.
- **deck.gl 9.2.6**: WebGL2 scatterplot visualization rendering 1M+ points at 60 FPS with lasso selection. Vastly superior to FiftyOne's Plotly at scale.
- **Pydantic AI 1.58.0**: V1-stable agent framework with type-safe structured output, tool registration, model-agnostic. Lean alternative to LangChain.

**Critical gaps filled:**
- **supervision 0.27.0**: Annotation format parsing (COCO/YOLO/VOC). Saves weeks of custom parser development.
- **umap-learn 0.5.11** + **scikit-learn**: Dimensionality reduction for embedding visualization. UMAP handles 100K samples; t-SNE is fallback.
- **@tanstack/react-virtual**: Virtualized grid scrolling for 100K+ images. Critical for grid performance.
- **react-konva**: Canvas-based bounding box overlay rendering. Neither deck.gl nor vanilla HTML handles annotation overlays.
- **zustand**: Lightweight state management for cross-filtering between grid and map. Single source of truth for selection state.

### Expected Features

Feature research validated VisionLens positioning via competitive analysis of FiftyOne, CVAT, Label Studio, Roboflow, Supervisely, Encord Active.

**Must have (table stakes):**
- Multi-format ingestion (COCO/YOLO/VOC) — every serious CV tool supports these
- Virtualized image grid with infinite scroll — FiftyOne, Roboflow, CVAT all have this
- Annotation overlay rendering (bounding boxes) — core visual verification workflow
- GT vs Predictions comparison toggle — central model debugging use case
- Sidebar metadata filtering (dynamic on any field) — users expect to slice datasets arbitrarily
- Dataset statistics (class distribution, counts) — basic dataset understanding

**Should have (competitive differentiators):**
- **deck.gl embedding visualization** — handles 1M+ points vs FiftyOne's ~50K Plotly limit
- **Lasso selection -> grid filtering** — FiftyOne has this, but VisionLens will be faster at scale
- **Error categorization (Hard FP, Label Error, FN)** — more opinionated than FiftyOne's generic scores
- **AI agent pattern detection** — NO competitor does this. Novel value proposition.
- **Free GCS support** — FiftyOne gates cloud storage behind Enterprise pricing
- **Plugin/hook system** — FiftyOne has this; essential for extensibility

**Defer (v2+):**
- Full annotation editor — anti-feature. Export to CVAT/Label Studio instead.
- Video annotation — multiplies complexity enormously, defer until image workflow is proven
- AI-driven quality metrics (25+ like Encord) — diminishing returns, start with core error metrics
- Similarity search — requires Qdrant integration working first

### Architecture Approach

VisionLens follows a **layered monolith** pattern: FastAPI backend coordinates two specialized databases (DuckDB for metadata, Qdrant for vectors), serving a rich Next.js SPA frontend.

**Major components:**
1. **Query Coordinator Service** — Routes queries to DuckDB (metadata/analytical) or Qdrant (vector similarity), joins results via sample_id. Handles hybrid queries like "find images similar to X with confidence < 0.5".
2. **Dual-Database Foundation** — DuckDB is source of truth for "what exists"; Qdrant is a derived index. Every mutation writes to DuckDB first, then Qdrant. Reconciliation job cleans orphans.
3. **Zustand Cross-Filtering** — Shared client state enables lasso selection on embedding map to filter grid view (and vice versa) without tight coupling between components.
4. **Pluggable Ingestion Parsers** — BaseParser abstract class with COCO/YOLO/VOC implementations. Format auto-detection. Plugin system can register custom parsers.
5. **Thumbnail Cache & Proxy** — FastAPI endpoint generates and caches resized images. Critical for 100K+ grids (50-100x bandwidth reduction vs full images).

**Critical patterns validated:**
- **Single DuckDB connection, cursor-per-request** — DuckDB is single-writer; per-request connections cause deadlocks
- **Streaming COCO JSON ingestion** — json.load() OOMs on 500MB+ COCO files; use ijson for 99.4% memory reduction
- **Async UMAP with progress** — UMAP takes 5-15 min on 100K samples; must be background task with WebSocket progress
- **WebGL context loss recovery** — deck.gl contexts can be lost; must detect and allow re-initialization

### Critical Pitfalls

Research identified 13 pitfalls; top 5 are critical:

1. **DuckDB Concurrent Access Deadlocks** — FastAPI async workers + DuckDB single-writer = silent deadlocks. MUST use single connection at app level with `.cursor()` per request. FastAPI auto-threadpools sync endpoints. This is foundational; retrofit is painful.

2. **DuckDB-Qdrant Consistency Drift** — Metadata in DuckDB, embeddings in Qdrant. No distributed transaction coordinator. Deletions can succeed in one DB but fail in the other, creating ghost points. MUST establish DuckDB as source of truth, write DuckDB first, implement reconciliation job.

3. **WebGL Context Loss** — 100K point scatter + hover thumbnails + other GPU usage = GPU OOM. Context goes black with no error. MUST listen for `webglcontextlost` event, show recovery UI, persist filter state in URL params.

4. **Large COCO JSON OOM** — 100K+ image COCO files are 500MB-1GB. json.load() consumes 2-4GB RAM. MUST use ijson streaming parser from day one. Retrofitting requires rewriting entire ingestion pipeline.

5. **UMAP Compute Time** — 100K samples = 5-15 min on CPU. Synchronous execution blocks FastAPI, feels broken. MUST use background task with progress bar, cache results keyed by (dataset_id, model, params), offer PCA as fast fallback.

**Additional major pitfalls:**
- Qdrant collection schema lock-in (use named vectors per embedding model from start)
- Virtualized grid Blob URL memory leaks (revoke URLs via LRU cache)
- Embedding map <-> grid filter desync (single Zustand store as source of truth)
- VLM agent hallucination (calibrate Moondream2, present findings as hypotheses with confidence)
- GCS image serving latency (thumbnail cache + prefetch + pre-generation during ingestion)

## Implications for Roadmap

Based on research, **6 phases** are recommended with clear dependency structure.

### Phase 1: Foundation & Core Browsing
**Rationale:** Establishes data foundation and basic browse workflow. Every other phase depends on this. Architecture patterns (DuckDB connection management, dual-DB strategy, streaming ingestion) MUST be correct here — retrofit is extremely painful.

**Delivers:** Ingest COCO datasets, browse 100K+ images in virtualized grid, view annotations, filter by metadata.

**Features from FEATURES.md:**
- Multi-format ingestion (COCO first, YOLO/VOC as plugins)
- DuckDB metadata storage
- Virtualized image grid view
- Annotation overlay rendering (bounding boxes)
- Deterministic class-to-color mapping
- Sample detail modal
- Sidebar metadata filtering
- Basic search and sort
- Local + GCS image sources (storage abstraction)
- Plugin/hook system (BasePlugin class, hook registry)

**Avoids pitfalls:**
- P1: DuckDB concurrent access (single connection + cursor-per-request)
- P2: Dual-DB consistency (DuckDB as source of truth, service layer)
- P4: Large COCO OOM (ijson streaming parser)
- P7: Blob URL leaks (LRU cache with revoke)
- P10: GCS latency (thumbnail cache + pre-generation)
- P11: Plugin API breakage (versioned API, context objects with **kwargs)
- P12: Annotation format edge cases (lenient parsing with validation report)

**Research flag:** SKIP — well-documented patterns. FastAPI, DuckDB, streaming JSON, virtualized grids are established.

### Phase 2: Predictions & Model Debugging
**Rationale:** Depends on Phase 1 foundation. Adds the core model debugging workflow (GT vs Predictions comparison). Completes the browse-filter-compare loop that is the central value prop.

**Delivers:** Import predictions, toggle GT vs Predictions overlays (solid vs dashed), evaluation pipeline (TP/FP/FN), error categorization.

**Features from FEATURES.md:**
- Import predictions from models
- GT vs Predictions comparison toggle (the differentiator vs FiftyOne)
- Evaluation pipeline (IoU-based TP/FP/FN matching)
- Error categorization (Hard FP, Label Error, FN)
- Tag management (flag samples for review)

**Uses stack:**
- DuckDB for storing predictions as annotations with source="prediction"
- react-konva for dual-layer overlays (GT solid, pred dashed)
- Deterministic color hashing from Phase 1

**Research flag:** SKIP — evaluation pipeline patterns are well-documented (IoU matching, TP/FP/FN assignment from COCO metrics).

### Phase 3: Embedding Visualization
**Rationale:** Parallel to Phase 2 (independent). Adds the deck.gl scatter plot that is the second major differentiator (1M+ points vs FiftyOne's 50K Plotly limit). Requires Qdrant integration.

**Delivers:** UMAP/t-SNE embedding computation, deck.gl scatter plot, lasso selection -> grid filtering, hover thumbnails.

**Features from FEATURES.md:**
- Embedding generation (UMAP/t-SNE from CLIP/DINOv2)
- deck.gl embedding scatter plot (ScatterplotLayer)
- Lasso selection -> grid filtering (cross-view interaction)
- Hover thumbnails on embedding points
- Qdrant vector storage (for similarity search in Phase 4)

**Uses stack:**
- Qdrant 1.16.0 (local Docker, named vectors)
- sentence-transformers (CLIP/DINOv2 batch embedding)
- umap-learn + scikit-learn (dimensionality reduction)
- deck.gl 9.2.6 (WebGL scatter with lasso selection)
- Zustand cross-filtering (lasso -> filter store -> grid update)

**Avoids pitfalls:**
- P3: WebGL context loss (recovery handler, persist state)
- P5: UMAP compute time (background task, progress bar, caching)
- P6: Qdrant schema lock-in (named vectors from start)
- P8: Filter desync (Zustand single source of truth)

**Research flag:** SKIP — deck.gl, UMAP, Qdrant are well-documented. WebGL context loss recovery is documented in deck.gl.

### Phase 4: Similarity Search (Hybrid Queries)
**Rationale:** Depends on Phase 3 (Qdrant + embeddings). Completes the Query Coordinator pattern with hybrid DuckDB + Qdrant queries.

**Delivers:** "Find similar" action, hybrid queries (similarity + metadata filters), Qdrant payload filtering.

**Features from FEATURES.md:**
- Similarity search (find images like this one)
- Hybrid queries coordinated across DuckDB + Qdrant

**Implements architecture:**
- Query Coordinator Service (routing logic for metadata-only, similarity-only, hybrid)
- Qdrant payload filtering for simple filters
- DuckDB post-filter for complex analytical queries

**Research flag:** SKIP — Qdrant payload filtering is documented. Hybrid query pattern is established (Quiver project precedent).

### Phase 5: Intelligence Layer (AI Agents)
**Rationale:** Depends on Phases 2 (error categorization) + 3 (embeddings + metadata extraction). This is the NOVEL differentiator — no competitor has AI agent pattern detection.

**Delivers:** Pydantic AI agents for blind spot detection, error pattern discovery (e.g., "90% of FN occur in low-light images").

**Features from FEATURES.md:**
- AI agent for error pattern detection (highest-value differentiator)
- Metadata extraction (brightness, contrast, scene type via VLM)

**Uses stack:**
- Pydantic AI 1.58.0 (agent framework with tools)
- Moondream2 (1.86B VLM for image analysis)
- DuckDB + Qdrant as agent tools (query error distributions, metadata correlations)

**Avoids pitfalls:**
- P9: VLM hallucination (calibration framework, confidence scores, minimum sample size)
- P13: GPU memory contention (serialize VLM + CLIP via task queue)

**Research flag:** NEEDS RESEARCH — Pydantic AI tool design for DuckDB/Qdrant access, VLM prompt engineering for error analysis, calibration methodology are less documented. Use `/gsd:research-phase` for Phase 5 planning.

### Phase 6: Extensibility & Polish
**Rationale:** Depends on Phases 1-4 being stable. Adds ecosystem value (YOLO/VOC parsers, export, saved views).

**Delivers:** YOLO + VOC parsers, export filtered subsets, saved views, additional UI hooks.

**Features from FEATURES.md:**
- YOLO parser, VOC parser (complete the 3 core formats)
- Saved views / export filtered subsets
- Plugin UI hooks (custom panels)

**Research flag:** SKIP — annotation format specs are documented. Plugin patterns from Phase 1 extend naturally.

### Phase Ordering Rationale

**Why this order:**
- Phases 1-2 deliver the core browse-filter-compare loop that replaces users' one-off scripts (MVP milestone)
- Phases 2-3 can proceed in parallel (independent dependencies)
- Phase 4 (hybrid queries) requires Phase 3 (Qdrant) to be working
- Phase 5 (agents) requires both error categorization (Phase 2) and embeddings (Phase 3)
- Phase 6 (polish) adds ecosystem value once core is proven

**Why this grouping:**
- Phase 1 is "data in, data out" — foundational CRUD
- Phase 2 is "model debugging" — the GT vs Pred workflow
- Phase 3 is "visual exploration" — the deck.gl embedding map
- Phase 4 is "intelligence" — hybrid queries + AI agents
- Phase 5 is "agents" — the novel differentiator
- Phase 6 is "ecosystem" — parsers, exports, community features

**How this avoids pitfalls:**
- All critical pitfalls (P1-P5) are addressed in Phase 1 or have explicit prevention steps in their phase
- DuckDB patterns, dual-DB consistency, streaming ingestion are non-negotiable Phase 1 requirements
- WebGL context loss and UMAP async are designed into Phase 3 from the start
- VLM calibration is built alongside agent integration in Phase 5

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 5 (Intelligence Layer):** Pydantic AI tool design for database access, VLM prompt engineering for error pattern detection, calibration methodology for Moondream2. Use `/gsd:research-phase` to explore agent architecture patterns and VLM integration best practices.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Foundation):** FastAPI, DuckDB, streaming JSON, virtualized grids, image serving — all well-documented
- **Phase 2 (Model Debugging):** Evaluation metrics (IoU, TP/FP/FN) are standard COCO patterns
- **Phase 3 (Embedding Viz):** deck.gl, UMAP, Qdrant are established with official docs
- **Phase 4 (Similarity Search):** Qdrant payload filtering is documented; hybrid query pattern is known
- **Phase 6 (Extensibility):** Annotation format specs (YOLO, VOC) are public; plugin patterns extend Phase 1

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Every technology verified via official docs, PyPI/npm versions confirmed, compatibility matrix validated. No red flags. |
| Features | **HIGH** | Competitive analysis grounded in official FiftyOne/CVAT/Roboflow/Encord docs. Feature dependencies mapped via FiftyOne architecture. |
| Architecture | **MEDIUM-HIGH** | Core patterns (dual-DB, Query Coordinator, cross-filtering) are established. DuckDB concurrency verified via official docs. Some integration patterns (deck.gl + Zustand sync) are inferred. |
| Pitfalls | **MEDIUM-HIGH** | Critical pitfalls (DuckDB concurrency, WebGL context loss, COCO OOM) verified via official docs + GitHub issues. VLM hallucination is general pattern, not Moondream2-specific. |

**Overall confidence:** **HIGH**

The stack is production-ready, the feature landscape is well-mapped via competitive analysis, and the architecture patterns are validated. The main uncertainty is Phase 5 (VLM agent integration), which is novel territory — hence the research flag.

### Gaps to Address

**DuckDB + FastAPI concurrency under load:**
- Research confirmed cursor-per-request pattern, but real-world load testing (100+ concurrent requests) will validate. Plan for early load testing in Phase 1.

**deck.gl performance at 1M+ points:**
- Documentation claims 1M+ at 60 FPS, but actual performance depends on hardware (GPU, screen DPI). Plan for early performance testing with synthetic 1M-point dataset.

**Moondream2 VLM accuracy for scene attributes:**
- HuggingFace model card shows 1.86B params, but accuracy on specific attributes (lighting, occlusion, blur) is unknown. Phase 5 MUST include calibration on labeled validation set before deploying agent.

**UMAP incremental updates (.transform() method):**
- UMAP docs confirm .transform() works for projecting new points, but "distribution must be consistent." Real-world datasets may not satisfy this. Plan for full recompute as fallback.

**GCS signed URL expiry and refresh:**
- GCS docs confirm signed URLs, but refresh workflow during long browsing sessions needs design. Consider backend proxy with auth refresh.

## Sources

### Primary (HIGH confidence)
- FastAPI PyPI 0.128.7 — verified current version
- DuckDB PyPI 1.4.4 + official concurrency docs — single-writer model, cursor-per-thread pattern
- Qdrant GitHub 1.16.0 releases + collection docs — named vectors, payload filtering
- deck.gl npm 9.2.6 + performance docs — 1M points at 60fps, picking limits, context loss
- Pydantic AI PyPI 1.58.0 + V1 announcement — API stability guarantee
- Next.js 16 blog — Turbopack stable, React 19
- Tailwind CSS v4 blog + npm 4.1.18 — v4 rewrite confirmed
- UMAP 0.5.11 official docs — transform method, parametric UMAP
- FiftyOne official docs (v1.12.0) — Brain, evaluation, plugins, embeddings
- CVAT, Label Studio, Roboflow official docs — feature comparison
- supervision PyPI 0.27.0 + dataset docs — COCO/YOLO/VOC loading
- TanStack Virtual docs — virtualization patterns
- react-konva GitHub — canvas annotation rendering

### Secondary (MEDIUM confidence)
- DuckDB FastAPI Discussion #13719 — concurrency patterns validated by community
- deck.gl Context Loss Discussion #7841 + Issue #5398 — recovery patterns
- TanStack Virtual Issue #196 — memory leak confirmation
- FiftyOne Performance Issues #1740, #675 — 145K sample load times
- Qdrant Embedding Change Discussion #3797 — migration patterns
- Python JSON Streaming article — ijson 99.4% memory reduction claim
- Moondream2 HuggingFace model card — 1.86B params confirmed

### Tertiary (LOW confidence)
- Quiver project (DuckDB + HNSW) — referenced in MotherDuck blog, not primary source
- GCS caching behavior for private buckets — inferred from docs, not benchmarked
- Pillow thumbnail generation performance at 100K scale — assumed sufficient, not measured

---
*Research completed: 2026-02-10*
*Ready for roadmap: yes*
