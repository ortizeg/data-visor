# Phase 11: Error Triage - Research

**Researched:** 2026-02-12
**Domain:** Error triage workflow for object detection datasets (tagging, visual highlight, scoring/ranking)
**Confidence:** HIGH

## Summary

Phase 11 adds a focused triage workflow to the existing error analysis system. The three requirements (TRIAGE-01, TRIAGE-02, TRIAGE-03) build directly on existing infrastructure: the `tags` column on samples, the `categorize_errors()` service, the filter store, the grid cell rendering, and the existing error analysis panel on the statistics dashboard.

The standard approach is: (1) extend the existing tags system to support structured triage tags (using a naming convention like `triage:fp`, `triage:tp`, `triage:fn`, `triage:mistake`), (2) add a highlight mode toggle to the UI store that applies CSS opacity dimming to non-error cells in the grid, and (3) create a new backend endpoint that computes a per-sample "worst score" combining error count, confidence spread, and embedding uniqueness, with a corresponding frontend ranking view.

**Primary recommendation:** Reuse the existing `samples.tags` column and `bulk-tag`/`bulk-untag` endpoints with a `triage:` prefix convention for triage tags. Implement highlight mode as a CSS-only concern in `GridCell`. Build the "worst images" scoring as a new backend service that aggregates error analysis data with optional Qdrant-based uniqueness.

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| DuckDB | existing | Triage tags persistence via `tags VARCHAR[]` on `samples` | Already stores tags, supports `list_contains`, `list_append`, `list_filter` |
| FastAPI | existing | REST endpoints for triage tag CRUD, worst-images ranking | Already has bulk-tag/untag, statistics, error-analysis routers |
| TanStack Query | existing | Data fetching, cache invalidation for triage operations | Already manages samples, annotations, error-analysis queries |
| Zustand | existing | UI state for highlight mode toggle, triage mode | Already has filter-store and ui-store patterns |
| Tailwind CSS | existing | Visual dimming for highlight mode via opacity classes | Already styles the entire UI |
| Recharts | existing | Any triage score visualizations | Already used in error-analysis-panel |

### Supporting (no new libraries needed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| numpy | existing | Error score computation (confidence spread, aggregation) | Worst images scoring backend |
| Qdrant | existing (embedded) | Uniqueness score via embedding distance | Optional component of worst-images score |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tags column for triage | Separate `triage_decisions` table | New table is cleaner but adds complexity; tags reuse existing CRUD and filter infrastructure |
| CSS opacity for highlight | SVG filter or canvas overlay | CSS opacity is simpler, performant, and works with existing GridCell structure |
| Backend-computed worst score | Frontend-computed score from error-analysis data | Backend computation scales better for large datasets and avoids sending all error data to client |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
# Backend additions
app/
├── services/
│   └── triage.py              # Worst-images scoring logic
├── models/
│   └── triage.py              # TriageScore, WorstImagesResponse models
└── routers/
    └── statistics.py          # Add worst-images endpoint (extend existing)

# Frontend additions
frontend/src/
├── hooks/
│   └── use-worst-images.ts    # TanStack Query hook for worst-images endpoint
├── components/
│   └── triage/
│       ├── triage-tag-button.tsx    # Quick-tag buttons (FP/TP/FN/mistake)
│       └── worst-images-panel.tsx   # Ranked worst-images view
├── stores/
│   └── ui-store.ts            # Add isHighlightMode state (extend existing)
└── types/
    └── triage.ts              # TypeScript types for worst-images response
```

### Pattern 1: Triage Tags via Convention
**What:** Use the existing `tags VARCHAR[]` column with a `triage:` prefix convention to distinguish triage decisions from user-created tags.
**When to use:** Always for TRIAGE-01. This avoids schema changes and reuses all existing tag infrastructure.
**Example:**
```python
# Backend: triage tags are just regular tags with a prefix
# Existing bulk-tag endpoint handles this without changes:
# PATCH /samples/bulk-tag
# { "dataset_id": "...", "sample_ids": ["..."], "tag": "triage:fp" }

# Valid triage tags:
TRIAGE_TAGS = {"triage:fp", "triage:tp", "triage:fn", "triage:mistake"}

# DuckDB query to find samples with any triage tag:
# SELECT * FROM samples WHERE list_has_any(tags, ['triage:fp', 'triage:tp', 'triage:fn', 'triage:mistake'])
```

```typescript
// Frontend: triage tag buttons in the detail modal and grid
const TRIAGE_OPTIONS = [
  { tag: "triage:fp", label: "FP", color: "red" },
  { tag: "triage:tp", label: "TP", color: "green" },
  { tag: "triage:fn", label: "FN", color: "orange" },
  { tag: "triage:mistake", label: "Mistake", color: "amber" },
] as const;

// Reuse existing useBulkTag mutation
const bulkTag = useBulkTag();
const handleTriageTag = (tag: string) => {
  bulkTag.mutate({
    dataset_id: datasetId,
    sample_ids: [sampleId],
    tag,
  });
};
```

### Pattern 2: Highlight Mode via CSS Opacity
**What:** Add `isHighlightMode` boolean to the UI store. When active, grid cells for non-error samples get `opacity-30` while error samples remain at full opacity.
**When to use:** TRIAGE-02 -- dims non-error samples to make errors visually prominent.
**Example:**
```typescript
// In ui-store.ts:
isHighlightMode: false,
toggleHighlightMode: () => set((s) => ({ isHighlightMode: !s.isHighlightMode })),

// In GridCell: determine if sample has error-related tags or appears in error analysis
const isHighlightMode = useUIStore((s) => s.isHighlightMode);
const hasTriageTag = sample.tags?.some((t) => t.startsWith("triage:"));
const isErrorSample = hasTriageTag || errorSampleIds?.has(sample.id);

// Apply dimming class
<button className={`... ${isHighlightMode && !isErrorSample ? "opacity-20" : ""}`}>
```

### Pattern 3: Worst-Images Scoring
**What:** Backend service that computes a composite score for each sample, ranking images by their "badness." Score = weighted combination of (error_count, confidence_spread, uniqueness).
**When to use:** TRIAGE-03.
**Example:**
```python
# app/services/triage.py
def compute_worst_images(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str,
    iou_threshold: float,
    conf_threshold: float,
    split: str | None = None,
    limit: int = 50,
) -> list[TriageScore]:
    """Rank samples by combined error score.

    Score components:
    1. error_count: number of non-TP detections per sample
    2. confidence_spread: std deviation of prediction confidences
       (high spread = model is confused about this image)
    3. uniqueness: 1 - avg cosine similarity to k nearest neighbors
       (unique samples are harder to fix by getting more data)
    """
    # Step 1: Run error categorization per sample
    # Step 2: Aggregate per-sample error counts
    # Step 3: Compute confidence spread per sample
    # Step 4: (Optional) Query Qdrant for uniqueness scores
    # Step 5: Normalize and combine: score = w1*errors + w2*conf_spread + w3*uniqueness
```

### Pattern 4: Extending Existing Filter Infrastructure
**What:** The triage tags work with the existing filter sidebar's tag filter. Users can filter the grid to show only `triage:fp` samples using the existing tag filtering.
**When to use:** Triage tags automatically appear in filter-facets and work with existing tag filters.
**Example:**
```typescript
// Already works: filter-facets endpoint returns triage tags
// because they're stored in the same tags column.
// No code changes needed for basic tag filtering.
```

### Anti-Patterns to Avoid
- **Separate triage table:** Adding a new `triage_decisions` table would require new CRUD endpoints, new query joins, new filter builder methods -- all duplicating existing tag infrastructure. Use the `tags` column instead.
- **Frontend-only error scoring:** Computing worst-images scores entirely on the frontend would require shipping all error analysis data to the client. Do this server-side.
- **Annotation-level triage in a new column:** The requirement says "tag individual samples/annotations as FP, TP, FN, or mistake." For annotations, the triage tag should apply to the sample (since annotations don't have a tags column), with the error type inferred from the error analysis. Adding a tags column to annotations would require schema migration and changing all annotation queries.
- **Mutating the error analysis service:** The `categorize_errors()` function is read-only and computes categories on the fly. Triage tags are a human-override on top of this, stored separately as tags.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tag persistence | Custom triage_decisions table | Existing `samples.tags` column + bulk-tag endpoint | Full CRUD already exists, filter integration free |
| Tag filtering | Custom triage filter logic | Existing `add_tags()` in SampleFilterBuilder | `list_contains(s.tags, ?)` already works |
| Cache invalidation | Manual query cache updates | TanStack Query `invalidateQueries` on `["samples"]` | Already used by `useBulkTag` hook |
| Error sample identification | Custom error detection per grid cell | Reuse `categorize_errors()` sample_ids from error-analysis endpoint | Already computes TP/FP/FN per sample |
| Composite scoring normalization | Manual min-max normalization | numpy `(x - min) / (max - min)` vectorized | Handles edge cases, NaN safety |

**Key insight:** The entire tagging infrastructure (backend endpoints, DuckDB operations, frontend mutations, cache invalidation, filter integration) already exists. TRIAGE-01 is essentially a UI enhancement that provides quick-access buttons to invoke the existing `bulk-tag` endpoint with specific tag values.

## Common Pitfalls

### Pitfall 1: Triage Tags Conflicting with User Tags
**What goes wrong:** If triage tags use the same naming space as user-created tags, users might accidentally create tags like "fp" that look like triage decisions.
**Why it happens:** No namespace separation between triage and user tags.
**How to avoid:** Use a `triage:` prefix convention. Frontend should only show triage buttons for the four valid values. The filter sidebar can visually separate triage tags from regular tags.
**Warning signs:** Tags like "fp" or "false positive" appearing alongside "triage:fp".

### Pitfall 2: Highlight Mode Requiring Error Analysis Fetch on Every Grid Render
**What goes wrong:** If highlight mode needs to know which samples have errors, and the grid has thousands of samples, fetching error analysis for every grid page is expensive.
**Why it happens:** Error analysis returns up to `_MAX_SAMPLES_PER_TYPE = 50` samples per error type. If the user has more than 50 errors, some error samples won't be identified.
**How to avoid:** Two-pronged approach: (a) samples that already have `triage:` tags are highlighted regardless (these are user-confirmed), (b) for non-tagged samples, use the error analysis API but accept the cap of 50 per type. Alternatively, add a dedicated endpoint that returns just the set of sample_ids with errors (no cap). The simplest first approach: highlight only samples that have triage tags, since those are the ones the user has reviewed.
**Warning signs:** Grid rendering slowing down when highlight mode is active.

### Pitfall 3: Worst-Images Score Without Predictions
**What goes wrong:** The worst-images endpoint is called for datasets without predictions loaded, resulting in an error or empty results.
**Why it happens:** Error analysis requires predictions to compute TP/FP/FN.
**How to avoid:** Frontend should only show the worst-images view when predictions exist (same guard as the existing error analysis panel which checks `hasPredictions`). Backend should return an empty list gracefully.
**Warning signs:** 404 errors from error-analysis endpoint.

### Pitfall 4: Removing Previous Triage Tag Before Adding New One
**What goes wrong:** A sample gets tagged with both `triage:fp` and `triage:tp` because the user changed their mind but both tags persist.
**Why it happens:** `bulk-tag` endpoint only adds tags; it doesn't remove previous triage tags.
**How to avoid:** When applying a triage tag, first `bulk-untag` all existing triage tags, then `bulk-tag` the new one. Or create a dedicated `/samples/set-triage-tag` endpoint that atomically replaces the triage tag. A single-operation approach is better for UX.
**Warning signs:** Samples appearing in multiple triage categories.

### Pitfall 5: CSS Opacity Affecting Annotation Overlays
**What goes wrong:** When `opacity-20` is applied to the grid cell container, the annotation overlay SVG also becomes transparent, making it hard to see which error annotations are on highlighted images.
**Why it happens:** CSS opacity is inherited by all children.
**How to avoid:** Apply opacity only to the `<img>` element, not the entire cell. Or use a semi-transparent overlay div on top of non-error cells instead of opacity.
**Warning signs:** Error annotations becoming invisible on dimmed cells.

## Code Examples

### Triage Tag Atomic Set (Backend)
```python
# A dedicated endpoint to atomically set a triage tag
# (removes any existing triage tag and sets the new one)

TRIAGE_PREFIX = "triage:"
VALID_TRIAGE_TAGS = {"triage:fp", "triage:tp", "triage:fn", "triage:mistake"}

@router.patch("/samples/set-triage-tag")
def set_triage_tag(
    request: SetTriageTagRequest,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Atomically set a triage tag on a sample (removes previous triage tag)."""
    if request.tag not in VALID_TRIAGE_TAGS:
        raise HTTPException(400, f"Invalid triage tag: {request.tag}")

    cursor = db.connection.cursor()
    try:
        # Remove all existing triage: tags, then add the new one
        cursor.execute(
            "UPDATE samples SET tags = list_distinct(list_append("
            "  list_filter(COALESCE(tags, []), x -> NOT starts_with(x, ?)),"
            "  ?"
            ")) WHERE dataset_id = ? AND id = ?",
            [TRIAGE_PREFIX, request.tag, request.dataset_id, request.sample_id],
        )
    finally:
        cursor.close()
    return {"sample_id": request.sample_id, "tag": request.tag}
```

### Triage Tag Removal (Backend)
```python
@router.delete("/samples/{sample_id}/triage-tag")
def remove_triage_tag(
    sample_id: str,
    dataset_id: str = Query(...),
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Remove all triage tags from a sample."""
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            "UPDATE samples SET tags = list_filter("
            "  COALESCE(tags, []), x -> NOT starts_with(x, ?)"
            ") WHERE dataset_id = ? AND id = ?",
            [TRIAGE_PREFIX, dataset_id, sample_id],
        )
    finally:
        cursor.close()
    return {"sample_id": sample_id, "cleared": True}
```

### Worst-Images Scoring (Backend)
```python
# app/services/triage.py
import numpy as np
from collections import defaultdict

def compute_worst_images(
    cursor, dataset_id, source, iou_threshold, conf_threshold,
    split=None, limit=50,
):
    """Compute ranked list of worst samples by composite error score."""
    from app.services.error_analysis import categorize_errors

    # Get full error analysis
    result = categorize_errors(
        cursor, dataset_id, source, iou_threshold, conf_threshold, split=split
    )

    # Aggregate per-sample error counts
    sample_errors = defaultdict(lambda: {"error_count": 0, "confidences": []})
    for error_type, samples in result.samples_by_type.items():
        for s in samples:
            if error_type != "tp":  # Non-TP = errors
                sample_errors[s.sample_id]["error_count"] += 1
            if s.confidence is not None:
                sample_errors[s.sample_id]["confidences"].append(s.confidence)

    # Compute per-sample scores
    scores = []
    for sample_id, data in sample_errors.items():
        conf_spread = float(np.std(data["confidences"])) if len(data["confidences"]) > 1 else 0.0
        scores.append({
            "sample_id": sample_id,
            "error_count": data["error_count"],
            "confidence_spread": conf_spread,
            "score": 0.0,  # Computed after normalization
        })

    if not scores:
        return []

    # Normalize and combine
    max_errors = max(s["error_count"] for s in scores) or 1
    max_spread = max(s["confidence_spread"] for s in scores) or 1.0

    for s in scores:
        norm_errors = s["error_count"] / max_errors
        norm_spread = s["confidence_spread"] / max_spread
        s["score"] = 0.6 * norm_errors + 0.4 * norm_spread

    # Sort by score descending, return top N
    scores.sort(key=lambda s: -s["score"])
    return scores[:limit]
```

### Highlight Mode Toggle (Frontend)
```typescript
// In ui-store.ts -- add to existing UIState interface
isHighlightMode: boolean;
toggleHighlightMode: () => void;

// In store implementation
isHighlightMode: false,
toggleHighlightMode: () => set((s) => ({ isHighlightMode: !s.isHighlightMode })),
```

### GridCell Dimming (Frontend)
```typescript
// In grid-cell.tsx -- add highlight mode check
const isHighlightMode = useUIStore((s) => s.isHighlightMode);
const hasTriageTag = sample.tags?.some((t) => t.startsWith("triage:"));

// In the JSX, apply opacity to the image container
<div className={`relative aspect-square overflow-hidden ${
  isHighlightMode && !hasTriageTag ? "opacity-20" : ""
}`}>
```

### Triage Buttons Component (Frontend)
```typescript
// components/triage/triage-tag-button.tsx
const TRIAGE_OPTIONS = [
  { tag: "triage:tp", label: "TP", colorClass: "bg-green-500 hover:bg-green-600" },
  { tag: "triage:fp", label: "FP", colorClass: "bg-red-500 hover:bg-red-600" },
  { tag: "triage:fn", label: "FN", colorClass: "bg-orange-500 hover:bg-orange-600" },
  { tag: "triage:mistake", label: "Mistake", colorClass: "bg-amber-500 hover:bg-amber-600" },
] as const;

// Active triage tag derived from sample.tags
const activeTriageTag = sample.tags?.find((t) => t.startsWith("triage:")) ?? null;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate triage/review tables | Tag-based triage with prefix conventions | Industry standard in FiftyOne, CVAT, Label Studio | Simpler schema, reusable filter infrastructure |
| Manual error review without scoring | Composite scoring (error count + confidence spread + uniqueness) | Common in ML data tools since ~2023 | Surfaces worst samples first, saves reviewer time |
| Full-page triage workflow | In-context triage within existing grid | FiftyOne/Voxel51 approach | Users don't lose context switching between views |

**Deprecated/outdated:**
- None. This phase builds on existing established patterns.

## Open Questions

1. **Uniqueness score from Qdrant**
   - What we know: Qdrant stores embeddings and supports nearest-neighbor queries. Uniqueness = how far a sample's embedding is from its neighbors.
   - What's unclear: Whether computing uniqueness for all error samples is fast enough to include in the worst-images scoring. A full Qdrant scan for each sample's nearest neighbors could be slow for large datasets.
   - Recommendation: Make uniqueness an optional component. Start with just error_count + confidence_spread (two components). Add uniqueness in a follow-up if performance allows. Use a batch Qdrant query rather than per-sample queries.

2. **Annotation-level vs sample-level triage**
   - What we know: TRIAGE-01 says "tag individual samples/annotations as FP, TP, FN, or mistake." Annotations table has no `tags` column.
   - What's unclear: Whether users truly need annotation-level triage (tagging specific bounding boxes) or if sample-level triage suffices.
   - Recommendation: Implement sample-level triage using the existing `tags` column. This covers the primary use case (reviewing and classifying images). Annotation-level triage would require schema changes. The error analysis already classifies individual detections automatically; human triage is about overriding at the sample level.

3. **Error sample ID set for highlight mode**
   - What we know: The error analysis endpoint returns up to 50 samples per error type (capped by `_MAX_SAMPLES_PER_TYPE`). Highlight mode needs to know which samples have errors.
   - What's unclear: For datasets with hundreds of error samples, the 50-sample cap means highlight mode won't catch all errors.
   - Recommendation: For Phase 11, highlight samples that have `triage:` tags (human-confirmed). Optionally increase `_MAX_SAMPLES_PER_TYPE` or add a dedicated "error sample IDs" endpoint that returns just IDs (lightweight, no cap). Alternatively, add a new endpoint that returns just the set of error sample IDs.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `app/services/error_analysis.py` -- existing error categorization with TP/FP/FN/Label Error
- Codebase analysis: `app/routers/samples.py` -- existing bulk-tag/untag endpoints with DuckDB list operations
- Codebase analysis: `app/repositories/duckdb_repo.py` -- schema with `tags VARCHAR[]` column on samples
- Codebase analysis: `frontend/src/stores/filter-store.ts` -- existing tag filter integration
- Codebase analysis: `frontend/src/stores/ui-store.ts` -- existing UI state pattern for modes
- Codebase analysis: `frontend/src/components/grid/grid-cell.tsx` -- existing cell rendering with tag badges
- Codebase analysis: `frontend/src/hooks/use-tags.ts` -- existing bulk tag mutation hooks
- Codebase analysis: `frontend/src/components/stats/error-analysis-panel.tsx` -- existing error analysis UI
- Codebase analysis: `frontend/src/components/stats/error-samples-grid.tsx` -- existing error sample thumbnails

### Secondary (MEDIUM confidence)
- DuckDB documentation: `list_filter`, `starts_with`, `list_has_any` functions for tag manipulation
- FiftyOne/Voxel51 design patterns for in-context triage workflows

### Tertiary (LOW confidence)
- Composite error scoring weights (0.6 errors, 0.4 confidence spread) are a reasonable starting point but may need tuning based on user feedback

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed; all infrastructure exists
- Architecture: HIGH - Direct extensions of existing patterns (tags, UI store, filter builder)
- Pitfalls: HIGH - Identified from direct code analysis of existing implementations
- Worst-images scoring: MEDIUM - Algorithm design is sound but weight tuning is empirical

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (stable -- no external dependencies to go stale)
