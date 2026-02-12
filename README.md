# DataVisor

Unified computer vision dataset introspection tool. Browse 100K+ image datasets with annotation overlays, compare model predictions against ground truth, cluster images via embeddings, and surface errors with AI-powered analysis.

## Quick Start

### Prerequisites

- **Python 3.14+** with [uv](https://docs.astral.sh/uv/)
- **Node.js 20+** with npm
- **libvips** (for VLM auto-tagging): `brew install vips` (macOS) or `apt-get install libvips-dev` (Linux)

### Backend

```bash
# Install Python dependencies
uv sync

# Copy environment config
cp .env.example .env

# Start the API server (http://localhost:8000)
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server (http://localhost:3000)
npm run dev
```

### Verify

- API health check: `curl http://localhost:8000/health`
- Open http://localhost:3000 in your browser

## Usage

### 1. Ingest a Dataset

```bash
# Ingest a COCO-format dataset
curl -X POST http://localhost:8000/datasets/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-dataset",
    "annotation_path": "/path/to/annotations.json",
    "image_dir": "/path/to/images/",
    "format": "coco"
  }'
```

Supports local filesystem paths and GCS bucket URIs (`gs://bucket/path`).

### 2. Browse & Filter

Open any dataset in the browser to:

- **Grid view** -- Virtualized infinite-scroll grid of image thumbnails
- **Annotation overlays** -- Bounding boxes with class labels (deterministic colors per class)
- **Filter sidebar** -- Filter by class, split, tags, or any metadata field
- **Search** -- Search by filename, sort by any column
- **Tagging** -- Add/remove tags on individual samples or bulk selections
- **Saved views** -- Save and reload filter configurations

### 3. Import Predictions

```bash
# Import model predictions (COCO results format)
curl -X POST http://localhost:8000/datasets/{dataset_id}/predictions/import \
  -H "Content-Type: application/json" \
  -d '{
    "prediction_path": "/path/to/predictions.json",
    "source": "my-model-v1"
  }'
```

Then toggle between GT-only, Predictions-only, or both overlaid (solid lines = GT, dashed = predictions).

### 4. Embedding Visualization

Generate DINOv2 embeddings, reduce to 2D with t-SNE, and explore as an interactive scatter plot. Lasso-select clusters to cross-filter the grid.

### 5. Error Analysis

Prediction errors are automatically categorized as:
- **True Positives** -- Correct detections
- **Hard False Positives** -- Confident but wrong
- **Label Errors** -- Potential annotation mistakes
- **False Negatives** -- Missed detections

Use "Find Similar" to find visually similar images via Qdrant vector search.

### 6. AI Intelligence

- **Agent analysis** -- Pydantic AI agent detects error patterns and recommends corrective actions
- **VLM auto-tagging** -- Moondream2 tags images with scene attributes (dark, blurry, indoor, crowded, etc.)

## Configuration

All settings use the `DATAVISOR_` environment variable prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATAVISOR_DB_PATH` | `data/datavisor.duckdb` | DuckDB database file |
| `DATAVISOR_THUMBNAIL_CACHE_DIR` | `data/thumbnails` | Thumbnail cache directory |
| `DATAVISOR_PLUGIN_DIR` | `plugins` | Plugin directory |
| `DATAVISOR_HOST` | `0.0.0.0` | Server host |
| `DATAVISOR_PORT` | `8000` | Server port |
| `DATAVISOR_GCS_CREDENTIALS_PATH` | _(none)_ | GCS service account JSON path |
| `DATAVISOR_AGENT_MODEL` | `openai:gpt-4o` | LLM model for AI agent |
| `DATAVISOR_VLM_DEVICE` | _(auto)_ | VLM device (auto-detects MPS > CUDA > CPU) |

For AI agent features, also set `OPENAI_API_KEY` (or the key for your configured model).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/datasets/ingest` | Ingest a dataset (SSE progress) |
| `GET` | `/datasets` | List all datasets |
| `GET` | `/datasets/{id}` | Get dataset details |
| `DELETE` | `/datasets/{id}` | Delete a dataset |
| `GET` | `/datasets/{id}/samples` | Paginated samples with filters |
| `GET` | `/datasets/{id}/samples/{sid}` | Single sample details |
| `POST` | `/datasets/{id}/samples/tags` | Bulk add tags |
| `DELETE` | `/datasets/{id}/samples/tags` | Bulk remove tags |
| `GET` | `/datasets/{id}/samples/{sid}/annotations` | Annotations for a sample |
| `POST` | `/datasets/{id}/samples/annotations/batch` | Batch annotations |
| `GET` | `/datasets/{id}/images/{filename}` | Serve original image |
| `GET` | `/datasets/{id}/thumbnails/{filename}` | Serve thumbnail |
| `POST` | `/datasets/{id}/predictions/import` | Import predictions (SSE) |
| `GET` | `/datasets/{id}/statistics` | Dataset statistics |
| `GET` | `/datasets/{id}/filter-facets` | Filter facet counts |
| `GET` | `/views` | List saved views |
| `POST` | `/views` | Create saved view |
| `DELETE` | `/views/{id}` | Delete saved view |
| `POST` | `/datasets/{id}/embeddings/generate` | Generate embeddings (SSE) |
| `GET` | `/datasets/{id}/embeddings/status` | Embedding status |
| `POST` | `/datasets/{id}/embeddings/reduce` | Run t-SNE reduction (SSE) |
| `GET` | `/datasets/{id}/embeddings/coordinates` | Get 2D coordinates |
| `GET` | `/datasets/{id}/similarity/{sid}` | Find similar images |
| `GET` | `/datasets/{id}/errors` | Error categorization |
| `POST` | `/datasets/{id}/analyze` | Run AI agent analysis |
| `POST` | `/datasets/{id}/vlm/auto-tag` | Start VLM auto-tagging (SSE) |
| `GET` | `/datasets/{id}/vlm/progress` | VLM tagging progress |

## Testing

```bash
# Run all backend tests
uv run pytest

# Run with verbose output
uv run pytest -v

# Type-check frontend
cd frontend && npx tsc --noEmit
```

## Architecture

```
data-visor/
├── app/                          # Python backend (FastAPI)
│   ├── main.py                   # App entry point + lifespan
│   ├── config.py                 # Pydantic Settings
│   ├── dependencies.py           # FastAPI DI
│   ├── routers/                  # API endpoint handlers
│   ├── services/                 # Business logic
│   │   ├── embedding_service.py  # DINOv2 embeddings
│   │   ├── error_analysis.py     # Error categorization
│   │   ├── agent_service.py      # Pydantic AI agent
│   │   ├── vlm_service.py        # Moondream2 VLM
│   │   ├── similarity_service.py # Qdrant similarity
│   │   └── ...
│   ├── repositories/             # Data access (DuckDB, Qdrant, Storage)
│   ├── models/                   # Pydantic models
│   ├── ingestion/                # Format parsers (COCO)
│   └── plugins/                  # Plugin system
├── frontend/                     # Next.js frontend
│   └── src/
│       ├── app/                  # Pages (App Router)
│       ├── components/           # React components
│       ├── stores/               # Zustand state
│       ├── hooks/                # Custom hooks
│       ├── lib/                  # Utilities
│       └── types/                # TypeScript types
├── tests/                        # pytest test suite
├── plugins/                      # User plugins directory
├── pyproject.toml                # Python project config
└── .env.example                  # Environment template
```

### Tech Stack

**Backend:** FastAPI, DuckDB, Qdrant (local), Pydantic AI, Moondream2 (VLM), DINOv2

**Frontend:** Next.js 16, React 19, Tailwind CSS 4, Zustand, TanStack Query, deck.gl, Recharts

### Key Design Decisions

- **DuckDB** for analytical queries over 100K+ rows (columnar storage)
- **Qdrant** in local disk mode for vector similarity (no Docker required)
- **deck.gl** with OrthographicView for WebGL scatter plots
- **Source discriminator** column for clean GT/prediction separation
- **Lazy loading** for VLM, Qdrant, and AI agent (on-demand, not at startup)
- **3 Zustand stores** (ui, filter, embedding) combined at hook level for cross-filtering

## Plugin System

Create plugins by subclassing `BasePlugin`:

```python
from app.plugins.base import BasePlugin

class MyPlugin(BasePlugin):
    name = "my-plugin"

    def on_after_ingest(self, *, dataset_id: str, **kwargs):
        print(f"Dataset {dataset_id} ingested!")
```

Place in the `plugins/` directory. Plugins are auto-discovered at startup.

## License

MIT
