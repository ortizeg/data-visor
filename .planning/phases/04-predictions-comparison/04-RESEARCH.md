# Phase 4: Predictions & Comparison - Research

**Researched:** 2026-02-11
**Domain:** Model prediction import, annotation comparison visualization, dataset statistics
**Confidence:** HIGH

## Summary

Phase 4 adds three capabilities: importing pre-computed model predictions, visually comparing them against ground truth annotations, and displaying dataset-level statistics. The research reveals that the existing codebase is exceptionally well-prepared for this phase -- the annotations table already has `source` (VARCHAR DEFAULT 'ground_truth') and `confidence` (DOUBLE) columns, and the frontend Annotation type already includes these fields. This means no schema migration is needed; predictions can be stored in the same `annotations` table with `source='prediction'`.

The standard COCO detection results format (`[{image_id, category_id, bbox, score}]`) is the natural import format since the existing COCO parser infrastructure can be reused. For the comparison toggle, SVG `stroke-dasharray` provides a clean way to render dashed lines for predictions vs solid lines for ground truth. For the statistics dashboard, Recharts (v3.7.x, React 19 compatible) is the established React charting library and pairs naturally with the existing stack. DuckDB's analytical aggregation capabilities (GROUP BY, COUNT, etc.) handle all statistics queries efficiently server-side.

**Primary recommendation:** Store predictions in the existing `annotations` table using the `source` column to distinguish them from ground truth; use the COCO results format for import; render comparison via `stroke-dasharray` on SVG overlays; use Recharts for the statistics dashboard.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Recharts | ^3.7.0 | Bar/pie charts for statistics dashboard | React-first SVG charting, React 19 compatible, most popular React chart lib |
| react-is | ^19.0.0 | Recharts peer dependency | Must match React version in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ijson (existing) | >=3.4.0 | Stream-parse prediction JSON files | Already in pyproject.toml; reuse for large prediction files |
| pandas (existing) | >=3.0.0 | Build DataFrames for bulk insert | Already in pyproject.toml; same pattern as COCO ingestion |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts | visx | More flexible but 3-5x more code for simple bar/pie charts; overkill for this phase |
| Recharts | Chart.js (react-chartjs-2) | Canvas-based, better for huge datasets (10K+ points), but less composable in React |
| Recharts | shadcn/ui charts | Uses Recharts under the hood anyway; adds shadcn dependency |
| Single `annotations` table | Separate `predictions` table | Separate table would require duplicating query logic and batch endpoint; `source` column is simpler and already exists |

**Installation:**
```bash
cd frontend && npm install recharts react-is
```

No backend dependencies needed -- everything is already in `pyproject.toml`.

## Architecture Patterns

### Recommended Project Structure

**Backend additions:**
```
app/
├── ingestion/
│   └── prediction_parser.py     # Streaming prediction JSON parser
├── routers/
│   ├── datasets.py              # Add POST /datasets/{id}/predictions endpoint
│   └── samples.py               # Add ?source= filter param to batch-annotations
│   └── statistics.py            # New router for dataset stats
├── models/
│   └── prediction.py            # Pydantic models for prediction import
│   └── statistics.py            # Pydantic models for stats response
└── services/
    └── statistics_service.py    # DuckDB aggregation queries
```

**Frontend additions:**
```
src/
├── components/
│   ├── grid/
│   │   └── annotation-overlay.tsx   # Modify: add source-aware rendering (dashed vs solid)
│   ├── toolbar/
│   │   └── overlay-toggle.tsx       # New: GT/Pred/Both toggle control
│   └── stats/
│       ├── stats-dashboard.tsx      # New: statistics dashboard layout
│       ├── class-distribution.tsx   # New: bar chart of class counts
│       ├── split-breakdown.tsx      # New: pie/bar chart of splits
│       └── annotation-summary.tsx   # New: GT vs prediction counts
├── hooks/
│   └── use-statistics.ts            # New: TanStack Query hook for stats
├── stores/
│   └── ui-store.ts                  # Modify: add overlayMode state
└── types/
    └── statistics.ts                # New: TypeScript types for stats
```

### Pattern 1: Predictions in Same Table with Source Discriminator
**What:** Store predictions in the existing `annotations` table, distinguished by `source='prediction'`
**When to use:** When predictions share the same schema as ground truth annotations (bbox, category, confidence)
**Why:** The DuckDB schema already has `source VARCHAR DEFAULT 'ground_truth'` and `confidence DOUBLE` columns. No migration needed. Batch annotation endpoint already returns both fields. Frontend Annotation type already includes `source` and `confidence`.

```python
# Prediction records use same table, different source value
{
    "id": str(uuid4()),
    "dataset_id": dataset_id,
    "sample_id": str(pred["image_id"]),
    "category_name": categories[pred["category_id"]],
    "bbox_x": float(pred["bbox"][0]),
    "bbox_y": float(pred["bbox"][1]),
    "bbox_w": float(pred["bbox"][2]),
    "bbox_h": float(pred["bbox"][3]),
    "area": float(pred["bbox"][2] * pred["bbox"][3]),
    "is_crowd": False,
    "source": "prediction",          # <-- discriminator
    "confidence": float(pred["score"]),
    "metadata": None,
}
```

### Pattern 2: Overlay Mode Toggle via Zustand
**What:** A three-way toggle in the UI store controlling which annotation sources are visible
**When to use:** For the GT vs Predictions comparison view

```typescript
// In ui-store.ts
type OverlayMode = "ground_truth" | "prediction" | "both";

interface UIState {
  // ... existing fields
  overlayMode: OverlayMode;
  setOverlayMode: (mode: OverlayMode) => void;
}
```

### Pattern 3: Source-Aware SVG Rendering
**What:** AnnotationOverlay renders solid lines for GT, dashed lines for predictions
**When to use:** When rendering overlaid annotations from different sources

```tsx
// stroke-dasharray for dashed prediction lines
const isDashed = ann.source === "prediction";
<rect
  x={ann.bbox_x}
  y={ann.bbox_y}
  width={ann.bbox_w}
  height={ann.bbox_h}
  fill="none"
  stroke={color}
  strokeWidth={strokeWidth}
  strokeDasharray={isDashed ? `${strokeWidth * 4},${strokeWidth * 2}` : "none"}
/>
```

### Pattern 4: Server-Side Aggregation with DuckDB
**What:** All statistics computed on the backend via DuckDB GROUP BY queries, returned as structured JSON
**When to use:** For the dataset statistics dashboard -- keeps the frontend simple and leverages DuckDB's analytical engine

```python
# Class distribution query
"SELECT category_name, source, COUNT(*) as count "
"FROM annotations WHERE dataset_id = ? "
"GROUP BY category_name, source ORDER BY count DESC"

# Split breakdown query
"SELECT split, COUNT(*) as count "
"FROM samples WHERE dataset_id = ? "
"GROUP BY split ORDER BY split"

# Annotation counts by source
"SELECT source, COUNT(*) as count "
"FROM annotations WHERE dataset_id = ? "
"GROUP BY source"
```

### Pattern 5: COCO Results Format for Prediction Import
**What:** Accept the standard COCO detection results JSON format for prediction import
**When to use:** When users want to import model predictions

COCO detection results format (industry standard):
```json
[
  {
    "image_id": 12345,
    "category_id": 1,
    "bbox": [x, y, width, height],
    "score": 0.95
  }
]
```

This is a flat JSON array (not nested under keys like COCO annotations). Use `ijson.items(f, "item")` to stream-parse.

### Anti-Patterns to Avoid
- **Separate predictions table:** Don't create a new `predictions` table -- the `annotations` table already supports this via the `source` column. A separate table would require duplicating all query logic, batch endpoints, and frontend rendering.
- **Client-side aggregation:** Don't compute statistics in the browser. DuckDB can aggregate millions of rows in milliseconds; shipping raw data to the frontend for aggregation wastes bandwidth and creates jank.
- **Custom prediction format:** Don't invent a novel prediction JSON format. The COCO results format is what every detection framework outputs (Detectron2, YOLO, MMDetection). Accept the standard.
- **Dual annotation endpoints:** Don't create separate endpoints for GT and prediction annotations. Filter by `source` in the existing batch endpoint instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bar/pie charts | Custom SVG chart components | Recharts BarChart, PieChart | Axis handling, tooltips, responsiveness, animations are surprisingly complex |
| Responsive chart sizing | Manual resize observers for charts | Recharts ResponsiveContainer | Handles resize debouncing, SSR hydration edge cases |
| Streaming JSON parsing | Custom JSON tokenizer | ijson (already in project) | Handle malformed JSON, memory management, performance optimized with yajl2_c |
| Dashed line patterns | Canvas-based annotation renderer | SVG stroke-dasharray | Native SVG attribute, scales with viewBox, zero dependencies |
| Aggregate statistics | Frontend reduce() over annotation arrays | DuckDB GROUP BY queries | Analytical engine optimized for aggregation; handles millions of rows |

**Key insight:** The existing codebase has already laid excellent groundwork. The `source` and `confidence` columns in the annotations table, the `source` field in the AnnotationResponse model, and the frontend Annotation type all already exist. Phase 4 is primarily about using infrastructure that was planned ahead.

## Common Pitfalls

### Pitfall 1: category_id Resolution During Prediction Import
**What goes wrong:** Predictions use integer `category_id` values that must be resolved to category names using the dataset's category mapping. If a prediction references a category_id not in the dataset's categories table, it silently gets mapped to "unknown" or causes an error.
**Why it happens:** COCO predictions only contain `category_id`, not `category_name`. The category mapping from the original dataset ingestion must be reused.
**How to avoid:** Load the dataset's categories from DuckDB before parsing predictions. Validate that prediction category_ids exist in the mapping. Log warnings for unmapped categories with their count.
**Warning signs:** Annotations appearing with category_name "unknown" after prediction import.

### Pitfall 2: image_id Type Mismatch
**What goes wrong:** COCO predictions use integer `image_id` but the DuckDB `samples.id` column stores VARCHAR. If string conversion is inconsistent (e.g., "000123" vs "123"), predictions won't link to samples.
**Why it happens:** The COCO parser converts image IDs with `str(image["id"])`, producing "123". Predictions must use the same conversion.
**How to avoid:** Convert prediction `image_id` with `str(int(pred["image_id"]))` to normalize. Consider validating that all referenced image_ids exist in the samples table.
**Warning signs:** Predictions imported but not appearing on any images. Batch annotation endpoint returns predictions that don't group with any sample.

### Pitfall 3: Recharts SSR Hydration Mismatch
**What goes wrong:** Recharts uses browser APIs (DOM measurements) that don't exist during SSR. This causes hydration mismatches in Next.js.
**Why it happens:** ResponsiveContainer measures its parent's width/height on mount, which produces different results during SSR (0x0) vs client render.
**How to avoid:** Mark all chart components with `"use client"` directive. Use `ResponsiveContainer` as the outermost wrapper. Consider lazy-loading the stats dashboard with `dynamic(() => import(...), { ssr: false })` if hydration issues persist.
**Warning signs:** Console warnings about hydration mismatch, charts rendering at 0x0 initially.

### Pitfall 4: Overlay Toggle Not Filtering Batch Annotation Response
**What goes wrong:** The batch annotation endpoint returns ALL annotations (GT + predictions). If the frontend overlay toggle is set to "GT only" but all data is still transferred, it wastes bandwidth and the filtering has to happen client-side.
**Why it happens:** The current batch endpoint has no `source` filter parameter.
**How to avoid:** Add an optional `source` query parameter to the batch-annotations endpoint: `?source=ground_truth` or `?source=prediction`. When `overlayMode` is "both" or unset, omit the parameter to get everything. This pushes filtering to DuckDB where it's efficient.
**Warning signs:** Network tab showing large annotation payloads even when only viewing GT.

### Pitfall 5: Prediction Import Deleting Previous Predictions
**What goes wrong:** User imports predictions twice and ends up with duplicate annotations, or a "replace" operation accidentally deletes ground truth.
**Why it happens:** No clear distinction between "add" and "replace" for predictions.
**How to avoid:** Always DELETE existing predictions (WHERE source='prediction') for the dataset before importing new ones. This is safe because `source='ground_truth'` records are never touched. Make this behavior explicit in the API response and document it.
**Warning signs:** Annotation count doubling after re-import, or ground truth annotations disappearing.

### Pitfall 6: Dashboard Stats Stale After Prediction Import
**What goes wrong:** User imports predictions but the statistics dashboard still shows old counts because TanStack Query has cached the previous response.
**Why it happens:** Statistics queries use `staleTime: Infinity` or long stale times.
**How to avoid:** Invalidate the statistics query key after successful prediction import. Use `queryClient.invalidateQueries({ queryKey: ["statistics", datasetId] })` in the mutation's `onSuccess` callback.
**Warning signs:** Stats showing 0 predictions immediately after import until page refresh.

## Code Examples

### Prediction Import Endpoint (Backend)

```python
# POST /datasets/{dataset_id}/predictions
@router.post("/{dataset_id}/predictions")
def import_predictions(
    dataset_id: str,
    request: PredictionImportRequest,
    db: DuckDBRepo = Depends(get_db),
) -> StreamingResponse:
    """Import model predictions from COCO results format JSON."""
    # Verify dataset exists
    # Load category mapping from DuckDB
    # Delete existing predictions for this dataset
    # Stream-parse prediction JSON with ijson
    # Bulk insert into annotations table with source='prediction'
    # Update dataset metadata
    # Return SSE progress stream (same pattern as ingestion)
```

### Streaming Prediction Parser

```python
def parse_predictions_streaming(self, file_path: Path) -> Iterator[dict]:
    """Yield raw prediction dicts from COCO results format.

    COCO results format is a flat JSON array:
    [{"image_id": int, "category_id": int, "bbox": [x,y,w,h], "score": float}]
    """
    with open(file_path, "rb") as f:
        yield from ijson.items(f, "item", use_float=True)
```

### Source-Aware Annotation Overlay

```tsx
// Modified AnnotationOverlay with source-based styling
{annotations.map((ann) => {
  const color = getClassColor(ann.category_name);
  const isPrediction = ann.source === "prediction";
  // Scale dash pattern to image size for consistent appearance
  const dashLen = strokeWidth * 4;
  const gapLen = strokeWidth * 2;

  return (
    <g key={ann.id}>
      <rect
        x={ann.bbox_x}
        y={ann.bbox_y}
        width={ann.bbox_w}
        height={ann.bbox_h}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={isPrediction ? `${dashLen},${gapLen}` : "none"}
      />
      <text
        x={ann.bbox_x}
        y={ann.bbox_y - 4}
        fill={color}
        fontSize={fontSize}
        fontWeight="bold"
        paintOrder="stroke"
        stroke="rgba(0,0,0,0.7)"
        strokeWidth={fontSize * 0.15}
      >
        {ann.category_name}
        {isPrediction && ann.confidence !== null
          ? ` ${(ann.confidence * 100).toFixed(0)}%`
          : ""}
      </text>
    </g>
  );
})}
```

### Overlay Mode Toggle Component

```tsx
// Segmented control for overlay mode
type OverlayMode = "ground_truth" | "prediction" | "both";

const modes: { value: OverlayMode; label: string }[] = [
  { value: "ground_truth", label: "GT" },
  { value: "prediction", label: "Pred" },
  { value: "both", label: "Both" },
];

// Renders as a segmented button group in the toolbar
```

### Dataset Statistics Endpoint (Backend)

```python
# GET /datasets/{dataset_id}/statistics
@router.get("/{dataset_id}/statistics")
def get_dataset_statistics(
    dataset_id: str,
    db: DuckDBRepo = Depends(get_db),
) -> DatasetStatistics:
    """Return aggregated dataset statistics for the dashboard."""
    cursor = db.connection.cursor()
    try:
        # Class distribution
        class_dist = cursor.execute(
            "SELECT category_name, "
            "COUNT(*) FILTER (WHERE source = 'ground_truth') as gt_count, "
            "COUNT(*) FILTER (WHERE source = 'prediction') as pred_count "
            "FROM annotations WHERE dataset_id = ? "
            "GROUP BY category_name ORDER BY gt_count DESC",
            [dataset_id],
        ).fetchall()

        # Split breakdown
        splits = cursor.execute(
            "SELECT COALESCE(split, 'unassigned') as split_name, COUNT(*) as count "
            "FROM samples WHERE dataset_id = ? "
            "GROUP BY split_name ORDER BY count DESC",
            [dataset_id],
        ).fetchall()

        # Summary counts
        summary = cursor.execute(
            "SELECT "
            "  (SELECT COUNT(*) FROM samples WHERE dataset_id = ?) as total_images, "
            "  (SELECT COUNT(*) FROM annotations WHERE dataset_id = ? AND source = 'ground_truth') as gt_annotations, "
            "  (SELECT COUNT(*) FROM annotations WHERE dataset_id = ? AND source = 'prediction') as pred_annotations, "
            "  (SELECT COUNT(DISTINCT category_name) FROM annotations WHERE dataset_id = ?) as total_categories",
            [dataset_id, dataset_id, dataset_id, dataset_id],
        ).fetchone()
    finally:
        cursor.close()

    return DatasetStatistics(
        class_distribution=[...],
        split_breakdown=[...],
        summary=SummaryStats(...),
    )
```

### Recharts Dashboard Component

```tsx
"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
  ResponsiveContainer,
} from "recharts";

// Class distribution horizontal bar chart with GT and prediction stacked bars
<ResponsiveContainer width="100%" height={300}>
  <BarChart data={classDistribution} layout="vertical">
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis type="number" />
    <YAxis type="category" dataKey="category_name" width={120} />
    <Tooltip />
    <Legend />
    <Bar dataKey="gt_count" name="Ground Truth" fill="#3b82f6" />
    <Bar dataKey="pred_count" name="Predictions" fill="#f59e0b" />
  </BarChart>
</ResponsiveContainer>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate predictions table | Same table with `source` discriminator | DataVisor Phase 1 decision | Already implemented in schema; no migration needed |
| Custom chart rendering | Recharts 3.x with SVG | Recharts 3.0 (2025) | React 19 compatible, tree-shakable, smaller bundle |
| Full JSON.parse for predictions | Streaming ijson parser | Already in codebase | Handles 100K+ predictions without OOM |
| Canvas-based annotation rendering | SVG with viewBox scaling | Phase 2 decision | stroke-dasharray works natively; no canvas context needed |

**Deprecated/outdated:**
- Recharts 2.x: Still works but 3.x has better React 19 support, smaller bundle, cleaner API. Use 3.x.
- react-is override hack: Was needed for Recharts 2.x + React 19; Recharts 3.x handles this natively.

## Open Questions

1. **Prediction import: file upload vs file path?**
   - What we know: Current dataset ingestion accepts a file path (on the server's filesystem). The same pattern could work for predictions.
   - What's unclear: Should predictions support file upload (multipart form) in addition to file path? File upload is more user-friendly but adds complexity.
   - Recommendation: Start with file path (consistent with existing ingestion pattern). File upload can be added later as an enhancement. The frontend can offer both options -- a file picker that uploads to a temp directory, and a path input.

2. **Statistics dashboard placement: separate page or tab?**
   - What we know: The current dataset page has a header, filter sidebar, and grid. Adding a full dashboard would compete for space.
   - What's unclear: Should stats be a tab alongside the grid, a collapsible panel above the grid, or a separate route?
   - Recommendation: Add a tab system to the dataset page with "Grid" and "Statistics" tabs. This keeps the URL clean (`/datasets/{id}?tab=stats`) and avoids cramming too much into one view. The tab can be a simple Zustand state toggle.

3. **Annotation count update after prediction import?**
   - What we know: The `datasets` table has `annotation_count` which was set during initial ingestion. After importing predictions, this count is stale.
   - What's unclear: Should `annotation_count` include predictions? Or should there be separate `gt_annotation_count` and `prediction_count` columns?
   - Recommendation: Keep `annotation_count` as GT-only for backward compatibility. Add a `prediction_count` column to the datasets table. Update it after prediction import. The statistics endpoint computes live counts anyway.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `app/repositories/duckdb_repo.py` -- annotations table schema with `source` and `confidence` columns already present
- Codebase analysis: `app/models/annotation.py` -- AnnotationResponse model includes `source: str` and `confidence: float | None`
- Codebase analysis: `frontend/src/types/annotation.ts` -- Annotation type includes `source: string` and `confidence: number | null`
- Codebase analysis: `app/ingestion/coco_parser.py` -- streaming ijson pattern with DataFrame batch output, reusable for predictions
- MDN Web Docs: [stroke-dasharray](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dasharray) -- SVG dash pattern syntax and behavior
- DuckDB docs: [GROUP BY Clause](https://duckdb.org/docs/stable/sql/query_syntax/groupby) -- aggregation syntax for statistics queries
- DuckDB docs: [Aggregate Functions](https://duckdb.org/docs/stable/sql/functions/aggregates) -- COUNT, FILTER clause for conditional aggregation

### Secondary (MEDIUM confidence)
- COCO Dataset: [Results Format](https://cocodataset.org/#format-results) -- standard detection results JSON format verified via Detectron2 source and cocoapi issues
- Recharts GitHub: [3.0 migration guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide) -- React 19 compatibility confirmed in 3.x
- Recharts GitHub: [Dependency discussion](https://github.com/recharts/recharts/discussions/5701) -- peer dependency structure for React 19
- npm: [recharts](https://www.npmjs.com/package/recharts) -- version 3.7.0 is latest (published late Jan 2026)
- FiftyOne docs: [Evaluating Detections](https://docs.voxel51.com/tutorials/evaluate_detections.html) -- GT vs prediction overlay patterns in established CV tools

### Tertiary (LOW confidence)
- WebSearch: [Recharts comparison articles](https://blog.logrocket.com/best-react-chart-libraries-2025/) -- ecosystem positioning vs visx, Chart.js
- WebSearch: Various Recharts + Next.js integration tutorials -- "use client" directive required for chart components

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Recharts is well-established, React 19 compatible, and the only new dependency needed. Backend needs no new packages.
- Architecture: HIGH -- The existing codebase is perfectly prepared. `source` column, streaming parser, batch endpoints all exist. This is primarily wiring together existing infrastructure.
- Pitfalls: HIGH -- category_id resolution and image_id type coercion are well-understood COCO ecosystem issues. Recharts SSR issues are documented.

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable domain, 30 days)
