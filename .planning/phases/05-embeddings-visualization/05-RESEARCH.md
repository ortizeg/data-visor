# Phase 5: Embeddings & Visualization - Research

**Researched:** 2026-02-11
**Domain:** Image embeddings, dimensionality reduction, WebGL scatter plot visualization, lasso selection
**Confidence:** MEDIUM-HIGH

## Summary

Phase 5 adds image embedding generation, 2D dimensionality reduction, and an interactive scatter plot with lasso selection. The phase spans the full stack: a Python embedding pipeline (SigLIP 2 or DINOv2 via Hugging Face Transformers), UMAP for 2D reduction, DuckDB FLOAT arrays for storage (not Qdrant -- see rationale), SSE for progress streaming, deck.gl with OrthographicView for the scatter plot, and a custom SVG-overlay lasso tool for filtering.

The key architectural decision is **storage**: the roadmap mentions Qdrant, but since this project already uses DuckDB and the embedding use case is purely "store, reduce, render" (no similarity search at query time), storing embeddings as DuckDB `FLOAT[N]` columns is simpler and avoids adding a second data store. If similarity search is needed later, DuckDB's experimental VSS extension provides HNSW indexing on ARRAY columns. Qdrant remains a valid upgrade path if the project evolves toward nearest-neighbor search workloads.

**Primary recommendation:** Use DINOv2-base (768-dim, 86M params) as the default embedding model via Hugging Face Transformers, store embeddings in DuckDB as `FLOAT[768]`, reduce with umap-learn, visualize with deck.gl OrthographicView + ScatterplotLayer, and implement lasso selection as a custom SVG overlay with `robust-point-in-polygon` for hit testing.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `transformers` | >=5.1.0 | Load SigLIP 2 / DINOv2 models | Hugging Face is the standard for pretrained vision models; both models have first-class support |
| `torch` | >=2.5 | Model inference backend | Required by transformers for vision models |
| `umap-learn` | 0.5.11 | Dimensionality reduction (high-D -> 2D) | Scikit-learn compatible API, better scaling than t-SNE, preserves global structure |
| `sse-starlette` | 3.2.0 | Server-Sent Events for progress streaming | Production-ready SSE for Starlette/FastAPI; simpler than WebSocket for unidirectional progress |
| `@deck.gl/core` | ^9.2 | WebGL visualization engine | Industry standard for large-scale GPU-accelerated data visualization |
| `@deck.gl/layers` | ^9.2 | ScatterplotLayer for 2D point rendering | Built-in layer with picking, hover, zoom, pan support |
| `@deck.gl/react` | ^9.2 | React wrapper for deck.gl | Official React integration; designed for React from the ground up |
| `robust-point-in-polygon` | ^1.0 | Point-in-polygon testing for lasso | Numerically robust; standard for lasso selection hit testing |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `Pillow` | >=12.1 (already installed) | Image loading/preprocessing | Feed images to embedding model |
| `numpy` | (transitive dep) | Array operations for embeddings | Embedding vectors, UMAP input/output |
| `pynndescent` | (transitive dep of umap-learn) | Fast approximate nearest neighbors | Installed automatically; accelerates UMAP's neighbor graph construction |
| `@types/robust-point-in-polygon` | latest | TypeScript types | Type safety for point-in-polygon |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DuckDB FLOAT[] storage | Qdrant vector DB | Qdrant adds a second data store; overkill when not doing similarity search at query time. Use if nearest-neighbor search becomes a requirement. |
| SSE (sse-starlette) | WebSocket | WebSocket is bidirectional but progress is unidirectional (server->client). SSE is simpler, uses standard HTTP, auto-reconnects in browsers via EventSource. |
| umap-learn | scikit-learn t-SNE | t-SNE is O(n^2) and doesn't preserve global structure well; UMAP scales linearly and supports transform() for new data |
| DINOv2-base | SigLIP 2 base | SigLIP 2 adds text-image alignment (768-dim) but DINOv2-base produces richer visual features for clustering/similarity. For pure embedding visualization, DINOv2 is preferred. Both should be benchmarked during implementation. |
| DINOv2-base | DINOv2-small (384-dim) | Smaller model (21M params) = faster inference, but lower quality embeddings. Good fallback for resource-constrained environments. |
| Custom lasso on canvas | @deck.gl-community/editable-layers | editable-layers is the nebula.gl successor but lacks maintainers and has incomplete React support. Custom SVG overlay is more reliable. |

**Installation:**

Backend:
```bash
uv add transformers torch umap-learn sse-starlette
```

Frontend:
```bash
npm install @deck.gl/core @deck.gl/layers @deck.gl/react robust-point-in-polygon @types/robust-point-in-polygon
```

## Architecture Patterns

### Recommended Project Structure

```
app/
├── services/
│   ├── embedding_service.py    # Model loading, batch inference, progress tracking
│   └── reduction_service.py    # UMAP fit_transform, caching reduced coordinates
├── routers/
│   └── embeddings.py           # REST + SSE endpoints for embed/reduce/fetch
├── models/
│   └── embedding.py            # Pydantic models for embedding requests/responses

frontend/src/
├── components/
│   └── embedding/
│       ├── embedding-scatter.tsx    # DeckGL + ScatterplotLayer + OrthographicView
│       ├── lasso-overlay.tsx        # SVG overlay for freehand lasso drawing
│       └── hover-thumbnail.tsx      # Thumbnail tooltip on point hover
├── hooks/
│   ├── use-embeddings.ts           # TanStack Query hook for 2D coordinates
│   └── use-embedding-progress.ts   # EventSource hook for SSE progress
├── stores/
│   └── embedding-store.ts          # Zustand: lasso selection state, selected point IDs
```

### Pattern 1: DuckDB FLOAT Array Column for Embeddings

**What:** Store high-dimensional embeddings and 2D reduced coordinates directly in DuckDB using fixed-size FLOAT arrays.
**When to use:** When the only embedding operations are store, reduce, and render (no real-time similarity search).
**Example:**

```python
# Schema addition in duckdb_repo.py initialize_schema()
self.connection.execute("""
    CREATE TABLE IF NOT EXISTS embeddings (
        sample_id       VARCHAR NOT NULL,
        dataset_id      VARCHAR NOT NULL,
        model_name      VARCHAR NOT NULL,
        vector          FLOAT[768],
        x               DOUBLE,
        y               DOUBLE
    )
""")
```

```python
# Batch insert embeddings
import numpy as np

def store_embeddings(cursor, dataset_id: str, sample_ids: list[str],
                     vectors: np.ndarray, model_name: str):
    """Store embedding vectors. vectors shape: (N, dim)."""
    rows = [
        (sid, dataset_id, model_name, vec.tolist(), None, None)
        for sid, vec in zip(sample_ids, vectors)
    ]
    cursor.executemany(
        "INSERT INTO embeddings VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
```

### Pattern 2: Background Embedding with SSE Progress

**What:** Run embedding generation as an asyncio background task, stream progress via Server-Sent Events.
**When to use:** Embedding generation takes minutes for large datasets; user needs progress feedback.
**Example:**

```python
# Backend: SSE endpoint
import asyncio
from sse_starlette.sse import EventSourceResponse

# In-memory task state (per-dataset)
embedding_tasks: dict[str, dict] = {}

@router.post("/datasets/{dataset_id}/embeddings/generate")
async def start_embedding(dataset_id: str, background_tasks: BackgroundTasks):
    """Kick off embedding generation."""
    embedding_tasks[dataset_id] = {"progress": 0, "status": "running", "total": 0}
    background_tasks.add_task(generate_embeddings, dataset_id)
    return {"status": "started"}

@router.get("/datasets/{dataset_id}/embeddings/progress")
async def embedding_progress(dataset_id: str):
    """SSE stream of embedding progress."""
    async def event_generator():
        while True:
            task = embedding_tasks.get(dataset_id, {})
            yield {"data": json.dumps(task)}
            if task.get("status") in ("complete", "error"):
                break
            await asyncio.sleep(0.5)
    return EventSourceResponse(event_generator())
```

```typescript
// Frontend: EventSource hook
function useEmbeddingProgress(datasetId: string, enabled: boolean) {
  const [progress, setProgress] = useState({ progress: 0, total: 0, status: "idle" });

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(
      `${API_BASE}/datasets/${datasetId}/embeddings/progress`
    );
    source.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setProgress(data);
      if (data.status === "complete" || data.status === "error") {
        source.close();
      }
    };
    return () => source.close();
  }, [datasetId, enabled]);

  return progress;
}
```

### Pattern 3: deck.gl OrthographicView for Non-Geo 2D Scatter Plot

**What:** Use OrthographicView (not MapView) for embedding scatter plots since data is non-geographic.
**When to use:** Any 2D scatter plot of abstract data (embeddings, PCA, t-SNE, UMAP output).
**Example:**

```tsx
import { DeckGL } from "@deck.gl/react";
import { OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0],
  zoom: 1,
  minZoom: -2,
  maxZoom: 10,
};

function EmbeddingScatter({ points, onHover, onSelect }: Props) {
  const layer = new ScatterplotLayer({
    id: "embedding-scatter",
    data: points,
    getPosition: (d) => [d.x, d.y, 0],
    getRadius: 3,
    radiusMinPixels: 2,
    radiusMaxPixels: 8,
    getFillColor: (d) => d.color ?? [100, 100, 200, 200],
    pickable: true,
    onHover: (info) => onHover?.(info),
    autoHighlight: true,
    highlightColor: [255, 200, 0, 200],
  });

  return (
    <DeckGL
      views={new OrthographicView({ id: "ortho", controller: true })}
      initialViewState={INITIAL_VIEW_STATE}
      layers={[layer]}
      getTooltip={({ object }) =>
        object && { text: object.fileName, style: { ... } }
      }
    />
  );
}
```

### Pattern 4: SVG Overlay Lasso Selection

**What:** Draw a freehand polygon on an SVG overlay positioned on top of the deck.gl canvas, then test which scatter points fall inside using robust-point-in-polygon.
**When to use:** Lasso selection is not built into deck.gl. Custom implementation via SVG overlay is the most reliable approach.
**Example:**

```tsx
import classifyPoint from "robust-point-in-polygon";

function LassoOverlay({ points, onSelect, viewState }: Props) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [path, setPath] = useState<[number, number][]>([]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDrawing(true);
    setPath([[e.clientX, e.clientY]]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing) return;
    setPath((prev) => [...prev, [e.clientX, e.clientY]]);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    if (path.length < 3) return;

    // Convert screen coords to data coords, then test each point
    const selected = points.filter((p) => {
      const screenPos = projectToScreen(p.x, p.y, viewState);
      return classifyPoint(path, screenPos) <= 0; // -1 = inside, 0 = boundary
    });
    onSelect(selected.map((p) => p.sampleId));
  };

  const pathStr = path.map((p) => p.join(",")).join(" ");

  return (
    <svg className="absolute inset-0 z-10 cursor-crosshair" style={{ pointerEvents: isDrawing ? "all" : "none" }}>
      {path.length > 0 && (
        <polyline points={pathStr} fill="rgba(99,102,241,0.15)" stroke="#6366f1" strokeWidth={2} />
      )}
    </svg>
  );
}
```

### Pattern 5: Cross-Filter Lasso to Grid via Zustand

**What:** Store lasso-selected sample IDs in Zustand, include them in the filter store's query key so TanStack Query refetches the grid with only selected samples.
**When to use:** When lasso selection on the scatter plot should filter the image grid.
**Example:**

```typescript
// embedding-store.ts
interface EmbeddingState {
  lassoSelectedIds: string[] | null; // null = no lasso active
  setLassoSelectedIds: (ids: string[] | null) => void;
  clearLasso: () => void;
}

export const useEmbeddingStore = create<EmbeddingState>((set) => ({
  lassoSelectedIds: null,
  setLassoSelectedIds: (ids) => set({ lassoSelectedIds: ids }),
  clearLasso: () => set({ lassoSelectedIds: null }),
}));
```

```typescript
// In filter-store.ts or use-samples.ts, include lasso IDs in query params
const lassoIds = useEmbeddingStore((s) => s.lassoSelectedIds);
// Pass as query param: ?sample_ids=id1,id2,id3 (or POST body for large sets)
```

### Anti-Patterns to Avoid

- **Loading full embeddings to frontend:** Never send 768-dim vectors to the browser. Only send 2D (x, y) coordinates + metadata. High-dim embeddings stay server-side.
- **Synchronous embedding generation:** Never block the API request. Always run embedding as a background task with progress streaming.
- **Using MapView for non-geo data:** MapView expects lat/lng coordinates and adds unnecessary tile-loading overhead. Use OrthographicView for abstract 2D data.
- **Rebuilding Deck instance on every render:** Layer objects are diffed by deck.gl. Create layers in useMemo and let deck.gl handle updates via shallow comparison.
- **Appending to data arrays:** Creating a new array by spreading existing data forces deck.gl to rebuild all GPU buffers. Use separate layers per data chunk or replace the entire data reference.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Image embedding extraction | Custom CNN feature extractor | Hugging Face Transformers + DINOv2/SigLIP 2 | Pretrained ViTs produce superior embeddings; custom models require training data |
| Dimensionality reduction | Custom t-SNE or PCA-only pipeline | umap-learn | UMAP handles neighbor graph construction, optimization, and scaling; hand-rolling is months of work |
| Point-in-polygon testing | Ray-casting from scratch | robust-point-in-polygon | Edge cases (collinear points, floating point precision) make naive implementations buggy |
| SSE streaming | Raw streaming response | sse-starlette EventSourceResponse | Handles W3C SSE spec compliance, client disconnect detection, graceful shutdown |
| WebGL scatter plot | Canvas 2D or SVG scatter | deck.gl ScatterplotLayer | GPU-accelerated; handles 1M+ points at 60fps; built-in picking/hover |

**Key insight:** Every component in this phase has well-tested libraries. The only custom code needed is the lasso overlay (SVG drawing + wiring to point-in-polygon) and the glue between components.

## Common Pitfalls

### Pitfall 1: Model Loading Latency on First Request

**What goes wrong:** First embedding request downloads a 350MB+ model from Hugging Face Hub, causing a multi-minute timeout.
**Why it happens:** Transformers lazy-loads models on first use.
**How to avoid:** Pre-download models during deployment/setup. Load the model once at app startup (in the lifespan context manager), store on `app.state`.
**Warning signs:** First request takes >30 seconds; subsequent requests are fast.

### Pitfall 2: OOM During Batch Embedding

**What goes wrong:** Trying to embed all images at once exhausts GPU/CPU memory.
**Why it happens:** Each image becomes a (3, 224, 224) tensor; 10k images = ~14GB in a single batch.
**How to avoid:** Process in batches of 32-64 images. Use `torch.no_grad()` to disable gradient tracking. Clear CUDA cache between batches if using GPU.
**Warning signs:** Process killed by OS (OOM killer), Python MemoryError.

### Pitfall 3: UMAP Reproducibility

**What goes wrong:** UMAP produces different layouts on every run, confusing users.
**Why it happens:** UMAP uses random initialization and stochastic gradient descent.
**How to avoid:** Always set `random_state=42` (or any fixed seed). Store reduced coordinates in DuckDB so the same reduction is served consistently.
**Warning signs:** Scatter plot looks completely different on page reload.

### Pitfall 4: WebGL Context Loss

**What goes wrong:** deck.gl canvas goes black after tab backgrounding, sleep, or GPU memory pressure.
**Why it happens:** Browser reclaims WebGL context under memory pressure. deck.gl does not auto-recover.
**How to avoid:** Listen for `webglcontextlost` event on the canvas. On context loss, save current viewState, remount the DeckGL component (React key change), restore viewState.
**Warning signs:** Black canvas, console warning "WebGL context lost."

### Pitfall 5: Lasso Performance with Many Points

**What goes wrong:** Running point-in-polygon on 100k+ points on every mouse-up causes UI jank.
**Why it happens:** Testing each point against a complex polygon is O(n * m) where m is polygon edges.
**How to avoid:** Pre-compute bounding box of lasso polygon, filter to points inside bbox first (cheap), then run point-in-polygon on the filtered subset. Use requestIdleCallback or web worker for large datasets.
**Warning signs:** UI freezes for >500ms after releasing lasso.

### Pitfall 6: SSE Connection Not Closing

**What goes wrong:** EventSource reconnects automatically after the task completes, creating an infinite loop of requests.
**Why it happens:** EventSource API auto-reconnects by default. If the server closes the connection, the browser reopens it.
**How to avoid:** Send a final event with status "complete" or "error", then call `source.close()` in the client's `onmessage` handler. Alternatively, use a named event type and handle it in `addEventListener`.
**Warning signs:** Network tab shows repeated SSE connections after task completion.

### Pitfall 7: DuckDB Single-Writer Bottleneck

**What goes wrong:** Embedding writes block sample reads, causing the grid to hang during embedding generation.
**Why it happens:** DuckDB uses a single-writer, multiple-reader model. Long write transactions block other writes.
**How to avoid:** Use small write transactions (commit every batch of 64 embeddings). Keep embedding writes in a separate cursor. Consider writing to a staging table and copying in bulk.
**Warning signs:** Grid API latency spikes during embedding generation.

## Code Examples

### DINOv2 Embedding Extraction (Verified from HuggingFace Docs)

```python
# Source: https://huggingface.co/docs/transformers/model_doc/dinov2
import torch
from transformers import AutoImageProcessor, AutoModel
from PIL import Image

processor = AutoImageProcessor.from_pretrained("facebook/dinov2-base")
model = AutoModel.from_pretrained("facebook/dinov2-base")
model.eval()

def extract_embeddings(images: list[Image.Image], batch_size: int = 32) -> list[list[float]]:
    """Extract CLS token embeddings from a batch of PIL images."""
    all_embeddings = []
    for i in range(0, len(images), batch_size):
        batch = images[i : i + batch_size]
        inputs = processor(images=batch, return_tensors="pt")
        with torch.no_grad():
            outputs = model(**inputs)
        # CLS token is first token in last_hidden_state: shape (batch, 1+256, 768)
        cls_embeddings = outputs.last_hidden_state[:, 0, :]  # (batch, 768)
        all_embeddings.extend(cls_embeddings.cpu().numpy().tolist())
    return all_embeddings
```

### SigLIP 2 Embedding Extraction (Verified from HuggingFace Docs)

```python
# Source: https://huggingface.co/docs/transformers/en/model_doc/siglip2
import torch
from transformers import AutoProcessor, AutoModel

processor = AutoProcessor.from_pretrained("google/siglip2-base-patch16-224")
model = AutoModel.from_pretrained("google/siglip2-base-patch16-224")
model.eval()

def extract_siglip2_embeddings(images: list, batch_size: int = 32) -> list[list[float]]:
    """Extract image embeddings using SigLIP 2 projection layer."""
    all_embeddings = []
    for i in range(0, len(images), batch_size):
        batch = images[i : i + batch_size]
        inputs = processor(images=batch, return_tensors="pt")
        with torch.no_grad():
            image_features = model.get_image_features(**inputs)  # (batch, 768)
        all_embeddings.extend(image_features.cpu().numpy().tolist())
    return all_embeddings
```

### UMAP 2D Reduction (Verified from umap-learn Docs)

```python
# Source: https://umap-learn.readthedocs.io/en/latest/basic_usage.html
import numpy as np
import umap

def reduce_to_2d(
    embeddings: np.ndarray,
    n_neighbors: int = 15,
    min_dist: float = 0.1,
    random_state: int = 42,
) -> np.ndarray:
    """Reduce high-dimensional embeddings to 2D for visualization.

    Args:
        embeddings: (N, D) array of embedding vectors.
    Returns:
        (N, 2) array of 2D coordinates.
    """
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric="cosine",  # cosine is standard for normalized embeddings
        random_state=random_state,
    )
    return reducer.fit_transform(embeddings)
```

### DuckDB Embedding Storage

```python
# Store and retrieve embeddings + 2D coordinates
def create_embeddings_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            sample_id   VARCHAR NOT NULL,
            dataset_id  VARCHAR NOT NULL,
            model_name  VARCHAR NOT NULL,
            vector      FLOAT[768],
            x           DOUBLE,
            y           DOUBLE
        )
    """)

def get_2d_coordinates(cursor, dataset_id: str) -> list[dict]:
    """Fetch 2D coordinates for scatter plot rendering."""
    result = cursor.execute("""
        SELECT e.sample_id, e.x, e.y, s.file_name, s.thumbnail_path
        FROM embeddings e
        JOIN samples s ON e.sample_id = s.id AND e.dataset_id = s.dataset_id
        WHERE e.dataset_id = ? AND e.x IS NOT NULL
        ORDER BY e.sample_id
    """, [dataset_id]).fetchall()
    return [
        {"sampleId": r[0], "x": r[1], "y": r[2], "fileName": r[3], "thumbnailPath": r[4]}
        for r in result
    ]
```

### SSE Progress Streaming (Verified from sse-starlette Docs)

```python
# Source: https://pypi.org/project/sse-starlette/
import json
import asyncio
from sse_starlette.sse import EventSourceResponse

async def progress_stream(dataset_id: str):
    """Generator yielding SSE events for embedding progress."""
    async def generate():
        while True:
            state = embedding_tasks.get(dataset_id, {"status": "unknown"})
            yield {"event": "progress", "data": json.dumps(state)}
            if state.get("status") in ("complete", "error"):
                break
            await asyncio.sleep(0.5)
    return EventSourceResponse(generate())
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| t-SNE for 2D embedding viz | UMAP (umap-learn) | 2018+ widely adopted | 10-100x faster for large datasets; preserves global structure; supports transform() |
| Custom CNN feature extractors | Pretrained ViTs (DINOv2, SigLIP 2) | 2023-2025 | Zero training required; superior features from self-supervised learning |
| nebula.gl for deck.gl editing | @deck.gl-community/editable-layers or custom SVG | 2023+ (nebula.gl unmaintained) | nebula.gl no longer accepts contributions; successor has limited React support |
| WebSocket for all real-time | SSE for server-to-client streaming | Always available, gaining adoption | SSE works over standard HTTP, auto-reconnects, simpler than WebSocket for unidirectional use |
| Separate vector DB (Pinecone, Qdrant) | DuckDB FLOAT[] with VSS extension | 2024+ (DuckDB VSS) | Single DB for all data; experimental but functional for moderate-scale similarity search |
| deck.gl v8 | deck.gl v9 | 2024 | Major API changes; luma.gl v9 dependency; better WebGPU readiness |

**Deprecated/outdated:**
- nebula.gl: Unmaintained since 2022; use @deck.gl-community/editable-layers if needed, or custom SVG overlay
- scikit-learn t-SNE for large datasets: Too slow above 10k samples; UMAP is the standard replacement
- DINOv1: Superseded by DINOv2 with register tokens and improved training

## Open Questions

1. **SigLIP 2 vs DINOv2 benchmark**
   - What we know: DINOv2-base (768-dim, 86M params) produces richer visual features for clustering. SigLIP 2 base (768-dim, 86M params) adds text-image alignment but may be weaker for pure visual similarity. Both use the same embedding dimension at base size.
   - What's unclear: Which produces better 2D clusters for the specific datasets this tool will handle (COCO-style object detection datasets).
   - Recommendation: Implement both as options behind a model selector. Default to DINOv2-base. Run a visual benchmark during implementation (EMBED-01 spike) comparing cluster quality on a real dataset.

2. **GPU vs CPU inference**
   - What we know: DINOv2-base runs at ~50 images/sec on CPU, ~500 images/sec on GPU. SigLIP 2 has similar characteristics.
   - What's unclear: Whether the target deployment has GPU access (Apple Silicon MPS, NVIDIA CUDA, or CPU-only).
   - Recommendation: Default to CPU with `torch.device("cpu")`. Add optional MPS/CUDA detection via `torch.backends.mps.is_available()` / `torch.cuda.is_available()`. Do not require GPU.

3. **DuckDB FLOAT array dimension flexibility**
   - What we know: DuckDB FLOAT[N] requires fixed N at table creation. Different models have different dimensions (DINOv2-small=384, DINOv2-base=768, SigLIP 2 So400m=1152).
   - What's unclear: How to handle multiple models with different dimensions in a single table.
   - Recommendation: Store `model_name` alongside embeddings. Use the largest dimension (768 for base models) as default. If multi-model support is needed, either use separate tables per model or use DuckDB LIST type (variable length) instead of ARRAY.

4. **Lasso selection coordinate transformation**
   - What we know: Lasso is drawn in screen (pixel) coordinates. Scatter points exist in data coordinates. deck.gl provides `viewport.project()` and `viewport.unproject()` for conversion.
   - What's unclear: Exact API for accessing the viewport from DeckGL React component to do coordinate conversion.
   - Recommendation: Use deck.gl's `onViewStateChange` to track current viewport. Use `deck.pickObjects({x, y, width, height})` for bounding-box pre-filter, then `robust-point-in-polygon` for precise lasso testing in screen coordinates.

## Sources

### Primary (HIGH confidence)
- [HuggingFace Transformers DINOv2 docs](https://huggingface.co/docs/transformers/model_doc/dinov2) - Model API, architecture, code examples
- [HuggingFace Transformers SigLIP2 docs](https://huggingface.co/docs/transformers/en/model_doc/siglip2) - Model API, variants, code examples
- [DINOv2 MODEL_CARD.md](https://github.com/facebookresearch/dinov2/blob/main/MODEL_CARD.md) - Model sizes, dimensions, parameters
- [DuckDB ARRAY type docs](https://duckdb.org/docs/stable/sql/data_types/array) - FLOAT[] column syntax, distance functions
- [DuckDB VSS extension docs](https://duckdb.org/docs/stable/core_extensions/vss) - HNSW indexing on ARRAY columns
- [deck.gl ScatterplotLayer docs](https://deck.gl/docs/api-reference/layers/scatterplot-layer) - Props, picking, React integration
- [deck.gl OrthographicView docs](https://deck.gl/docs/api-reference/core/orthographic-view) - Non-geo 2D view, controller
- [deck.gl Performance docs](https://deck.gl/docs/developer-guide/performance) - Large dataset optimization, binary data
- [umap-learn basic usage docs](https://umap-learn.readthedocs.io/en/latest/basic_usage.html) - API, parameters, scikit-learn compatibility
- [umap-learn PyPI](https://pypi.org/project/umap-learn/) - Version 0.5.11, Python >=3.9, dependencies
- [sse-starlette PyPI](https://pypi.org/project/sse-starlette/) - Version 3.2.0, EventSourceResponse API
- [qdrant-client PyPI](https://pypi.org/project/qdrant-client/) - Version 1.16.2, local mode, named vectors
- [robust-point-in-polygon npm](https://www.npmjs.com/package/robust-point-in-polygon) - Point classification API

### Secondary (MEDIUM confidence)
- [HuggingFace SigLIP 2 blog post](https://huggingface.co/blog/siglip2) - SigLIP 2 model sizes: B(768), L(1024), So400m(1152), g
- [deck.gl GitHub Discussion #7072](https://github.com/visgl/deck.gl/discussions/7072) - Lasso selection approach with event callbacks
- [deck.gl GitHub Issue #2658](https://github.com/visgl/deck.gl/issues/2658) - Confirmation that lasso is not built-in
- [deck.gl-community editable-layers](https://visgl.github.io/deck.gl-community/docs/modules/editable-layers) - nebula.gl successor status
- [deck.gl GitHub Discussion #7841](https://github.com/visgl/deck.gl/discussions/7841) - WebGL context loss recovery pattern
- [FastAPI background tasks + WebSocket discussion](https://github.com/fastapi/fastapi/discussions/8123) - SSE vs WebSocket for progress
- [WebSocket vs SSE comparison](https://potapov.me/en/make/websocket-sse-longpolling-realtime) - SSE preferred for unidirectional streaming

### Tertiary (LOW confidence)
- [SigLIP 2 vs DINOv2 performance comparison](https://x.com/rgilman33/status/1895909951329206717) - SigLIP 2 weaker on dense/spatial tasks
- [UMAP performance tips for large datasets](https://github.com/lmcinnes/umap/issues/125) - Batch processing, PCA preprocessing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via official docs, PyPI, and npm
- Architecture: MEDIUM-HIGH - Patterns derived from official docs and community best practices; lasso implementation pattern is community-sourced (no official deck.gl lasso support)
- Pitfalls: MEDIUM - Common issues documented in GitHub issues and community discussions; some based on general WebGL/async knowledge

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (30 days; stack is stable, deck.gl v9 is current, models are established)
