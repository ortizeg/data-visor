# Phase 17: Classification Polish - Research

**Researched:** 2026-02-18
**Domain:** High-cardinality confusion matrix rendering, embedding scatter coloring, most-confused pairs, per-class sparklines
**Confidence:** HIGH (all four requirements are frontend-focused UI enhancements on existing infrastructure, no new backend services or libraries needed)

## Summary

Phase 17 polishes the classification evaluation experience for production use with high-cardinality datasets (43+ classes). It addresses four distinct UI gaps: (1) the current confusion matrix renders as an HTML table which becomes unreadable at 43+ classes -- it needs threshold filtering to hide low-value cells and overflow handling; (2) the embedding scatter plot currently colors all points uniformly blue but should support coloring by GT class, predicted class, or correct/incorrect status; (3) the confusion matrix data already contains all information needed to derive a ranked list of most-confused class pairs, but no summary is surfaced; (4) the per-class metrics table shows raw numbers but lacks visual sparklines with color-coded thresholds for quick scanning.

All four requirements are frontend-focused with minimal backend changes. The existing `ClassificationEvaluationResponse` already returns `confusion_matrix`, `confusion_matrix_labels`, and `per_class_metrics` -- enough data for requirements POLISH-01, POLISH-03, and POLISH-04 without backend changes. POLISH-02 requires enriching the embedding coordinates endpoint to include GT and predicted labels per sample, or fetching annotation data separately to join client-side.

**Primary recommendation:** Implement all four requirements as frontend enhancements. For the confusion matrix (POLISH-01), use the existing HTML table approach with a threshold filter slider (hide cells below N%) and `overflow-auto` with `max-h`/`max-w` constraints rather than migrating to canvas -- the HTML table already uses cell-level color intensity and is easier to maintain. For embedding coloring (POLISH-02), extend the backend `/coordinates` endpoint to include `gtLabel` and `predLabel` per point so the `getFillColor` accessor can use a categorical color palette. For most-confused pairs (POLISH-03), derive from the existing confusion matrix client-side. For sparklines (POLISH-04), use Recharts `LineChart` with hidden axes to create inline SVG sparklines.

## Standard Stack

### Core (already in use -- no new dependencies)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| Recharts | ^3.7.0 | Sparkline mini charts in per-class table | In use |
| deck.gl | ^9.2.6 | ScatterplotLayer `getFillColor` accessor for categorical coloring | In use |
| React/Next.js | - | Component rendering, memoization | In use |
| DuckDB | - | JOIN annotations to embedding coordinates (backend) | In use |
| Tailwind CSS | - | Styling, responsive overflow containers | In use |

### Supporting (no new libraries needed)

The sparkline requirement can be met with Recharts `LineChart` + `Line` with hidden axes in a small container (~60x20px). No dedicated sparkline library is needed. The Recharts `LineChart` component supports `width`/`height` props directly (no `ResponsiveContainer` needed for fixed-size inline use).

For categorical color palettes in the embedding scatter, a static array of 20-50 distinct colors is sufficient. D3's categorical color scales (`d3-scale-chromatic`) are NOT in the dependency tree and would be overkill -- a hardcoded palette of ~20 colors with hashing for overflow is simpler and has zero bundle impact.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HTML table with threshold filter (confusion matrix) | Canvas-based heatmap (e.g., custom Canvas2D) | Canvas handles extreme sizes better but loses click interactivity, accessibility, and requires more complex implementation. HTML table with threshold filtering handles 43 classes well enough. |
| Recharts inline LineChart (sparklines) | SVG `<polyline>` or `<path>` by hand | Recharts is already imported; hand-rolling SVG paths saves ~1KB per sparkline but adds maintenance burden. |
| Recharts inline LineChart (sparklines) | `react-sparklines` library | Adds a new dependency for something Recharts already supports. |
| Backend label enrichment on /coordinates | Client-side JOIN via separate annotations fetch | Backend is cleaner (single fetch, no N+1). Frontend JOIN requires fetching all annotations for all samples which is already available in batch-annotations but couples embedding panel to annotation data. |

## Architecture Patterns

### Recommended Change Map

```
Backend:
  app/services/reduction_service.py    # MODIFY: get_coordinates JOIN to include GT/pred labels
  (or) app/routers/embeddings.py       # MODIFY: accept color_mode query param, enrich response

Frontend:
  types/embedding.ts                   # MODIFY: add gtLabel, predLabel to EmbeddingPoint
  components/embedding/embedding-scatter.tsx   # MODIFY: accept colorMode prop, use categorical getFillColor
  components/embedding/embedding-panel.tsx     # MODIFY: add color mode dropdown, pass datasetType, pass colorMode
  components/stats/confusion-matrix.tsx        # MODIFY: add threshold slider, overflow constraints, max-h/max-w
  components/stats/evaluation-panel.tsx        # MODIFY: add MostConfusedPairs component, add sparklines to per-class table
  (or) components/stats/most-confused-pairs.tsx  # NEW: ranked list of most confused (gt, pred) pairs
  (or) components/stats/per-class-sparkline.tsx  # NEW: inline Recharts sparkline
  app/datasets/[datasetId]/page.tsx    # MODIFY: pass datasetType to EmbeddingPanel
```

### Pattern 1: Confusion Matrix Threshold Filtering (POLISH-01)

**What:** Add a slider that filters out confusion matrix cells below a threshold percentage, making high-cardinality matrices readable.
**When to use:** When label count >= ~15 classes.

The current `ConfusionMatrix` component row-normalizes and renders all cells. At 43 classes, this is 1,849 cells -- most with 0.00 values. The fix:

1. Add a `threshold` state (0.0 to 0.5, default 0.01) with a slider in the matrix header
2. Cells below threshold render as empty (no text, transparent background)
3. Wrap the table in a container with `max-h-[500px] max-w-full overflow-auto` for scroll
4. Make cell size smaller for high-cardinality: `min-w-[24px]` instead of `min-w-[32px]` when labels > 20
5. Truncate long label text with `max-w-[80px] truncate` on row/column headers

```tsx
// In confusion-matrix.tsx
const [threshold, setThreshold] = useState(0.01);
const isHighCardinality = labels.length > 20;

// In the cell render:
{norm >= threshold ? (
  <span>{norm.toFixed(2)}</span>
) : null}
```

No canvas rendering needed. The HTML table with threshold filtering, scroll overflow, and compact cell sizing handles 43 classes adequately. Tested reasoning: 43x43 = 1,849 `<td>` elements is trivial for the browser DOM. Canvas would only be justified at 200+ classes.

### Pattern 2: Embedding Scatter Color Modes (POLISH-02)

**What:** A dropdown in the embedding toolbar that switches point coloring between: "Default" (uniform blue), "GT Class", "Predicted Class", "Correct/Incorrect".
**When to use:** Classification datasets with predictions imported.

**Backend change:** Enrich `get_coordinates` to JOIN annotation labels:

```python
# In reduction_service.py get_coordinates
SELECT e.sample_id, e.x, e.y, s.file_name, s.thumbnail_path,
       gt.category_name as gt_label,
       pred.category_name as pred_label
FROM embeddings e
JOIN samples s ON e.sample_id = s.id AND e.dataset_id = s.dataset_id
LEFT JOIN annotations gt ON gt.sample_id = s.id AND gt.dataset_id = s.dataset_id
    AND gt.source = 'ground_truth'
LEFT JOIN annotations pred ON pred.sample_id = s.id AND pred.dataset_id = s.dataset_id
    AND pred.source != 'ground_truth'
WHERE e.dataset_id = ? AND e.x IS NOT NULL
```

Note: This LEFT JOINs so points without annotations still appear. For multi-source predictions, pick the first non-GT source or accept NULL.

**Frontend change:** The `EmbeddingScatter` component's `getFillColor` accessor switches based on `colorMode`:

```tsx
type ColorMode = "default" | "gt_class" | "pred_class" | "correctness";

// Categorical palette (20 distinct colors, cycle with modulo for overflow)
const PALETTE: [number,number,number,number][] = [
  [31,119,180,200], [255,127,14,200], [44,160,44,200], [214,39,40,200],
  [148,103,189,200], [140,86,75,200], [227,119,194,200], [127,127,127,200],
  // ... 12 more ...
];

getFillColor: (d) => {
  if (colorMode === "gt_class" && d.gtLabel) {
    return PALETTE[labelIndex.get(d.gtLabel)! % PALETTE.length];
  }
  if (colorMode === "pred_class" && d.predLabel) {
    return PALETTE[labelIndex.get(d.predLabel)! % PALETTE.length];
  }
  if (colorMode === "correctness") {
    if (!d.predLabel) return [180,180,180,100]; // no prediction: gray
    return d.gtLabel === d.predLabel
      ? [44,160,44,200]   // correct: green
      : [214,39,40,200];  // incorrect: red
  }
  return [100,120,220,200]; // default blue
}
```

The `labelIndex` is a `Map<string, number>` built from unique labels in the points array, sorted alphabetically for stable color assignment.

**Key concern:** The `EmbeddingPanel` currently receives only `datasetId`. It needs `datasetType` to know whether to show the color mode dropdown. The page already has `dataset?.dataset_type` -- thread it through as a prop.

### Pattern 3: Most-Confused Class Pairs (POLISH-03)

**What:** A ranked list derived from the confusion matrix showing the top-N most confused (actual, predicted) pairs.
**When to use:** Always shown below/beside the confusion matrix when classification evaluation data is available.

This is a pure frontend derivation -- no backend change needed. The confusion matrix and labels are already in `ClassificationEvaluationResponse`.

```tsx
function getMostConfusedPairs(
  matrix: number[][],
  labels: string[],
  topN: number = 10,
): { actual: string; predicted: string; count: number; pct: number }[] {
  const pairs: { actual: string; predicted: string; count: number; pct: number }[] = [];
  for (let i = 0; i < matrix.length; i++) {
    const rowSum = matrix[i].reduce((a, b) => a + b, 0);
    for (let j = 0; j < matrix[i].length; j++) {
      if (i === j) continue; // skip diagonal (correct predictions)
      if (matrix[i][j] === 0) continue;
      pairs.push({
        actual: labels[i],
        predicted: labels[j],
        count: matrix[i][j],
        pct: rowSum > 0 ? matrix[i][j] / rowSum : 0,
      });
    }
  }
  pairs.sort((a, b) => b.count - a.count);
  return pairs.slice(0, topN);
}
```

Render as a compact table: rank, actual class, arrow, predicted class, count, percentage. Clicking a row could trigger the existing confusion cell click-to-filter behavior.

### Pattern 4: Per-Class Sparklines with Color-Coded Thresholds (POLISH-04)

**What:** Add a small inline sparkline to each row of the per-class metrics table, with color coding: green (F1 >= 0.8), yellow (0.5 <= F1 < 0.8), red (F1 < 0.5).
**When to use:** Always shown in the classification per-class table.

The "sparkline" for per-class metrics is a bit ambiguous since each class has a single F1 value, not a time series. Two interpretations:

**Interpretation A: Per-class metric bar (precision/recall/F1 as a small bar chart)**
A tiny 3-bar chart (P, R, F1) for each class, giving a visual summary per row. This is more useful than a line sparkline for single-point-in-time data.

**Interpretation B: Confidence-threshold sweep sparkline**
Show how F1 varies as confidence threshold changes. This requires computing F1 at multiple thresholds (backend change needed -- return F1 at e.g. 5 threshold values).

**Recommendation: Interpretation A** is simpler and requires no backend changes. Three small bars (P, R, F1) using Recharts `BarChart` with hidden axes, color-coded by the F1 threshold:

```tsx
function PerClassSparkline({ precision, recall, f1 }: { precision: number; recall: number; f1: number }) {
  const color = f1 >= 0.8 ? "#22c55e" : f1 >= 0.5 ? "#eab308" : "#ef4444";
  const data = [
    { name: "P", value: precision },
    { name: "R", value: recall },
    { name: "F1", value: f1 },
  ];
  return (
    <BarChart width={48} height={20} data={data}>
      <Bar dataKey="value" fill={color} radius={1} />
    </BarChart>
  );
}
```

Alternatively, a simpler approach: just a colored horizontal bar representing F1 (0-1 scale) with background showing "full" (1.0). No Recharts needed -- pure CSS:

```tsx
<div className="w-16 h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
  <div
    className="h-full rounded-full"
    style={{
      width: `${f1 * 100}%`,
      backgroundColor: f1 >= 0.8 ? "#22c55e" : f1 >= 0.5 ? "#eab308" : "#ef4444",
    }}
  />
</div>
```

The CSS bar is simpler, zero-dependency, and arguably clearer for a single metric. **Recommend the CSS bar approach** unless the user specifically wants a multi-metric sparkline.

### Anti-Patterns to Avoid

- **Canvas confusion matrix for 43 classes:** Canvas loses click interactivity, text rendering quality, and accessibility. HTML table with threshold filtering is adequate for this scale.
- **Fetching all annotations separately for embedding coloring:** This creates an N+1 or large-batch problem. Better to enrich the `/coordinates` endpoint with a JOIN.
- **Computing most-confused pairs on the backend:** The confusion matrix is already transmitted. Deriving pairs client-side avoids a new endpoint and keeps the backend simple.
- **Using ResponsiveContainer for sparklines in table cells:** ResponsiveContainer requires a parent with explicit dimensions. In table cells, use fixed `width`/`height` props on the chart directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Categorical color palette | Dynamic color generation HSL math | Static 20-color palette array | Reproducible, visually distinct, no computation |
| Sparkline chart | Custom SVG `<path>` calculation | Recharts BarChart or CSS bar | Already in dependency tree, consistent styling |
| Most-confused pairs | New backend endpoint | Client-side derivation from confusion matrix | Data already on client, O(N^2) is trivial for N<=50 |
| Overflow scroll on confusion matrix | Custom virtual scrolling | CSS `overflow-auto` with `max-h`/`max-w` | 43x43 DOM elements is trivial, no virtualization needed |

**Key insight:** All four requirements are UI refinements on data that is already available in the frontend. The only backend change needed is enriching embedding coordinates with annotation labels for POLISH-02.

## Common Pitfalls

### Pitfall 1: Threshold Slider Hides All Cells
**What goes wrong:** If the user sets the confusion matrix threshold too high, all off-diagonal cells disappear, making the matrix look like nothing is wrong.
**Why it happens:** Most off-diagonal values in a well-performing model are very small fractions (0.01-0.05).
**How to avoid:** Set a sensible default (0.01 = 1%), show a "N cells hidden" count, and never hide diagonal cells regardless of threshold.
**Warning signs:** Confusion matrix appears nearly empty with all off-diagonal cells blank.

### Pitfall 2: Embedding Color Mode Without Predictions
**What goes wrong:** User selects "Predicted Class" or "Correct/Incorrect" color mode but no predictions are imported. All points turn gray.
**Why it happens:** The `predLabel` field is null for all points when no predictions exist.
**How to avoid:** Disable "Predicted Class" and "Correct/Incorrect" options in the dropdown when no predictions exist. Check for the presence of prediction sources (same `hasPredictions` logic used in stats dashboard).
**Warning signs:** All points are gray/identical color in a non-"Default" mode.

### Pitfall 3: Too Many Classes for Color Palette
**What goes wrong:** With 43+ classes, the 20-color palette cycles and multiple classes share the same color, reducing the scatter plot's usefulness.
**Why it happens:** Human color discrimination is limited to ~20 distinct hues.
**How to avoid:** Accept this limitation and mitigate: (1) show a legend that maps colors to classes (scrollable), (2) use hover tooltip to show the exact class name, (3) for 20+ classes, recommend "Correct/Incorrect" mode which only needs 3 colors (correct/incorrect/no-prediction).
**Warning signs:** Multiple visually distinct clusters in the scatter plot share the same color.

### Pitfall 4: Stale Embedding Coordinates After Prediction Import
**What goes wrong:** User imports predictions, switches to Embeddings tab, but coordinates don't include the new `predLabel` because the TanStack Query cache is stale (staleTime: Infinity).
**Why it happens:** Embedding coordinates query uses `staleTime: Infinity` -- it never refetches automatically.
**How to avoid:** After prediction import completes, invalidate the `embedding-coordinates` query key. The prediction import dialog already invalidates several query keys on success -- add `embedding-coordinates` to that list.
**Warning signs:** Color mode shows all points as "no prediction" (gray) even after importing predictions.

### Pitfall 5: Multiple Prediction Sources Per Sample
**What goes wrong:** If a sample has predictions from multiple sources (e.g., "model_v1" and "model_v2"), the JOIN in get_coordinates returns duplicate rows per sample.
**Why it happens:** LEFT JOIN on annotations with source != 'ground_truth' matches multiple rows.
**How to avoid:** Either: (1) use a subquery with LIMIT 1 per sample, or (2) accept a `source` query parameter on the coordinates endpoint to filter to one prediction source, or (3) pick the first non-GT source with ROW_NUMBER(). Option (2) is cleanest -- matches how the evaluation panel already handles source selection.
**Warning signs:** Duplicate points in the scatter plot (same x,y but different pred labels).

### Pitfall 6: Classification-Only Multi-Label GT in Embeddings
**What goes wrong:** If a sample has multiple GT annotations (multi-label), the coordinates JOIN returns duplicate rows.
**Why it happens:** Same as Pitfall 5 but for GT side.
**How to avoid:** Use MIN(gt.category_name) or GROUP BY to collapse to one GT label per sample, matching the pattern in `compute_classification_evaluation`.
**Warning signs:** Point count in scatter differs from embedding count shown in toolbar.

## Code Examples

### Confusion Matrix with Threshold Filter

```tsx
// confusion-matrix.tsx additions
const [threshold, setThreshold] = useState(0.01);

// In the header area:
<div className="flex items-center gap-2">
  <label className="text-xs text-zinc-500">Min:</label>
  <input
    type="range" min={0} max={0.5} step={0.01}
    value={threshold}
    onChange={(e) => setThreshold(parseFloat(e.target.value))}
    className="w-20 accent-blue-500"
  />
  <span className="text-xs font-mono text-zinc-400">{(threshold*100).toFixed(0)}%</span>
</div>

// Wrap table in scrollable container:
<div className="overflow-auto max-h-[500px]">
  <table>...</table>
</div>

// Cell rendering:
const showValue = norm >= threshold || ri === ci; // always show diagonal
```

### Enriched Coordinates Query (Backend)

```python
# reduction_service.py get_coordinates -- enriched for classification
def get_coordinates(self, dataset_id: str, cursor, source: str | None = None) -> list[dict]:
    source_clause = "AND pred.source = ?" if source else ""
    params = [dataset_id]
    if source:
        params.append(source)

    result = cursor.execute(f"""
        SELECT e.sample_id, e.x, e.y, s.file_name, s.thumbnail_path,
               MIN(gt.category_name) as gt_label,
               MIN(pred.category_name) as pred_label
        FROM embeddings e
        JOIN samples s ON e.sample_id = s.id AND e.dataset_id = s.dataset_id
        LEFT JOIN annotations gt ON gt.sample_id = s.id AND gt.dataset_id = s.dataset_id
            AND gt.source = 'ground_truth'
        LEFT JOIN annotations pred ON pred.sample_id = s.id AND pred.dataset_id = s.dataset_id
            AND pred.source != 'ground_truth' {source_clause}
        WHERE e.dataset_id = ? AND e.x IS NOT NULL
        GROUP BY e.sample_id, e.x, e.y, s.file_name, s.thumbnail_path
        ORDER BY e.sample_id
    """, params + [dataset_id] if source else [dataset_id]).fetchall()

    return [
        {
            "sampleId": r[0], "x": r[1], "y": r[2],
            "fileName": r[3], "thumbnailPath": r[4],
            "gtLabel": r[5], "predLabel": r[6],
        }
        for r in result
    ]
```

### Color Mode Dropdown and Palette

```tsx
// embedding-panel.tsx toolbar addition
const COLOR_MODES = [
  { value: "default", label: "Default" },
  { value: "gt_class", label: "GT Class" },
  { value: "pred_class", label: "Predicted Class" },
  { value: "correctness", label: "Correct / Incorrect" },
] as const;

<select
  value={colorMode}
  onChange={(e) => setColorMode(e.target.value as ColorMode)}
  className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-xs px-2 py-1"
>
  {COLOR_MODES.map((m) => (
    <option key={m.value} value={m.value} disabled={
      !hasPredictions && (m.value === "pred_class" || m.value === "correctness")
    }>
      {m.label}
    </option>
  ))}
</select>
```

### CSS F1 Bar (Sparkline Alternative)

```tsx
function F1Bar({ f1 }: { f1: number }) {
  const color = f1 >= 0.8 ? "bg-green-500" : f1 >= 0.5 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-16 h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${f1 * 100}%` }} />
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full HTML table for all cells | Threshold-filtered table with overflow scroll | Phase 17 | Readable at 43+ classes |
| Uniform blue scatter points | Categorical coloring by class/correctness | Phase 17 | Instant visual insight on embedding clusters |
| Raw confusion matrix only | Most-confused pairs summary | Phase 17 | Actionable: top error modes at a glance |
| Numbers-only per-class table | Color-coded F1 bars | Phase 17 | Scan 43 classes in seconds |

**Deprecated/outdated:**
- Nothing deprecated. All enhancements build on Phase 16 output.

## Open Questions

1. **Sparkline interpretation: single-metric bar vs multi-threshold sweep**
   - What we know: Each class has one P, R, F1 value at the current confidence threshold. A "sparkline" traditionally implies a time-series line.
   - What's unclear: Does the user want a single F1 bar per class, or a mini-chart showing how F1 varies across confidence thresholds?
   - Recommendation: Implement a color-coded F1 bar (green/yellow/red) first. If confidence-sweep sparklines are desired, they require a backend change to return F1 at multiple thresholds per class (more complex). Defer to a follow-up.

2. **Embedding color legend visibility at 43+ classes**
   - What we know: A legend for 43 classes takes significant vertical space and many colors are visually similar.
   - What's unclear: Should the legend be always-visible, collapsed/expandable, or omitted in favor of hover tooltips?
   - Recommendation: Show a scrollable legend panel (max-h with overflow) for GT/Pred class modes. For "Correct/Incorrect" mode, show a simple 3-item legend (correct/incorrect/no prediction).

3. **Prediction source selection for embedding coloring**
   - What we know: Evaluation panel has a source dropdown. Embedding panel does not.
   - What's unclear: Should embedding coloring respect a selected prediction source, or always use the first available source?
   - Recommendation: Add an optional source query param to the coordinates endpoint. Default to first non-GT source. If the user has multiple prediction sources, they can switch via a dropdown in the embedding toolbar (add only if multiple sources exist).

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `frontend/src/components/stats/confusion-matrix.tsx` (current HTML table implementation, 138 lines)
- Codebase inspection: `frontend/src/components/embedding/embedding-scatter.tsx` (deck.gl ScatterplotLayer, getFillColor accessor, updateTriggers pattern)
- Codebase inspection: `frontend/src/components/embedding/embedding-panel.tsx` (toolbar, lasso toggle, hover state)
- Codebase inspection: `frontend/src/types/embedding.ts` (EmbeddingPoint interface -- no gtLabel/predLabel yet)
- Codebase inspection: `frontend/src/components/stats/evaluation-panel.tsx` (ClassificationMetricsCards, ClassificationPerClassTable)
- Codebase inspection: `app/services/reduction_service.py` (get_coordinates SQL, JOIN samples only)
- Codebase inspection: `app/services/classification_evaluation.py` (confusion matrix computation, per-class metrics)
- Codebase inspection: `frontend/src/hooks/use-embeddings.ts` (staleTime: Infinity for coordinates)
- Codebase inspection: `package.json` (Recharts ^3.7.0, deck.gl ^9.2.6)

### Secondary (MEDIUM confidence)
- deck.gl ScatterplotLayer documentation: `getFillColor` accessor supports per-point RGBA arrays with `updateTriggers` for reactive updates
- Recharts BarChart/LineChart support fixed-size rendering via `width`/`height` props without ResponsiveContainer

### Tertiary (LOW confidence)
- Canvas vs HTML table performance for large matrices: Based on general web performance knowledge. HTML table with 1,849 cells (43x43) is well within browser capabilities. Canvas would be warranted at ~200+ classes (40,000+ cells).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, all existing libraries sufficient
- Architecture: HIGH - Clear extension patterns on existing components, minimal backend change (one SQL JOIN enrichment)
- Pitfalls: HIGH - Identified from direct codebase inspection (threshold UX, stale cache, multi-source JOIN, palette limits)

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (internal codebase patterns, stable)
