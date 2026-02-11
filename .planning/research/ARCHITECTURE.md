# Architecture Research

**Domain:** CV Dataset Introspection Tooling
**Researched:** 2026-02-10
**Confidence:** MEDIUM-HIGH

---

## System Overview

VisionLens is a dual-database, full-stack application for exploring 100K+ image datasets with both analytical metadata queries and vector similarity search. The architecture follows a **layered monolith** pattern: a Python backend serves as the single coordination point between two specialized databases and a rich SPA frontend.

```
┌──────────────────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js + Tailwind)                     │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Grid View│  │ Embedding Map│  │ Filter Panel │  │Detail Viewer│  │
│  │(Virtual) │  │  (deck.gl)   │  │  (Sidebar)   │  │ (Overlays)  │  │
│  └─────┬────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │
│        │               │                 │                  │         │
│  ┌─────┴───────────────┴─────────────────┴──────────────────┴──────┐  │
│  │              Zustand Store (Shared Selection State)              │  │
│  └─────────────────────────────┬───────────────────────────────────┘  │
├────────────────────────────────┼─────────────────────────────────────┤
│                         REST API Layer                                │
├────────────────────────────────┼─────────────────────────────────────┤
│                     BACKEND (FastAPI / Python)                        │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │  Router  │  │ Query Coord. │  │   Plugin     │  │  Agent      │  │
│  │  Layer   │  │   Service    │  │   Manager    │  │  Service    │  │
│  └────┬─────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │
│       │               │                 │                  │         │
│  ┌────┴───────────────┴─────────────────┴──────────────────┴──────┐  │
│  │              Service Layer (Business Logic)                     │  │
│  └────────┬──────────────────┬───────────────────┬────────────────┘  │
│           │                  │                   │                    │
│  ┌────────┴──────┐  ┌───────┴────────┐  ┌──────┴────────┐          │
│  │  DuckDB Repo  │  │  Qdrant Repo   │  │ Storage Repo  │          │
│  │  (Metadata)   │  │  (Vectors)     │  │ (Images/GCS)  │          │
│  └───────┬───────┘  └───────┬────────┘  └──────┬────────┘          │
├──────────┼──────────────────┼──────────────────┼────────────────────┤
│          │       DATA LAYER │                  │                     │
│  ┌───────┴───────┐  ┌──────┴────────┐  ┌─────┴──────────┐         │
│  │    DuckDB     │  │    Qdrant     │  │  Local / GCS   │         │
│  │  (.duckdb)    │  │   (local)     │  │  (images)      │         │
│  └───────────────┘  └───────────────┘  └────────────────┘         │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Grid View** | Virtualized infinite-scroll image grid with annotation overlays | TanStack Virtual or react-virtuoso rendering thumbnail tiles; each tile lazy-loads its image |
| **Embedding Map** | 2D/3D scatterplot of image embeddings with lasso selection, hover thumbnails | deck.gl ScatterplotLayer; handles 1M+ points at 60fps |
| **Filter Panel** | Dynamic sidebar filters on any metadata field (class, split, confidence, etc.) | Zustand-driven filter state that propagates to both grid and map |
| **Detail Viewer** | Full-resolution image with GT and prediction bounding box overlays, metadata panel | Canvas or SVG overlay rendering; toggle between GT (solid) and predictions (dashed) |
| **Zustand Store** | Shared client-side selection state: active filters, selected sample IDs, active view | Single source of truth enabling cross-filtering between grid and map |
| **Router Layer** | FastAPI routers: `/datasets`, `/samples`, `/embeddings`, `/search`, `/plugins`, `/agents` | Standard FastAPI APIRouter modules |
| **Query Coordinator** | Orchestrates queries that span DuckDB and Qdrant; merges results | Service that decides which DB to query and joins results by sample ID |
| **Plugin Manager** | Discovers, loads, validates, and executes plugins via BasePlugin | importlib-based dynamic loading with hook registration |
| **Agent Service** | Pydantic AI agents for blind spot detection, error pattern discovery | Async agent execution with structured output |
| **DuckDB Repository** | All metadata CRUD: samples, annotations, fields, analytical queries | Connection pool using cursor-per-request pattern; SQL query builder |
| **Qdrant Repository** | Vector storage, similarity search, embedding CRUD | Singleton async QdrantClient; payload-filtered search |
| **Storage Repository** | Image retrieval from local disk or GCS; thumbnail generation | Abstraction over filesystem and GCS client; optional imgproxy integration |

---

## Recommended Project Structure

```
visionlens/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app factory, lifespan, CORS
│   │   ├── config.py               # Pydantic Settings for all configuration
│   │   ├── dependencies.py         # FastAPI Depends: db connections, clients
│   │   │
│   │   ├── routers/                # API endpoint definitions
│   │   │   ├── datasets.py         # POST /datasets (ingest), GET /datasets
│   │   │   ├── samples.py          # GET /samples (paginated, filtered)
│   │   │   ├── embeddings.py       # POST /embeddings/compute, GET /embeddings
│   │   │   ├── search.py           # POST /search/similar, POST /search/query
│   │   │   ├── plugins.py          # GET /plugins, POST /plugins/{id}/execute
│   │   │   └── agents.py           # POST /agents/blindspot, GET /agents/results
│   │   │
│   │   ├── services/               # Business logic layer
│   │   │   ├── dataset_service.py  # Ingestion orchestration, format detection
│   │   │   ├── query_service.py    # Query coordination across DuckDB + Qdrant
│   │   │   ├── embedding_service.py# Embedding generation, dim reduction
│   │   │   ├── plugin_service.py   # Plugin lifecycle management
│   │   │   └── agent_service.py    # Pydantic AI agent orchestration
│   │   │
│   │   ├── repositories/           # Data access layer
│   │   │   ├── duckdb_repo.py      # DuckDB connection management + queries
│   │   │   ├── qdrant_repo.py      # Qdrant client wrapper
│   │   │   └── storage_repo.py     # Local/GCS image access abstraction
│   │   │
│   │   ├── models/                 # Pydantic models (API contracts)
│   │   │   ├── dataset.py          # DatasetCreate, DatasetResponse
│   │   │   ├── sample.py           # SampleResponse, SampleFilter
│   │   │   ├── annotation.py       # BBox, Classification, GT vs Prediction
│   │   │   └── embedding.py        # EmbeddingPoint, EmbeddingConfig
│   │   │
│   │   ├── ingestion/              # Format-specific parsers
│   │   │   ├── base_parser.py      # Abstract BaseParser class
│   │   │   ├── coco_parser.py      # COCO JSON format
│   │   │   ├── yolo_parser.py      # YOLO txt + images format
│   │   │   └── voc_parser.py       # Pascal VOC XML format
│   │   │
│   │   ├── plugins/                # Plugin system
│   │   │   ├── base_plugin.py      # BasePlugin abstract class + hook definitions
│   │   │   ├── registry.py         # Plugin discovery and registration
│   │   │   └── hooks.py            # Hook point definitions (ingestion, transform, UI)
│   │   │
│   │   └── agents/                 # VLM agent definitions
│   │       ├── blindspot_agent.py  # Blind spot discovery agent
│   │       └── error_agent.py      # Error categorization agent
│   │
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── app/                    # Next.js App Router pages
│   │   │   ├── page.tsx            # Main dataset browser
│   │   │   └── layout.tsx          # Root layout
│   │   │
│   │   ├── components/
│   │   │   ├── grid/               # Virtualized image grid
│   │   │   │   ├── ImageGrid.tsx   # Main grid container (TanStack Virtual)
│   │   │   │   ├── GridTile.tsx    # Individual image tile with overlays
│   │   │   │   └── AnnotationOverlay.tsx  # BBox rendering (GT vs Pred)
│   │   │   │
│   │   │   ├── map/                # Embedding visualization
│   │   │   │   ├── EmbeddingMap.tsx       # deck.gl wrapper
│   │   │   │   ├── LassoSelection.tsx     # Lasso-to-filter bridge
│   │   │   │   └── HoverThumbnail.tsx     # Point hover preview
│   │   │   │
│   │   │   ├── filters/            # Sidebar filter controls
│   │   │   │   ├── FilterPanel.tsx
│   │   │   │   └── FilterChip.tsx
│   │   │   │
│   │   │   └── detail/             # Image detail viewer
│   │   │       ├── DetailView.tsx
│   │   │       └── MetadataPanel.tsx
│   │   │
│   │   ├── stores/                 # Zustand state management
│   │   │   ├── useDatasetStore.ts  # Active dataset, samples list
│   │   │   ├── useFilterStore.ts   # Active filters, selected IDs
│   │   │   └── useViewStore.ts     # Grid/map sync, view mode
│   │   │
│   │   ├── hooks/                  # Data fetching and sync
│   │   │   ├── useSamples.ts       # Paginated sample fetching
│   │   │   ├── useEmbeddings.ts    # Embedding data loading
│   │   │   └── useSearch.ts        # Similarity search queries
│   │   │
│   │   ├── lib/
│   │   │   ├── api.ts              # API client (typed fetch wrapper)
│   │   │   └── colors.ts           # Deterministic class-to-color hashing
│   │   │
│   │   └── types/                  # Shared TypeScript types
│   │       └── index.ts
│   │
│   ├── package.json
│   ├── tailwind.config.ts
│   └── next.config.ts
│
├── plugins/                        # User/community plugins directory
│   └── example_plugin/
│       ├── __init__.py
│       └── plugin.yaml
│
└── docker-compose.yml              # Backend + Qdrant + (optional) imgproxy
```

### Structure Rationale

- **backend/app/routers/:** Clean separation of API endpoints by domain. Each router is independently testable and maps to one area of the frontend.
- **backend/app/services/:** Business logic isolated from HTTP concerns. The `query_service.py` is the critical coordinator that joins DuckDB and Qdrant results.
- **backend/app/repositories/:** Data access abstraction. DuckDB and Qdrant have very different APIs; the repository pattern normalizes them for the service layer.
- **backend/app/ingestion/:** Parser-per-format design with a shared `BaseParser` interface. Adding a new format means adding one file.
- **frontend/src/stores/:** Zustand stores are the cross-filtering backbone. The filter store is subscribed to by both the grid and the map, enabling linked views.
- **frontend/src/components/grid/ and map/:** These are the two primary views. They share state through Zustand but are otherwise decoupled.
- **plugins/:** External directory scanned at startup. Keeps user extensions separate from core code.

---

## Architectural Patterns

### Pattern 1: Dual-Database Query Coordination

**What:** A service layer that routes queries to either DuckDB (metadata/analytical) or Qdrant (vector similarity), and can combine results from both for hybrid queries.

**When to use:** Any query that involves both metadata filters AND vector similarity, such as "find images similar to X that are also labeled as 'car' with confidence < 0.5."

**Trade-offs:**
- Pro: Each database does what it is optimized for -- DuckDB for columnar analytical queries, Qdrant for HNSW vector search with payload filters
- Pro: No need to replicate all metadata into Qdrant payloads or add vector search to DuckDB
- Con: Hybrid queries require a join step in application code
- Con: Sample IDs must be consistent across both databases (critical invariant)

**How it works:**

```python
# backend/app/services/query_service.py

class QueryService:
    """Coordinates queries across DuckDB and Qdrant.

    The key insight: DuckDB is the source of truth for sample metadata.
    Qdrant is the source of truth for vector embeddings. Both share
    the same sample_id as the join key.

    Query routing logic:
    - Metadata-only queries -> DuckDB directly
    - Similarity-only queries -> Qdrant directly
    - Hybrid queries -> Qdrant first (narrower result set), then DuckDB for enrichment
    """

    def __init__(self, duckdb_repo: DuckDBRepo, qdrant_repo: QdrantRepo):
        self.duckdb = duckdb_repo
        self.qdrant = qdrant_repo

    async def query_samples(
        self,
        dataset_id: str,
        filters: SampleFilter | None = None,
        similar_to: str | None = None,  # sample_id for similarity
        limit: int = 100,
        offset: int = 0,
    ) -> PaginatedSamples:
        """
        Routing logic:
        1. If only filters -> DuckDB
        2. If only similar_to -> Qdrant (with optional payload filter)
        3. If both -> Qdrant for candidate IDs, then DuckDB for full records
        """
        if similar_to and not filters:
            # Pure similarity search
            results = await self.qdrant.search_similar(
                dataset_id, similar_to, limit=limit
            )
            sample_ids = [r.id for r in results]
            return await self.duckdb.get_samples_by_ids(sample_ids)

        if filters and not similar_to:
            # Pure metadata query
            return await self.duckdb.query_samples(
                dataset_id, filters, limit=limit, offset=offset
            )

        # Hybrid: similarity + metadata
        # Strategy: Use Qdrant's payload filtering for simple filters,
        # fall back to DuckDB post-filter for complex analytical queries
        if self._can_push_to_qdrant(filters):
            qdrant_filter = self._to_qdrant_filter(filters)
            results = await self.qdrant.search_similar(
                dataset_id, similar_to,
                filter=qdrant_filter, limit=limit
            )
            sample_ids = [r.id for r in results]
            return await self.duckdb.get_samples_by_ids(sample_ids)
        else:
            # Complex filter: get Qdrant candidates, then filter in DuckDB
            candidates = await self.qdrant.search_similar(
                dataset_id, similar_to, limit=limit * 3  # over-fetch
            )
            candidate_ids = [r.id for r in candidates]
            return await self.duckdb.query_samples_with_ids(
                dataset_id, filters, candidate_ids, limit=limit
            )
```

**Confidence:** HIGH -- This pattern is well-established. The Quiver project (Go-based) uses DuckDB for SQL filtering + HNSW for vector search with Apache Arrow bridging. Qdrant's own documentation explicitly supports payload filtering during vector search, making simple hybrid queries pushable to Qdrant alone.

### Pattern 2: Cursor-per-Request DuckDB Connection Management

**What:** A single DuckDB connection is created at application startup. Each FastAPI request gets a cursor from that connection via dependency injection.

**When to use:** All DuckDB access in the FastAPI application. This is the officially documented pattern for multithreaded Python access.

**Trade-offs:**
- Pro: Thread-safe reads and writes within a single process (DuckDB's MVCC handles this)
- Pro: Minimal overhead -- no connection pool manager needed
- Con: Single-process only -- cannot have multiple FastAPI workers writing to the same DuckDB file
- Con: Appends never conflict, but concurrent row updates to the same row will fail

**How it works:**

```python
# backend/app/dependencies.py

import duckdb
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends

_duckdb_conn: duckdb.DuckDBPyConnection | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _duckdb_conn
    _duckdb_conn = duckdb.connect("data/visionlens.duckdb")
    _duckdb_conn.execute("PRAGMA threads=4")
    yield
    _duckdb_conn.close()

def get_duckdb_cursor():
    """Each request gets its own cursor (thread-local connection)."""
    cursor = _duckdb_conn.cursor()
    try:
        yield cursor
    finally:
        cursor.close()

# Usage in routers:
@router.get("/samples")
async def list_samples(cursor=Depends(get_duckdb_cursor)):
    return cursor.execute("SELECT * FROM samples LIMIT 100").fetchall()
```

**Confidence:** HIGH -- This is DuckDB's officially documented threading pattern. Verified via https://duckdb.org/docs/stable/guides/python/multiple_threads and the GitHub discussion on FastAPI concurrency (duckdb/duckdb#13719).

**Critical constraint:** Run FastAPI with a single worker (1 Uvicorn process). DuckDB does not support multi-process writes. Use `--workers 1` and rely on DuckDB's internal parallelism (vectorized execution, multiple threads per query) for performance. For read-heavy workloads, additional read-only workers could connect to the same file.

### Pattern 3: Cross-Filtering via Shared Client State

**What:** A Zustand store holds the current selection state (active filters, selected sample IDs, view bounds). Both the grid view and embedding map subscribe to this store and react to changes, creating linked views without direct component coupling.

**When to use:** Any time the user's selection in one view (e.g., lasso on embedding map) should filter another view (e.g., grid shows only selected images).

**Trade-offs:**
- Pro: Decoupled components -- grid and map don't know about each other
- Pro: Zustand is ~1KB, SSR-compatible, and requires no providers/context wrappers
- Pro: Optimistic UI updates (filter immediately, fetch in background)
- Con: Large selection sets (10K+ IDs) in client state may need pagination or ID-range compression

**How it works:**

```typescript
// frontend/src/stores/useFilterStore.ts

import { create } from 'zustand';

interface FilterState {
  // Active metadata filters
  filters: Record<string, string | number | string[]>;

  // IDs selected via lasso or click in any view
  selectedIds: Set<string> | null;  // null = no selection (show all)

  // Source of the selection (for UI hints)
  selectionSource: 'grid' | 'map' | 'filter' | null;

  // Actions
  setFilter: (key: string, value: string | number | string[]) => void;
  clearFilter: (key: string) => void;
  setSelectedIds: (ids: Set<string>, source: 'grid' | 'map') => void;
  clearSelection: () => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  filters: {},
  selectedIds: null,
  selectionSource: null,

  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
      selectedIds: null,  // Clear spatial selection when filters change
    })),

  setSelectedIds: (ids, source) =>
    set({ selectedIds: ids, selectionSource: source }),

  clearSelection: () =>
    set({ selectedIds: null, selectionSource: null }),
}));

// Grid subscribes to filter changes
// Map subscribes to filter changes
// Both can SET selectedIds (lasso from map, shift-click from grid)
// When selectedIds changes, both views update to reflect the selection
```

**Confidence:** HIGH -- This is the standard cross-filtering pattern used in dashboards. FiftyOne uses a similar approach (Recoil atoms in their React frontend). Zustand is the recommended state manager for Next.js apps in 2025-2026 due to its simplicity and SSR compatibility.

### Pattern 4: Pluggable Ingestion Parsers

**What:** An abstract `BaseParser` class defines the contract for annotation format parsers. Each format (COCO, YOLO, VOC) is a concrete implementation. New formats are added by implementing one class.

**When to use:** All dataset ingestion. Format auto-detection selects the appropriate parser.

**Trade-offs:**
- Pro: Adding a new format is a single file
- Pro: Each parser is independently testable
- Pro: Plugins can register custom parsers via the hook system
- Con: Format auto-detection has edge cases (e.g., YOLO with no `classes.txt`)

```python
# backend/app/ingestion/base_parser.py

from abc import ABC, abstractmethod
from pathlib import Path
from app.models.sample import SampleCreate, AnnotationCreate

class BaseParser(ABC):
    """Contract for all annotation format parsers."""

    @abstractmethod
    def can_parse(self, path: Path) -> bool:
        """Returns True if this parser can handle the given path."""
        ...

    @abstractmethod
    def parse(self, path: Path) -> Iterator[SampleCreate]:
        """Yields normalized sample records from the source format."""
        ...

    @abstractmethod
    def detect_classes(self, path: Path) -> list[str]:
        """Extracts the class list from the dataset."""
        ...

# Each format: COCOParser(BaseParser), YOLOParser(BaseParser), VOCParser(BaseParser)
# Registration: PARSERS = [COCOParser(), YOLOParser(), VOCParser()]
# Detection: first parser where can_parse(path) returns True wins
```

**Confidence:** HIGH -- This is a well-known strategy pattern. FiftyOne and SuperAnnotate both use similar approaches for multi-format ingestion.

### Pattern 5: Image Proxy for Thumbnail Serving

**What:** Instead of serving full-resolution images for the grid, a lightweight image endpoint generates and caches thumbnails on the fly.

**When to use:** Grid view with 100K+ images. Loading full-resolution images for thumbnail display wastes bandwidth and memory.

**Trade-offs:**
- Pro: 50-100x bandwidth reduction (full image: 2-5MB; thumbnail: 20-50KB)
- Pro: Can serve from local disk or GCS transparently
- Con: First load of a thumbnail incurs generation latency (mitigated by pre-generation during ingestion or LRU cache)
- Con: Additional service complexity (can use imgproxy or build a simple FastAPI endpoint with Pillow/libvips)

**Recommended approach for v1:** Build a simple FastAPI thumbnail endpoint that resizes on-the-fly with an LRU disk cache. Defer imgproxy to later when serving at higher scale.

```python
# backend/app/routers/images.py

@router.get("/images/{dataset_id}/{sample_id}")
async def get_image(
    dataset_id: str,
    sample_id: str,
    width: int = Query(default=256),
    storage: StorageRepo = Depends(get_storage),
):
    """Serves resized images. Checks cache first, generates if missing."""
    cache_path = CACHE_DIR / f"{sample_id}_{width}.webp"
    if cache_path.exists():
        return FileResponse(cache_path, media_type="image/webp")

    original = await storage.get_image(dataset_id, sample_id)
    thumbnail = resize_image(original, width=width, format="webp")
    thumbnail.save(cache_path)
    return FileResponse(cache_path, media_type="image/webp")
```

**Confidence:** MEDIUM-HIGH -- imgproxy (Go-based, libvips-backed) is the gold standard for this pattern, verified via official docs. For a personal tool, a Pillow-based FastAPI endpoint is simpler and sufficient for 100K images.

---

## Data Flow

### Flow 1: Dataset Ingestion

```
User uploads dataset path (local or GCS URI)
    |
    v
POST /datasets { path, format? }
    |
    v
DatasetService.ingest()
    |
    ├─> Auto-detect format (try each parser's can_parse())
    |
    ├─> Selected parser.parse(path) yields SampleCreate records
    |   Each record: { filepath, metadata, annotations[] }
    |
    ├─> DuckDB: CREATE TABLE, bulk INSERT samples + annotations
    |   (DuckDB excels at bulk inserts -- columnar append)
    |
    ├─> Storage: validate image paths exist (local) or are accessible (GCS)
    |
    ├─> [Optional] Trigger embedding computation job (async)
    |
    └─> PluginManager.run_hook("post_ingestion", dataset)
         (Plugins can add derived metadata, validate, transform)
```

### Flow 2: Browsing with Filters (Metadata-Only Query)

```
User adjusts sidebar filters (class="car", split="train", confidence < 0.8)
    |
    v
Zustand FilterStore updates -> triggers useSamples() refetch
    |
    v
GET /samples?dataset_id=X&class=car&split=train&confidence_lt=0.8&limit=100&offset=0
    |
    v
QueryService: metadata-only -> routes to DuckDB
    |
    v
DuckDB: SELECT with WHERE clause on indexed columns
    |
    v
Response: { samples: [...], total: 45230, page: 1 }
    |
    v
Grid View: renders visible tiles (TanStack Virtual)
    Each visible tile: GET /images/{dataset_id}/{sample_id}?width=256
    |
    v
Embedding Map: highlights filtered points (if embeddings loaded)
```

### Flow 3: Embedding Visualization + Lasso Selection

```
User opens Embedding Map panel
    |
    v
GET /embeddings/{dataset_id}?reduction=umap
    |
    v
EmbeddingService: check if pre-computed
    ├─ YES: return cached 2D/3D coordinates from DuckDB
    └─ NO:  return 404, prompt user to compute first
    |
    v
Frontend: deck.gl ScatterplotLayer renders N points
    (100K points = fine at 60fps; 1M = fine for pan/zoom)
    |
    v
User lassos a cluster of points
    |
    v
deck.gl onSelect -> extract point IDs -> FilterStore.setSelectedIds(ids, 'map')
    |
    v
Grid View: subscribes to FilterStore
    -> GET /samples?ids=id1,id2,...idN (or POST with ID list)
    -> Shows only lassoed images in grid
    |
    v
Map: highlights selected points, dims others
```

### Flow 4: Similarity Search (Hybrid Query)

```
User right-clicks image -> "Find Similar"
    |
    v
POST /search/similar { sample_id: "abc123", filters: { class: "car" }, limit: 50 }
    |
    v
QueryService: hybrid query
    |
    ├─> Qdrant: search_similar(sample_id, filter={ class: "car" }, limit=50)
    |   Uses Qdrant's filterable HNSW -- payload filter pushdown
    |   Returns: [{ id, score, payload }]
    |
    ├─> DuckDB: enrich results with full sample metadata
    |   SELECT * FROM samples WHERE id IN (id1, id2, ...) ORDER BY ...
    |
    └─> Response: [{ sample, similarity_score, metadata }]
    |
    v
Grid View: shows results sorted by similarity
Embedding Map: highlights result points
```

### Flow 5: GT vs Predictions Comparison

```
User toggles "Show Predictions" overlay
    |
    v
Frontend: AnnotationOverlay renders two layers per image tile:
    - Ground Truth:  solid lines, filled labels
    - Predictions:   dashed lines, + confidence score
    |
    v
Both use same color mapping: hash(class_name) -> deterministic HSL color
    "car"   -> always #E74C3C across all sessions
    "person" -> always #3498DB across all sessions
    |
    v
Data model in DuckDB:
    annotations table:
      - sample_id (FK)
      - source: "ground_truth" | "prediction"
      - class_name: str
      - bbox: [x, y, w, h]
      - confidence: float (null for GT)
      - model_name: str (null for GT)
```

### Flow 6: Embedding Computation (Async/GPU)

```
POST /embeddings/compute { dataset_id, model: "clip-vit-b-32" }
    |
    v
EmbeddingService: launches background task
    |
    ├─> Iterate samples in batches (batch_size=64 for GPU efficiency)
    |
    ├─> Model inference: CLIP/DINOv2/etc -> 512-2048 dim embeddings
    |   (GPU required; runs on local CUDA or cloud GPU)
    |
    ├─> Qdrant: upsert vectors with sample_id + minimal payload
    |   payload = { dataset_id, class_name, split }  <- for Qdrant-side filtering
    |
    ├─> Dimensionality reduction: UMAP/t-SNE on full embedding matrix
    |   -> 2D/3D coordinates
    |
    ├─> DuckDB: store 2D/3D coordinates in embeddings table
    |   (coordinates are small; used for map rendering)
    |
    └─> Return: job status endpoint for frontend polling
```

### State Management Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    Zustand Store Architecture                     │
│                                                                   │
│  useDatasetStore          useFilterStore          useViewStore    │
│  ┌─────────────┐          ┌─────────────┐        ┌────────────┐ │
│  │ activeDataset│         │ filters{}   │        │ viewMode   │ │
│  │ sampleCount │  ─────> │ selectedIds │ <───── │ (grid/map) │ │
│  │ schema      │         │ selSource   │        │ splitView  │ │
│  └─────────────┘         └──────┬──────┘        └────────────┘ │
│                                  │                               │
│         ┌────────────────────────┼──────────────────────┐        │
│         v                        v                      v        │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐ │
│  │  ImageGrid   │   │  EmbeddingMap    │   │  DetailView      │ │
│  │  (consumer)  │   │  (consumer +     │   │  (consumer)      │ │
│  │              │   │   producer via    │   │                  │ │
│  │              │   │   lasso select)   │   │                  │ │
│  └──────────────┘   └──────────────────┘   └──────────────────┘ │
│                                                                   │
│  Data flow:                                                      │
│  Filter change -> store update -> all consumers re-render        │
│  Lasso select  -> store.setSelectedIds -> grid + map update     │
│  Click sample  -> store.setSelectedIds([id]) -> detail opens     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **1K-10K images** | Everything works as-is. DuckDB queries sub-second. Qdrant local handles easily. Grid virtualization may not even be necessary but use it anyway for consistency. Embedding computation: minutes on GPU. |
| **10K-100K images** | Virtualized grid is essential. DuckDB still fast (columnar scan of 100K rows is milliseconds). Qdrant local handles fine. Thumbnail caching becomes important. Embedding computation: 10-60 min on single GPU. Frontend must paginate API calls (don't fetch 100K samples at once). deck.gl handles 100K points at 60fps. |
| **100K-1M images** | DuckDB stays fast (this is its sweet spot). Qdrant local may need segment tuning. Thumbnail pre-generation during ingestion recommended. Embedding computation should be parallelized (multiple GPUs or cloud batch). Frontend needs cursor-based pagination for samples. Embedding map still works (deck.gl handles 1M points). ID-set transfers between map selection and grid need compression (bitmap or range encoding). |
| **1M+ images** | DuckDB still handles analytical queries well. Qdrant may need sharding or cloud deployment. Image storage likely must be cloud-only (GCS). Consider pre-computed embedding coordinates stored as Parquet for fast frontend loading. Agent analysis becomes batch-only. Plugin system may need async execution. |

### Scaling Priorities

1. **First bottleneck: Image loading in the grid.** At 100K images, the grid must virtualize and lazy-load thumbnails. Without thumbnails, full-resolution images will saturate bandwidth and memory. The thumbnail endpoint with disk cache solves this.

2. **Second bottleneck: Embedding computation time.** Computing CLIP embeddings for 100K images at batch_size=64 takes ~15-30 minutes on a single GPU. This must be async with progress reporting. Pre-computed embeddings should be importable.

3. **Third bottleneck: Cross-filter ID transfer.** When a lasso selection captures 10K points, transferring 10K IDs via REST and filtering in DuckDB is fine. At 50K+ selected IDs, consider server-side session state or bitmap-encoded ID sets.

4. **Fourth bottleneck: Initial embedding data transfer to frontend.** 100K points x 3 floats (x, y, color) = ~1.2MB. Fine. At 1M points = ~12MB. Use binary ArrayBuffer transfer or Arrow IPC instead of JSON.

---

## Anti-Patterns

### Anti-Pattern 1: Duplicating All Metadata into Qdrant Payloads

**What people do:** Store every metadata field (filepath, all annotations, custom fields) as Qdrant payload so that Qdrant can do all filtering.

**Why it's wrong:** Qdrant payloads are not designed for complex analytical queries. You lose DuckDB's columnar performance for aggregations, JOINs, and ad-hoc SQL. You also create a sync problem -- every metadata update must propagate to both databases.

**Do this instead:** Store minimal payload in Qdrant (dataset_id, class_name, split -- fields commonly used in similarity search filters). Keep DuckDB as the metadata source of truth. Use the Query Coordinator to join results when needed.

### Anti-Pattern 2: Loading All Samples into Frontend State

**What people do:** Fetch all 100K samples on page load and filter client-side using JavaScript array methods.

**Why it's wrong:** 100K sample records with annotations can be 50-200MB of JSON. The browser will OOM or freeze. Even if it loads, client-side filtering is orders of magnitude slower than DuckDB.

**Do this instead:** Paginate all sample queries. The frontend only holds the current page of samples (100-200) plus the embedding coordinates (compact float arrays). All filtering happens server-side in DuckDB. The frontend sends filter parameters, receives filtered pages.

### Anti-Pattern 3: Synchronous Embedding Computation

**What people do:** Make the embedding computation endpoint block until all images are processed, returning results in a single response.

**Why it's wrong:** For 100K images, this takes 15-60 minutes. HTTP connections time out. The user sees no progress. The browser gives up.

**Do this instead:** POST /embeddings/compute returns a job ID immediately. The frontend polls GET /embeddings/jobs/{id} for progress. Or use SSE (Server-Sent Events) for real-time progress updates. The backend processes embeddings asynchronously using a background task (FastAPI BackgroundTasks or a task queue like Celery/ARQ).

### Anti-Pattern 4: Single Shared DuckDB Connection Without Cursors

**What people do:** Use a single `duckdb.connect()` object shared directly across all FastAPI async handlers without creating per-request cursors.

**Why it's wrong:** While DuckDB supports internal parallelism, sharing a single connection object across concurrent async handlers can cause data races. Python's GIL does not protect DuckDB's internal C++ state from interleaved operations.

**Do this instead:** Create one connection at startup, then call `.cursor()` per request (as documented). Each cursor is a thread-local view into the same database. This is the officially documented pattern.

### Anti-Pattern 5: Tight Coupling Between Grid and Map Components

**What people do:** Have the EmbeddingMap component directly import and call methods on the ImageGrid component (or vice versa) to sync selections.

**Why it's wrong:** Creates a bidirectional dependency that makes both components harder to test, modify, or remove. Changes to one break the other.

**Do this instead:** Both components subscribe to the shared Zustand FilterStore. Neither knows the other exists. The store is the mediator. This is the standard cross-filtering pattern used by FiftyOne (Recoil atoms), Looker, and Databricks dashboards.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Qdrant (local)** | Async QdrantClient singleton in FastAPI lifespan; gRPC preferred for performance | Qdrant runs as a separate Docker container. Use named volumes for persistence. |
| **GCS** | `google-cloud-storage` Python client via StorageRepo abstraction | Authenticate via service account JSON or ADC. Lazy-load images; do not download entire dataset. |
| **GPU / CUDA** | Direct PyTorch/ONNX in EmbeddingService; or offload to Cloud Run Jobs | Embedding computation is the only GPU-dependent path. Everything else is CPU-only. |
| **imgproxy (optional)** | HTTP proxy; FastAPI routes image requests through imgproxy URL | Only needed at scale. For v1, use built-in Pillow/libvips thumbnail endpoint. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Frontend <-> Backend** | REST API (JSON); SSE for progress events; Binary ArrayBuffer for embedding coordinates | Use typed API client on frontend (generated from OpenAPI schema or hand-written) |
| **QueryService <-> DuckDB Repo** | Python method calls; SQL strings or builder | DuckDB repo owns all SQL. Service never constructs SQL directly. |
| **QueryService <-> Qdrant Repo** | Python method calls; Qdrant client objects | Qdrant repo owns all vector operations. Service passes filter dicts. |
| **PluginManager <-> Plugins** | Python ABC + hook registration | Plugins implement BasePlugin. Manager calls registered hooks at defined points. |
| **Agent Service <-> VLM** | Pydantic AI agent with tool definitions; calls VLM API (local or remote) | Agent results stored in DuckDB as analysis records. |

---

## Build Order Implications

Based on architectural dependencies, the recommended build order is:

```
Phase 1: Foundation (no dependencies)
├── DuckDB schema + repository
├── BaseParser + COCO parser (most common format)
├── FastAPI app scaffold + sample CRUD endpoints
├── Basic image serving endpoint
└── Next.js shell + API client

Phase 2: Core Browsing (depends on Phase 1)
├── Virtualized image grid (TanStack Virtual)
├── Annotation overlay rendering (GT bboxes)
├── Dynamic sidebar filters
├── Zustand filter store
└── DuckDB-backed filtered pagination

Phase 3: Predictions & Comparison (depends on Phase 2)
├── Prediction ingestion (annotations with source="prediction")
├── GT vs Prediction overlay toggle (solid vs dashed)
├── Deterministic class-to-color hashing
├── Error categorization (TP/FP/FN computation)
└── IoU-based matching between GT and predictions

Phase 4: Embeddings & Vector Search (depends on Phase 1, parallel to Phase 3)
├── Qdrant integration + repository
├── Embedding computation service (CLIP/DINOv2)
├── UMAP/t-SNE dimensionality reduction
├── deck.gl embedding map component
├── Lasso selection -> filter store bridge
└── Similarity search endpoint

Phase 5: Intelligence Layer (depends on Phases 3+4)
├── Query Coordinator (hybrid DuckDB + Qdrant queries)
├── Pydantic AI agent scaffold
├── Blind spot detection agent
├── Error pattern discovery agent
└── Agent results UI

Phase 6: Extensibility (depends on Phase 1, parallel to others)
├── BasePlugin class + hook definitions
├── Plugin discovery and loading
├── YOLO parser, VOC parser (as plugins or built-in)
├── GCS storage backend
└── Plugin UI hooks
```

**Rationale for ordering:**
- Phase 1 establishes the data foundation that everything else depends on.
- Phase 2 delivers the core user-facing value (browsing images with annotations).
- Phase 3 and 4 can proceed in parallel since they have independent dependencies.
- Phase 5 requires both metadata and vector capabilities to be in place.
- Phase 6 (plugins) can begin early but is only valuable once there is a system to extend.

---

## Key Architectural Decisions

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| DuckDB as metadata store | **Confirmed** | Columnar storage excels at analytical queries over 100K+ rows. In-process means zero network overhead. Single-file database simplifies deployment. |
| Qdrant for vectors | **Confirmed** | Payload filtering during HNSW search enables hybrid queries without app-level joins for simple cases. Local deployment via Docker. Async Python client. |
| Separate databases, not unified | **Confirmed** | Each DB does what it's best at. The Query Coordinator is simpler than trying to make one DB do everything. |
| Zustand over Redux/Recoil | **Recommended** | ~1KB, no providers needed, SSR-compatible. Perfect for the cross-filtering use case. FiftyOne uses Recoil but Zustand is the modern choice. |
| TanStack Virtual over react-window | **Recommended** | Modern, lightweight (10-15KB), supports grid layouts natively, actively maintained. |
| Single FastAPI worker | **Required** | DuckDB constraint -- single writer process. Use DuckDB's internal parallelism instead. |
| Thumbnail endpoint over imgproxy | **Recommended for v1** | Simpler deployment. Pillow-based resize with disk cache. Upgrade to imgproxy later if needed. |
| REST over GraphQL | **Recommended** | Simpler implementation. The query patterns (filtered lists, similarity search) map well to REST. FiftyOne uses GraphQL but it adds complexity without clear benefit for this use case. |

---

## Sources

### HIGH Confidence (Official Documentation)
- [DuckDB Concurrency Documentation](https://duckdb.org/docs/stable/connect/concurrency) -- Single-writer, cursor-per-thread pattern
- [DuckDB Multiple Python Threads](https://duckdb.org/docs/stable/guides/python/multiple_threads) -- `.cursor()` pattern for thread safety
- [Qdrant Search API](https://qdrant.tech/documentation/concepts/search/) -- Payload-filtered vector search
- [Qdrant Filtering](https://qdrant.tech/documentation/concepts/filtering/) -- Must/should/must_not filter clauses
- [deck.gl Performance Guide](https://deck.gl/docs/developer-guide/performance) -- 1M points at 60fps, optimization strategies

### MEDIUM Confidence (Verified with Multiple Sources)
- [FiftyOne Architecture via DeepWiki](https://deepwiki.com/voxel51/fiftyone/1.1-installation-and-setup) -- MongoDB backend, React frontend, GraphQL API
- [FiftyOne Plugin System](https://docs.voxel51.com/plugins/developing_plugins.html) -- Panels, operators, components pattern
- [FiftyOne Image Embeddings](https://docs.voxel51.com/tutorials/image_embeddings.html) -- Embedding computation and visualization flow
- [Qdrant Python Client via DeepWiki](https://deepwiki.com/qdrant/qdrant-client/1-overview) -- Layered architecture, async support
- [Qdrant FastAPI Singleton Pattern](https://softlandia.com/articles/deploying-qdrant-with-grpc-auth-on-azure-a-fastapi-singleton-client-guide) -- Lifespan-scoped client
- [DuckDB FastAPI Concurrency Discussion](https://github.com/duckdb/duckdb/discussions/13719) -- Named memory, SQL DDL vs registration

### LOW Confidence (WebSearch Only, Needs Validation)
- Quiver (DuckDB + HNSW hybrid) -- Referenced in MotherDuck blog but not verified with primary source
- TanStack Virtual grid performance claims -- Based on documentation claims, not benchmarked
- Pillow thumbnail generation performance at 100K scale -- Assumed sufficient based on imgproxy precedent

---
*Architecture research for: VisionLens -- CV Dataset Introspection Tool*
*Researched: 2026-02-10*
