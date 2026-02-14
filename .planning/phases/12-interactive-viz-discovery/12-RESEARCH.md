# Phase 12: Interactive Viz & Discovery - Research

**Researched:** 2026-02-13
**Domain:** Interactive visualization, similarity search, near-duplicate detection, cross-filter grid navigation
**Confidence:** HIGH

## Summary

Phase 12 adds four interactive discovery features: (1) "Find Similar" button that filters the main grid to nearest neighbors, (2) clickable confusion matrix cells that filter the grid to GT/prediction class pairs, (3) near-duplicate detection that groups visually similar images, and (4) clickable histogram bars that filter the grid to samples in that bucket.

The existing codebase provides strong foundations for all four features. The similarity search endpoint already exists (`GET /datasets/{id}/similarity/search`), the confusion matrix is already rendered as an HTML table with per-cell data, Recharts Bar components support onClick handlers natively, and the filter store + `sample_ids` query parameter provide the cross-filter mechanism for all grid-filtering features.

The primary architectural pattern across all four features is: **click a visualization element -> compute the relevant sample IDs -> pass them through the existing `sample_ids` filter to the grid**. This leverages the existing lasso-selection pattern in `embedding-store.ts` which already pipes `sample_ids` through `use-samples.ts` into the grid's infinite query.

**Primary recommendation:** Extend the existing `sample_ids` filter pattern (currently used only for lasso selection) into a general-purpose "discovery filter" that any visualization can write to, causing the grid to show only the matching samples. No new backend filtering infrastructure is needed -- all four features can use the existing `sample_ids` query parameter on `GET /samples`.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Recharts | ^3.7.0 | Interactive histograms with onClick | Already used for all charts in stats dashboard |
| Qdrant Client | 1.16.2 | Similarity search + near-duplicate detection | Already used for find-similar; `score_threshold` + `scroll` enable near-dupe grouping |
| Zustand | ^5.0.11 | Cross-filter state (discovery sample IDs) | Already powers filter-store, ui-store, embedding-store |
| TanStack Query | ^5.90.20 | Async data fetching with cache | Already used for all API hooks |
| DuckDB | (backend) | SQL queries for confusion matrix cell->sample mapping | Already used for all filtering |

### Supporting (Already Installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| supervision | 0.27.0 | Confusion matrix computation | Already used in evaluation service |
| numpy | 2.4.2 | Vector operations | Already used for IoU/PR computation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom near-dupe detection | FiftyOne brain.compute_near_duplicates | FiftyOne adds huge dependency; Qdrant + cosine threshold is sufficient for this use case |
| HTML table confusion matrix | d3-based heatmap | Over-engineering; current HTML table is already rendered and just needs onClick handlers |
| New filter mechanism | New Zustand store | Unnecessary; extending embedding-store's `lassoSelectedIds` pattern (or renaming to discoveryIds) is cleaner |

**Installation:**
```bash
# No new packages needed -- all libraries already installed
```

## Architecture Patterns

### Recommended Project Structure
```
app/
  routers/
    similarity.py          # EXTEND: add near-duplicate endpoint
    statistics.py          # EXTEND: add confusion-matrix-samples endpoint
  services/
    similarity_service.py  # EXTEND: add find_near_duplicates method
    evaluation.py          # EXTEND: add get_confusion_cell_samples helper
frontend/src/
  stores/
    filter-store.ts        # EXTEND: add sampleIdFilter for discovery
  hooks/
    use-near-duplicates.ts # NEW: hook for near-duplicate groups
  components/
    stats/
      confusion-matrix.tsx # EXTEND: add onClick to cells
      class-distribution.tsx # EXTEND: add onClick to bars
    detail/
      sample-modal.tsx     # EXTEND: "Find Similar" filters grid (not just modal panel)
```

### Pattern 1: Discovery Filter via sample_ids
**What:** All four features write sample IDs into a shared filter state, which flows through the existing `use-samples.ts` hook into the grid's `sample_ids` query parameter.
**When to use:** Every time a visualization element is clicked to filter the grid.
**Example:**
```typescript
// In filter-store.ts -- add a discovery filter field
interface FilterState {
  // ... existing fields ...
  /** Sample IDs from discovery actions (find-similar, confusion cell click, etc.) */
  sampleIdFilter: string[] | null;
  setSampleIdFilter: (ids: string[] | null) => void;
}

// In use-samples.ts -- merge sampleIdFilter into the query
const sampleIdFilter = useFilterStore((s) => s.sampleIdFilter);
// Combine with lasso if both active, or use whichever is set
const effectiveIds = lassoSelectedIds ?? sampleIdFilter;
params.set("sample_ids", effectiveIds.join(","));
```

### Pattern 2: Confusion Matrix Cell Click -> Backend Query
**What:** When a confusion matrix cell is clicked, the frontend sends the GT class + predicted class pair to a new backend endpoint that returns the matching sample IDs. These IDs are then piped into the grid filter.
**When to use:** Confusion matrix interaction (TRIAGE-04).
**Example:**
```python
# New endpoint: GET /datasets/{id}/confusion-cell-samples
@router.get("/{dataset_id}/confusion-cell-samples")
def get_confusion_cell_samples(
    dataset_id: str,
    actual_class: str = Query(...),
    predicted_class: str = Query(...),
    source: str = Query("prediction"),
    iou_threshold: float = Query(0.5),
    conf_threshold: float = Query(0.25),
    split: str | None = Query(None),
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Return sample IDs where actual=X and predicted=Y."""
    # Re-use _load_detections + IoU matching from evaluation.py
    # Return {"sample_ids": [...], "count": N}
```

### Pattern 3: Near-Duplicate Detection via Qdrant Pairwise Search
**What:** For each embedding in the collection, query Qdrant with a high `score_threshold` (e.g., 0.95) to find near-duplicates. Group results using union-find to create duplicate clusters.
**When to use:** Near-duplicate detection (TRIAGE-05).
**Example:**
```python
# In similarity_service.py
def find_near_duplicates(
    self, dataset_id: str, threshold: float = 0.95, limit_per_query: int = 10
) -> list[list[str]]:
    """Find groups of near-duplicate images.

    Algorithm:
    1. Scroll all points from the collection
    2. For each point, query with score_threshold=threshold
    3. Build adjacency via union-find
    4. Return groups of size >= 2
    """
    collection = self.ensure_collection(dataset_id)

    # Scroll all points
    all_points = []
    offset = None
    while True:
        points, offset = self.client.scroll(
            collection_name=collection,
            limit=500,
            with_vectors=True,
            with_payload=True,
            offset=offset,
        )
        all_points.extend(points)
        if offset is None:
            break

    # For each point, find near-duplicates above threshold
    parent = {}  # union-find

    for point in all_points:
        results = self.client.query_points(
            collection_name=collection,
            query=point.vector,
            score_threshold=threshold,
            limit=limit_per_query,
            with_payload=True,
        ).points

        sid = point.payload["sample_id"]
        for r in results:
            r_sid = r.payload["sample_id"]
            if r_sid != sid:
                union(parent, sid, r_sid)

    # Group by root
    groups = defaultdict(list)
    for sid in parent:
        groups[find(parent, sid)].append(sid)

    return [g for g in groups.values() if len(g) >= 2]
```

### Pattern 4: Recharts Bar onClick for Histogram Filtering
**What:** Add `onClick` handler to Recharts `<Bar>` components. The handler receives the data entry and index, which contains the category name or bucket range. Use this to set the grid filter.
**When to use:** Interactive histograms (TRIAGE-06).
**Example:**
```typescript
// In class-distribution.tsx
<Bar
  dataKey="gt_count"
  name="Ground Truth"
  fill="#3b82f6"
  onClick={(data) => {
    // data.category_name is the clicked bar's class
    const { setCategory } = useFilterStore.getState();
    setCategory(data.category_name);
    // Switch to grid tab to show results
    useUIStore.getState().setActiveTab("grid");
  }}
  className="cursor-pointer"
/>
```

### Pattern 5: Tab Switch After Filter
**What:** After any discovery action (confusion cell click, histogram bar click, find-similar), automatically switch from Statistics tab to Grid tab so the user sees the filtered results.
**When to use:** All four features.
**Example:**
```typescript
function handleDiscoveryFilter(sampleIds: string[]) {
  useFilterStore.getState().setSampleIdFilter(sampleIds);
  useUIStore.getState().setActiveTab("grid");
}
```

### Anti-Patterns to Avoid
- **Don't create separate grid components for each discovery view:** Use the existing `ImageGrid` with filtered sample IDs. The grid already handles infinite scroll, annotations, selection -- reuse it.
- **Don't load all samples into the frontend for filtering:** Keep filtering server-side via the `sample_ids` parameter. The backend already supports up to 5000 IDs.
- **Don't compute confusion matrix cell mappings in the frontend:** The confusion matrix is row-normalized and doesn't preserve sample-level data. The backend must re-run the matching to identify which samples fall in each cell.
- **Don't run near-duplicate detection synchronously in a GET handler:** It can be slow for large datasets. Use SSE progress stream or at minimum return a background job ID.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding similar vectors | Custom distance computation | Qdrant `query_points` with `score_threshold` | Qdrant uses HNSW index for O(log n) approximate search vs O(n) brute force |
| Union-find for grouping | Naive nested loop grouping | Simple union-find (15 lines of Python) | O(n*alpha(n)) vs O(n^2) for naive approach |
| Grid filtering by sample IDs | New grid component | Existing `sample_ids` param on `GET /samples` | Already supports up to 5000 IDs, already integrated with infinite scroll |
| Confusion matrix computation | Manual GT/pred matching | supervision.ConfusionMatrix | Already used; handles edge cases (background class, unmatched detections) |
| Interactive chart clicks | Custom SVG hit testing | Recharts `<Bar onClick>` | Built-in feature; receives data object with full entry payload |

**Key insight:** The entire phase is about connecting existing visualizations to existing filters. The backend already has similarity search, evaluation metrics, and sample filtering. The frontend already has the grid, stats dashboard, and filter store. Phase 12 just wires them together with click handlers and a few new endpoints for sample ID resolution.

## Common Pitfalls

### Pitfall 1: Confusion Matrix Cell -> Sample ID Mapping is Non-Trivial
**What goes wrong:** The confusion matrix shows row-normalized fractions, and the supervision ConfusionMatrix object doesn't store which samples are in each cell. You can't simply look up "samples where GT=cat and pred=dog" from the matrix data.
**Why it happens:** The confusion matrix is computed via IoU matching (predictions matched to GT boxes via greedy assignment). The cell values are aggregation counts, not sample lists.
**How to avoid:** Create a dedicated backend endpoint that re-runs the IoU matching from `evaluation.py` but returns sample IDs instead of counts for a specific (actual_class, predicted_class) pair. Re-use `_load_detections` and the matching logic from `categorize_errors`.
**Warning signs:** If you find yourself trying to filter samples by two categories on the frontend, you're going down the wrong path -- the matching must be done server-side.

### Pitfall 2: Near-Duplicate Detection is O(n^2) in Naive Implementation
**What goes wrong:** Querying Qdrant for every point against every other point is O(n) queries each costing O(log n) via HNSW, but for 100K images this is 100K queries.
**Why it happens:** True pairwise comparison doesn't scale.
**How to avoid:** Use Qdrant's `score_threshold` to limit results per query (most points will have 0 near-duplicates). Batch the operation. For datasets >10K, run asynchronously with progress reporting via SSE. Also consider caching results since embeddings don't change frequently.
**Warning signs:** If a "Detect Duplicates" button hangs the UI for more than 5 seconds, the operation needs to be async.

### Pitfall 3: sample_ids URL Parameter Length Limit
**What goes wrong:** If a confusion matrix cell or near-duplicate group contains thousands of samples, the `sample_ids` query parameter can exceed URL length limits (~8KB for most servers).
**Why it happens:** Sample IDs are UUIDs or long strings; 200 IDs can be 7000+ characters.
**How to avoid:** The existing backend already caps at 5000 sample_ids. For the frontend, if the result set exceeds this, show a count and offer to display the first N. Alternatively, create a server-side "saved filter" that stores the ID set and returns a filter token.
**Warning signs:** HTTP 414 (URI Too Long) errors in the browser console.

### Pitfall 4: Recharts onClick Returns Different Data Shapes by Layout
**What goes wrong:** For a vertical BarChart, the onClick data object has the entry's keys at the top level. For a horizontal layout (layout="vertical"), the structure is the same but orientation differs. Class distribution uses `layout="vertical"` while other charts might use default.
**Why it happens:** Recharts normalizes the data object regardless of layout, but the category field name depends on which axis is the category axis.
**How to avoid:** Always extract the value using the specific dataKey (e.g., `data.category_name`, not `data.name` or `data.value`). Test with console.log first.
**Warning signs:** Click handler receives `undefined` for the expected field.

### Pitfall 5: Filter State Cleanup on Tab Switch
**What goes wrong:** User clicks a confusion matrix cell, switches to grid, sees filtered results. Then they switch back to statistics and click a different cell. The old filter is still in state and the grid shows stale results until the new filter triggers a refetch.
**Why it happens:** Filter state persists across tab switches.
**How to avoid:** Clear the discovery filter whenever the user manually modifies other filters (search, category, split). Provide a visible "Clear discovery filter" chip/badge so the user knows a filter is active and can dismiss it.
**Warning signs:** Grid shows unexpected results after multiple discovery actions.

## Code Examples

Verified patterns from the existing codebase:

### Recharts Bar onClick (from existing Recharts patterns in codebase)
```typescript
// Source: Recharts v3 docs + existing class-distribution.tsx pattern
// The data parameter receives the full data entry object
<Bar
  dataKey="gt_count"
  name="Ground Truth"
  fill="#3b82f6"
  radius={[0, 2, 2, 0]}
  onClick={(data: { category_name: string; gt_count: number; pred_count: number }) => {
    // Set category filter and switch to grid
    useFilterStore.getState().setCategory(data.category_name);
    useUIStore.getState().setActiveTab("grid");
  }}
  className="cursor-pointer"
/>
```

### Qdrant query_points with score_threshold (from existing similarity_service.py)
```python
# Source: existing SimilarityService.find_similar + Qdrant docs
results = self.client.query_points(
    collection_name=collection_name,
    query=list(vector),
    score_threshold=0.95,  # Only return near-duplicates
    limit=10,
    with_payload=True,
).points
```

### Qdrant scroll all points (from Qdrant Python client docs)
```python
# Source: qdrant-client docs
all_points = []
offset = None
while True:
    points, offset = self.client.scroll(
        collection_name=collection_name,
        limit=500,
        with_vectors=True,
        with_payload=True,
        offset=offset,
    )
    all_points.extend(points)
    if offset is None:
        break
```

### Confusion Matrix Cell Click -> Grid Filter (new pattern following codebase conventions)
```typescript
// Source: existing confusion-matrix.tsx + filter-store patterns
// Add onClick to each <td> in the confusion matrix
<td
  key={ci}
  className="p-1 text-center min-w-[32px] border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:ring-2 hover:ring-blue-500"
  style={{ backgroundColor: cellColor(norm, 1, ri === ci) }}
  onClick={() => {
    if (matrix[ri][ci] === 0) return; // No samples in this cell
    const actualClass = labels[ri];
    const predictedClass = labels[ci];
    onCellClick?.(actualClass, predictedClass);
  }}
>
```

### Find Similar -> Grid Filter (extending existing SampleModal pattern)
```typescript
// Source: existing sample-modal.tsx "Find Similar" button
// Instead of showing results in a panel, filter the main grid
async function handleFindSimilarInGrid(datasetId: string, sampleId: string) {
  const data = await apiFetch<SimilarityResponse>(
    `/datasets/${datasetId}/similarity/search?sample_id=${sampleId}&limit=50`
  );
  const ids = data.results.map((r) => r.sample_id);
  useFilterStore.getState().setSampleIdFilter(ids);
  useUIStore.getState().setActiveTab("grid");
  useUIStore.getState().closeDetailModal();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate filtered views per feature | Unified sample_ids filter pipe | Phase 5 (lasso selection) | All discovery features use the same grid filter mechanism |
| Custom similarity service | Qdrant embedded local mode | Phase 6 | HNSW index enables fast approximate search without external service |
| supervision.DetectionDataset.evaluate | supervision.MeanAveragePrecision + supervision.ConfusionMatrix | supervision 0.18+ | Modular API; confusion matrix is a separate computation |

**Deprecated/outdated:**
- Qdrant `search()` method: replaced by `query_points()` in qdrant-client 1.7+ (the codebase already uses `query_points`)
- supervision `DatasetEvaluator`: replaced by individual metric classes in supervision 0.20+

## Open Questions

Things that couldn't be fully resolved:

1. **Near-duplicate threshold value for DINOv2 embeddings**
   - What we know: Cosine similarity >0.95 generally catches near-duplicates. With DINOv2 768-dim embeddings, the actual optimal threshold depends on dataset characteristics.
   - What's unclear: The exact threshold that balances precision (not grouping merely similar images) vs recall (catching rotated/cropped duplicates).
   - Recommendation: Default to 0.95, expose as a slider (0.90-0.99) in the UI. Users can tune per dataset.

2. **Performance of near-duplicate scan for large datasets (>50K images)**
   - What we know: Each Qdrant query is O(log n) via HNSW, but scanning all n points means n queries total. For 100K images this could take 30-60 seconds.
   - What's unclear: Whether the Qdrant local-mode client handles this efficiently or if it needs batching.
   - Recommendation: Make near-duplicate detection an async operation with SSE progress (reuse existing SSE pattern from ingestion/embeddings). Show a progress bar and cache the results.

3. **Should discovery filter replace or intersect with existing filters?**
   - What we know: Lasso selection currently replaces other sample_id filters. Category filter from histogram click maps directly to the existing `category` parameter.
   - What's unclear: If user has split=val active and clicks a confusion matrix cell, should we preserve the split filter?
   - Recommendation: Discovery filters should add to (intersect with) existing filters. The `sample_ids` parameter already intersects with other filters in the backend's `SampleFilterBuilder`. So setting `sample_ids` + `split=val` correctly returns only matching samples in the val split.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `app/services/similarity_service.py` -- Qdrant integration patterns
- Existing codebase: `app/services/evaluation.py` -- confusion matrix computation
- Existing codebase: `frontend/src/stores/filter-store.ts` -- filter state management
- Existing codebase: `frontend/src/hooks/use-samples.ts` -- sample_ids query parameter integration
- Existing codebase: `frontend/src/components/stats/confusion-matrix.tsx` -- matrix rendering
- Existing codebase: `frontend/src/components/stats/class-distribution.tsx` -- Recharts bar chart
- Qdrant Python client docs: `query_points` with `score_threshold`, `scroll` API
- Recharts v3 docs: Bar `onClick` handler receives data entry object

### Secondary (MEDIUM confidence)
- Qdrant search documentation (https://qdrant.tech/documentation/concepts/search/) -- score_threshold semantics
- Recharts GitHub issues (#94, #966) -- onClick behavior confirmed for Bar component
- Community patterns for near-duplicate detection using cosine similarity threshold

### Tertiary (LOW confidence)
- Optimal DINOv2 near-duplicate threshold (0.95) -- based on general CV community practice, not verified with this specific embedding model

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies needed
- Architecture: HIGH -- extending existing patterns (sample_ids filter, Recharts onClick, Qdrant query_points)
- Pitfalls: HIGH -- derived from actual codebase analysis (URL length limits, confusion matrix data flow, O(n^2) scan)
- Near-duplicate threshold: LOW -- requires empirical validation per dataset

**Research date:** 2026-02-13
**Valid until:** 2026-03-13 (stable -- all libraries already locked in project)
