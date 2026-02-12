# Stack Research

**Domain:** CV dataset introspection tool (Voxel51/FiftyOne alternative)
**Researched:** 2026-02-10
**Confidence:** HIGH

## Verdict on User's Proposed Stack

The user's proposed stack (FastAPI + DuckDB + Qdrant + Next.js + Tailwind + deck.gl + Pydantic AI) is a **strong, well-reasoned selection**. Every choice is validated as current, actively maintained, and appropriate for the domain. There are no outright wrong picks. Below I confirm each choice, flag nuances, identify gaps in the stack, and recommend supporting libraries.

---

## Recommended Stack

### Backend Core

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| FastAPI | 0.128.7 | REST API framework | Async-native, Pydantic v2 integration, automatic OpenAPI docs. The standard Python API framework for data-intensive tools. No serious competitor in this niche. |
| DuckDB | 1.4.4 | Metadata storage & analytical queries | Columnar storage, vectorized execution, 10-100x faster than SQLite on analytical queries (GROUP BY, aggregations, filtering). In-process -- zero server deployment. Reads Parquet/Arrow natively. Perfect for filtering 100K+ sample metadata. |
| Qdrant | 1.16.0 (server) / 1.16.2 (Python client) | Vector similarity search | Rust-based, payload filtering (critical for filtering embeddings by class/metadata), local Docker deployment, GPU-accelerated HNSW indexing. Payload filtering is the key differentiator over FAISS for this use case. |
| Pydantic AI | 1.58.0 | Agentic blind spot detection | V1-stable (API locked until April 2026 minimum). Type-safe agent definitions, structured output via Pydantic models, function tools for giving agents access to DuckDB/Qdrant queries. Native FastAPI ecosystem integration. MCP and Agent2Agent support. |
| Python | >=3.11 | Runtime | DuckDB and Qdrant client require >=3.10. Python 3.11+ recommended for performance (10-60% faster than 3.10). Pydantic v2 performance optimized for 3.11+. |

### Frontend Core

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 16.x (latest 16.1.6) | React framework | App Router stable, Turbopack stable (filesystem caching on by default in 16.1), React 19 support. Use Next.js 16 over 15 -- Turbopack build stability and cache components are production-ready. |
| Tailwind CSS | 4.x (latest 4.1.18) | Utility-first CSS | v4 is a complete rewrite: 5x faster full builds, 100x faster incremental builds. Zero-config setup (`@import "tailwindcss"`). Container queries built-in. Cascade layers for clean specificity. |
| deck.gl | 9.x (latest 9.2.6) | Embedding scatterplot visualization | WebGL2/WebGPU-ready. ScatterplotLayer renders 1M+ points at 60 FPS with pan/zoom. Built-in lasso selection via EditableGeoJsonLayer or custom interaction. CollisionFilterExtension for dense point clouds. TypeScript-first since v9. |
| shadcn/ui | latest | UI component primitives | Copy-paste component model (you own the code). Built on Radix UI + Tailwind CSS. Accessible, customizable. Standard pairing with Next.js + Tailwind in 2025-2026. Use for sidebar filters, dialogs, dropdowns, tabs. |

### Data Processing & ML

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| supervision | 0.27.0 | Annotation format parsing (COCO, YOLO, VOC) | Roboflow's open-source library. `sv.DetectionDataset.from_coco()`, `.from_yolo()`, `.from_pascal_voc()` -- exactly the three formats needed. Also provides annotators for rendering bounding boxes on images server-side if needed. Model-agnostic. pycocotools-compatible. |
| umap-learn | 0.5.11 | Dimensionality reduction (UMAP) | Standard library for UMAP. Handles large datasets better than t-SNE (linear vs quadratic scaling). Preserves global structure. Use for 2D/3D embedding projections fed into deck.gl. |
| sentence-transformers | latest | Image embedding extraction | Wraps CLIP, DINOv2, and other vision models. Batch processing with GPU support (~1500 images/sec on RTX 3080). `model.encode()` with `batch_size` and `convert_to_tensor` for efficient embedding generation. |
| Pillow | 12.1.0 | Image I/O and thumbnail generation | Standard Python imaging library. `Image.thumbnail()` for generating grid view thumbnails. BICUBIC resampling default. Required dependency for supervision and sentence-transformers anyway. |
| scikit-learn | latest | t-SNE implementation | Use `sklearn.manifold.TSNE` as the t-SNE provider alongside umap-learn for UMAP. scikit-learn's t-SNE is well-optimized with Barnes-Hut approximation for larger datasets. |

### Infrastructure & Storage

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| gcsfs | 2026.1.0 | Google Cloud Storage filesystem access | fsspec-based pythonic file interface for GCS. Transparent read/write. Integrates with DuckDB's httpfs extension for direct Parquet reads from GCS. |
| Docker / Docker Compose | latest | Qdrant server, dev environment | Qdrant runs as a Docker container (`qdrant/qdrant:v1.16.0`). Compose file for local dev with Qdrant + optional services. DuckDB and FastAPI are in-process, no containers needed. |
| uvicorn | latest | ASGI server for FastAPI | Standard production server for FastAPI. Use `--workers` for multi-process deployment. |

### Frontend Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-virtual | latest | Virtualized grid scrolling | Virtualizes the image grid to handle 100K+ items without DOM bloat. Renders only visible rows. Combine with `useInfiniteQuery` for paginated data loading. Critical for performance. |
| @tanstack/react-query | latest | Server state management + caching | Data fetching, caching, pagination for grid view data. `useInfiniteQuery` for scroll-triggered page loads. Deduplication and background refetching. |
| react-konva | latest | Canvas-based bounding box overlays | React wrapper for Konva.js canvas library. Draw bounding boxes, polygons, and labels overlaid on images. Per-layer canvas means only annotation layers re-render, not images. Handles GT vs predictions toggle (solid vs dashed strokes). |
| @deck.gl/react | 9.x | React wrapper for deck.gl | Thin React component wrapper for deck.gl. Handles lifecycle and state. Use with standalone Next.js pages (no map provider needed for pure scatterplots). |
| zustand | latest | Client-side state management | Lightweight state management for filter state, selection state, view mode toggles. No boilerplate. Works with React 19. Simpler than Redux for this scale. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Ruff | Python linting + formatting | Replaces flake8 + black + isort. 10-100x faster. Single tool for Python code quality. |
| uv | Python package management | Replaces pip + pip-tools + venv. 10-100x faster installs. Lockfile support. Use for reproducible Python environments. |
| Biome | JS/TS linting + formatting | Replaces ESLint + Prettier. Single binary, fast. Or use ESLint 9 flat config if team prefers. |
| pytest | Python testing | Standard. Use with pytest-asyncio for async FastAPI test coverage. |
| Vitest | Frontend testing | Native Vite/Next.js integration. Faster than Jest. |

---

## Installation

### Python Backend

```bash
# Using uv (recommended)
uv init datavisor-backend
cd datavisor-backend

# Core
uv add fastapi uvicorn[standard] duckdb pydantic-ai qdrant-client

# Data processing
uv add supervision umap-learn scikit-learn sentence-transformers Pillow

# Cloud storage
uv add gcsfs

# Dev dependencies
uv add --dev pytest pytest-asyncio ruff httpx
```

### Frontend

```bash
npx create-next-app@latest datavisor-ui --typescript --tailwind --app --turbopack
cd datavisor-ui

# Core visualization
npm install deck.gl @deck.gl/core @deck.gl/layers @deck.gl/react @luma.gl/core

# Data & state
npm install @tanstack/react-query @tanstack/react-virtual zustand

# Canvas annotation overlays
npm install react-konva konva

# UI components (copy-paste, not installed as dependency)
npx shadcn@latest init
npx shadcn@latest add button dialog dropdown-menu input select slider tabs sidebar
```

### Infrastructure

```bash
# Qdrant (Docker)
docker pull qdrant/qdrant:v1.16.0
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant:v1.16.0
```

---

## Alternatives Considered

### Backend Framework

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| FastAPI | Litestar | If you need built-in dependency injection beyond FastAPI's `Depends()`. Litestar has a more opinionated DI system. However, FastAPI's ecosystem (docs, community, integrations) is 10x larger. Stick with FastAPI. |
| FastAPI | Django + DRF | Never for this project. Django's ORM is wasted with DuckDB. Synchronous by default. Wrong tool for analytical workloads. |

### Metadata Database

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| DuckDB | SQLite | Only if you need transactional writes at high concurrency (DuckDB is single-writer). For this project, writes are batch imports and reads are analytical queries -- DuckDB wins by 10-100x on the read path. |
| DuckDB | PostgreSQL | If you need multi-user concurrent access with full ACID transactions. Overkill for a single-user desktop tool. Adds deployment complexity (separate server process). |
| DuckDB | Polars DataFrames | For pure in-memory analytics without persistence. DuckDB provides SQL interface + persistence + Parquet interop -- better for a tool that needs to persist dataset metadata across sessions. |

### Vector Database

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Qdrant | FAISS | Only for raw research benchmarks or if you never need payload filtering. FAISS is a library, not a database -- no CRUD, no filtering, no persistence layer, no concurrent access. You would need to build all of that yourself. Qdrant provides it out of the box. |
| Qdrant | Milvus | If you need massive horizontal scaling (billion+ vectors across a cluster). Milvus has separated storage/compute architecture. Overkill and operationally heavy for a single-user tool. Qdrant in local Docker is simpler. |
| Qdrant | ChromaDB | If you want an even simpler embedded vector store. But ChromaDB lacks Qdrant's payload filtering sophistication and Rust performance. For 100K+ embeddings with metadata filters, Qdrant is the right choice. |

### Embedding Visualization

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| deck.gl | Plotly (scattergl) | If you need quick-and-dirty plots with <200K points. Plotly's scattergl caps out around 200K points and hits WebGL context limits with multiple charts. deck.gl handles 1M+ points and supports lasso selection natively. |
| deck.gl | regl-scatterplot | If you need a minimal dependency for just 2D scatterplots. regl-scatterplot is lighter than deck.gl but lacks 3D support, layer composition, and the interaction primitives deck.gl provides. |
| deck.gl | Three.js | If you need full 3D scene control (custom shaders, lighting, camera animation). Three.js is lower-level -- you would build everything from scratch. deck.gl provides ScatterplotLayer, interactions, and performance optimizations out of the box. |

### Frontend Framework

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Next.js 16 | Vite + React | If you want a pure SPA without SSR/SSG. For a data tool that talks to a local FastAPI backend, SSR adds little value. However, Next.js provides: file-based routing, API routes (useful for image proxy), Turbopack dev speed, and ecosystem maturity. The marginal complexity is worth the DX. |
| Next.js 16 | SvelteKit | If the team prefers Svelte. deck.gl has a Svelte adapter but it is less mature than the React wrapper. The React ecosystem for data visualization is significantly larger. |

### Annotation Parsing

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| supervision | pycocotools + custom parsers | Only if you need zero dependencies beyond pycocotools. But supervision already wraps pycocotools and adds YOLO + VOC parsing, annotators, and dataset utilities. It is strictly a superset for this use case. |
| supervision | FiftyOne (as library) | Ironic, but FiftyOne's dataset loading is comprehensive. However, FiftyOne pulls in MongoDB as a dependency and has a heavy footprint. supervision is lightweight and focused. |

### Agent Framework

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Pydantic AI | LangChain | Never for new projects in 2026. LangChain is bloated, over-abstracted, and has unstable APIs. Pydantic AI is lean, type-safe, and v1-stable. |
| Pydantic AI | LangGraph | If you need complex multi-step agent orchestration with stateful graph execution. For DataVisor, the agents are relatively simple (analyze error distribution, detect patterns) -- Pydantic AI's tool-calling model is sufficient. |
| Pydantic AI | Raw OpenAI/Anthropic SDK | If you want zero framework overhead. But you lose structured output validation, tool registration, and model-agnostic portability. Pydantic AI's overhead is minimal and the safety net is worth it. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| MongoDB | FiftyOne uses it, but it is overkill for single-user tool. Requires separate server process. DuckDB is in-process and faster for analytical queries. | DuckDB |
| FAISS (as primary store) | Library, not database. No CRUD, no filtering, no persistence. You would rebuild Qdrant poorly. | Qdrant |
| Plotly for main viz | WebGL context limits (max ~8 charts), caps at ~200K points, no lasso-to-filter pipeline. | deck.gl |
| LangChain | Bloated abstractions, unstable API surface, unnecessary complexity for this use case. | Pydantic AI |
| Redux / Redux Toolkit | Overkill for client state in a data tool. Boilerplate-heavy. | zustand |
| SQLAlchemy | ORM designed for relational databases. DuckDB has its own Python API with direct SQL. SQLAlchemy adds indirection with no benefit. | DuckDB Python API directly |
| Webpack | Slow. Next.js 16 uses Turbopack by default. No configuration needed. | Turbopack (built into Next.js 16) |
| Flask | Synchronous, no built-in validation, no OpenAPI generation. Inferior to FastAPI in every dimension for this project. | FastAPI |
| Electron | If tempted to wrap as desktop app. Adds massive complexity. Use the browser -- it is the runtime. | Browser-based (Next.js dev server) |

---

## Stack Patterns by Variant

**If deploying as a purely local tool (default):**
- DuckDB file on local disk (e.g., `~/.datavisor/metadata.duckdb`)
- Qdrant via Docker on localhost:6333
- FastAPI on localhost:8000
- Next.js dev server on localhost:3000
- Images served directly from local filesystem via FastAPI static file endpoint

**If deploying with cloud GPU for VLM inference:**
- Same local stack for UI + metadata
- Cloud GPU instance runs embedding generation + VLM inference
- FastAPI on cloud instance exposes `/embed` and `/vlm/analyze` endpoints
- Local tool calls cloud endpoints, stores results in local DuckDB/Qdrant
- Consider Modal, RunPod, or GCE spot instances for cost-effective GPU

**If datasets are on GCS:**
- gcsfs provides transparent read access
- FastAPI image proxy endpoint streams images from GCS to frontend
- Consider a local thumbnail cache (DuckDB stores thumbnail paths, Pillow generates on first access)
- DuckDB can query Parquet files directly from GCS via httpfs extension

---

## Critical Gaps in User's Proposed Stack

These are technologies NOT in the user's original list that are **required** for the project to work:

| Gap | Why Critical | Recommended Fill |
|-----|-------------|-----------------|
| Virtualized scrolling | 100K+ images cannot be rendered as DOM nodes. Without virtualization, the grid view will freeze the browser. | @tanstack/react-virtual |
| Server state management | Grid pagination, filter state, data fetching lifecycle. Raw `fetch()` will not scale. | @tanstack/react-query |
| Canvas annotation rendering | Bounding box overlays on images in the grid require a canvas or SVG solution. Neither deck.gl nor vanilla HTML handles this. | react-konva |
| Annotation format parsing | COCO/YOLO/VOC parsing is non-trivial. Custom parsers are error-prone and duplicative. | supervision |
| Embedding model | The user mentions UMAP/t-SNE but not how embeddings are generated from images. Needs a model pipeline. | sentence-transformers (CLIP or DINOv2) |
| Dimensionality reduction | UMAP/t-SNE mentioned as features but no library specified. | umap-learn + scikit-learn |
| UI component primitives | Sidebar filters, dialogs, dropdowns need accessible components. Building from scratch is slow. | shadcn/ui (Radix + Tailwind) |
| Client state management | Filter selections, view mode, selection state need lightweight state management. | zustand |
| Image I/O + thumbnails | Thumbnail generation for grid view. Reading diverse image formats. | Pillow |
| GCS access | Listed as a requirement but no library specified. | gcsfs |

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| FastAPI 0.128.x | Pydantic v2 (2.x) | FastAPI fully supports Pydantic v2. Pydantic AI also requires Pydantic v2. No conflicts. |
| DuckDB 1.4.x | Python 3.11+ | DuckDB 1.4.4 ships wheels for Python 3.8-3.13. Recommend 3.11+ for performance. |
| Qdrant client 1.16.x | Qdrant server 1.16.x | Client and server major.minor versions should match. Client 1.16.2 works with server 1.16.0. |
| Next.js 16.x | React 19 | Next.js 16 requires React 19. Ensure all React libraries support React 19 (react-konva, deck.gl/react do). |
| deck.gl 9.x | @luma.gl/core 9.x | deck.gl 9.x depends on luma.gl 9.x (same monorepo). Install together. |
| Tailwind CSS 4.x | Next.js 16.x | Next.js 16 has built-in Tailwind v4 support via `create-next-app --tailwind`. |
| supervision 0.27.x | Pillow, NumPy, OpenCV | supervision depends on opencv-python. This may conflict with opencv-python-headless in Docker environments. Use `supervision[headless]` or install opencv-python-headless explicitly. |
| sentence-transformers | torch 2.x | Requires PyTorch. For GPU embedding generation, ensure CUDA-compatible torch is installed (`pip install torch --index-url https://download.pytorch.org/whl/cu121`). |

### Known Compatibility Warnings

- **DuckDB + async**: DuckDB does not support native async I/O. In FastAPI async endpoints, run DuckDB queries in a thread pool (`asyncio.to_thread()` or FastAPI's default thread pool for sync functions). Do NOT use `async def` endpoints that call DuckDB directly -- use `def` endpoints (FastAPI auto-runs these in a threadpool) or explicitly use `run_in_executor`.
- **DuckDB + concurrency**: DuckDB is single-writer. For this single-user tool, this is fine. Each connection is thread-safe but serialized. Use `.cursor()` for read-only parallel access from multiple threads on the same connection.
- **deck.gl + Next.js SSR**: deck.gl uses WebGL and cannot render server-side. Use `dynamic(() => import('./EmbeddingMap'), { ssr: false })` in Next.js to disable SSR for deck.gl components.
- **react-konva + SSR**: Same issue as deck.gl. Konva requires a browser DOM. Use dynamic import with `{ ssr: false }`.
- **Tailwind v4 + older browsers**: Tailwind v4 requires Safari 16.4+, Chrome 111+, Firefox 128+. For a desktop dev tool this is fine, but flag if broader browser support is needed.

---

## DuckDB Async Pattern (Critical for FastAPI)

Since DuckDB lacks async I/O, use this pattern in FastAPI:

```python
# Option 1: Sync endpoint (FastAPI auto-threadpools these)
@app.get("/api/samples")
def get_samples(limit: int = 100, offset: int = 0):
    conn = duckdb.connect("metadata.duckdb", read_only=True)
    result = conn.execute(
        "SELECT * FROM samples LIMIT ? OFFSET ?", [limit, offset]
    ).fetchdf()
    conn.close()
    return result.to_dict(orient="records")

# Option 2: Async endpoint with explicit thread delegation
@app.get("/api/samples")
async def get_samples(limit: int = 100, offset: int = 0):
    result = await asyncio.to_thread(_query_samples, limit, offset)
    return result

def _query_samples(limit: int, offset: int):
    conn = duckdb.connect("metadata.duckdb", read_only=True)
    result = conn.execute(
        "SELECT * FROM samples LIMIT ? OFFSET ?", [limit, offset]
    ).fetchdf()
    conn.close()
    return result.to_dict(orient="records")
```

Prefer Option 1 (sync `def` endpoints) for simplicity. FastAPI handles the threading.

---

## Embedding Pipeline Architecture

The stack needs a clear pipeline for generating embeddings:

```
Images (disk/GCS)
    |
    v
[sentence-transformers + DINOv2/CLIP]  -- GPU (local or cloud)
    |
    v
Raw embeddings (768-1024 dim)
    |
    +---> Qdrant (full-dimensional vectors + payload metadata)
    |
    v
[umap-learn / sklearn.TSNE]  -- CPU
    |
    v
2D/3D coordinates
    |
    +---> DuckDB (x, y, z columns per sample for fast querying)
    |
    v
deck.gl ScatterplotLayer (frontend)
```

**Recommendation:** Use DINOv2 (ViT-B/14) over CLIP for embedding generation. DINOv2 achieves 5x better accuracy on fine-grained visual similarity tasks. CLIP is better for text-image alignment (not needed here). Use `sentence-transformers` as the extraction wrapper for both.

---

## Sources

- [FastAPI PyPI](https://pypi.org/project/fastapi/) -- version 0.128.7 verified (HIGH confidence)
- [DuckDB PyPI](https://pypi.org/project/duckdb/) -- version 1.4.4 verified (HIGH confidence)
- [DuckDB vs SQLite comparison](https://www.datacamp.com/blog/duckdb-vs-sqlite-complete-database-comparison) -- 10-100x analytical query speedup (MEDIUM confidence, multiple sources agree)
- [DuckDB Concurrency Docs](https://duckdb.org/docs/stable/connect/concurrency) -- thread safety model (HIGH confidence)
- [DuckDB Multiple Python Threads](https://duckdb.org/docs/stable/guides/python/multiple_threads) -- cursor pattern (HIGH confidence)
- [Qdrant GitHub Releases](https://github.com/qdrant/qdrant/releases) -- version 1.16.0 (HIGH confidence)
- [Qdrant 2025 Recap](https://qdrant.tech/blog/2025-recap/) -- GPU HNSW, payload filtering (HIGH confidence)
- [Qdrant Python Client PyPI](https://pypi.org/project/qdrant-client/) -- version 1.16.2 (HIGH confidence)
- [Qdrant vs FAISS vs Milvus comparison](https://tensorblue.com/blog/vector-database-comparison-pinecone-weaviate-qdrant-milvus-2025) -- (MEDIUM confidence)
- [Pydantic AI PyPI](https://pypi.org/project/pydantic-ai/) -- version 1.58.0 (HIGH confidence)
- [Pydantic AI V1 announcement](https://pydantic.dev/articles/pydantic-ai-v1) -- API stability guarantee (HIGH confidence)
- [Pydantic AI Tools docs](https://ai.pydantic.dev/tools/) -- function tools API (HIGH confidence)
- [deck.gl npm](https://www.npmjs.com/package/deck.gl) -- version 9.2.6 (HIGH confidence)
- [deck.gl Performance docs](https://deck.gl/docs/developer-guide/performance) -- 1M points at 60 FPS (HIGH confidence)
- [deck.gl ScatterplotLayer docs](https://deck.gl/docs/api-reference/layers/scatterplot-layer) -- stroke/fill support (HIGH confidence)
- [deck.gl React integration](https://deck.gl/docs/get-started/using-with-react) -- DeckGL component (HIGH confidence)
- [Next.js 16 blog](https://nextjs.org/blog/next-16) -- Turbopack stable, React 19 (HIGH confidence)
- [Tailwind CSS v4 blog](https://tailwindcss.com/blog/tailwindcss-v4) -- v4.0 features (HIGH confidence)
- [Tailwind CSS npm](https://www.npmjs.com/package/tailwindcss) -- version 4.1.18 (HIGH confidence)
- [TanStack Virtual docs](https://tanstack.com/virtual/latest/docs/introduction) -- virtualization for 100K+ items (HIGH confidence)
- [TanStack Query docs](https://tanstack.com/table/latest/docs/framework/react/examples/virtualized-infinite-scrolling) -- infinite scroll pattern (HIGH confidence)
- [react-konva GitHub](https://github.com/konvajs/react-konva) -- canvas annotation (MEDIUM confidence)
- [supervision PyPI](https://pypi.org/project/supervision/) -- version 0.27.0 (HIGH confidence)
- [supervision dataset docs](https://supervision.roboflow.com/datasets/) -- COCO/YOLO/VOC loading (HIGH confidence)
- [umap-learn PyPI](https://pypi.org/project/umap-learn/) -- version 0.5.11 (HIGH confidence)
- [Pillow PyPI](https://pypi.org/project/pillow/) -- version 12.1.0 (HIGH confidence)
- [gcsfs PyPI](https://pypi.org/project/gcsfs/) -- version 2026.1.0 (HIGH confidence)
- [DINOv2 vs CLIP for embeddings](https://voxel51.com/blog/finding-the-best-embedding-model-for-image-classification) -- DINOv2 5x better on fine-grained tasks (MEDIUM confidence)
- [sentence-transformers CLIP batch processing](https://medium.com/@bgipradeep123/ai-powered-image-search-using-sentence-transformers-and-clip-2ae89cb78da6) -- ~1500 img/sec on 3080 (LOW confidence, single source)
- [shadcn/ui docs](https://ui.shadcn.com/) -- Radix + Tailwind components (HIGH confidence)
- [FiftyOne architecture](https://docs.voxel51.com/teams/overview.html) -- MongoDB backend, Python client (MEDIUM confidence)
- [Moondream2 HuggingFace](https://huggingface.co/vikhyatk/moondream2) -- 1.86B param VLM (HIGH confidence)

---
*Stack research for: DataVisor -- CV dataset introspection tool*
*Researched: 2026-02-10*
