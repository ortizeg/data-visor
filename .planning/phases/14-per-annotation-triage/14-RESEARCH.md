# Phase 14: Per-Annotation Triage - Research

**Researched:** 2026-02-13
**Domain:** Object detection evaluation overlay, per-annotation classification persistence, interactive bounding box triage
**Confidence:** HIGH

## Summary

Phase 14 extends the existing sample-level triage system to work at the per-annotation (per-bounding-box) level. The core challenge is: (1) computing TP/FP/FN classifications for each bounding box using the same IoU matching logic already in `error_analysis.py`, (2) persisting manual overrides to DuckDB, (3) rendering color-coded boxes in the detail modal with click-to-override interaction, and (4) integrating with highlight mode on the grid.

The codebase already has all the building blocks: `error_analysis.py` has the greedy IoU matching algorithm, `evaluation.py` has `_load_detections()` and `_compute_iou_matrix()` helpers, the `AnnotationOverlay` SVG component renders bounding boxes with configurable colors, and the triage router demonstrates atomic DuckDB tag updates. The new work is: a new endpoint that returns per-annotation classifications for a single sample, a new `annotation_triage` table for manual overrides, clickable SVG bounding boxes, and color-coding logic.

**Primary recommendation:** Add an `annotation_triage` table (separate from annotations) to store manual overrides. Create a new `/samples/{sample_id}/annotation-triage` endpoint that computes IoU matching for one sample on-the-fly and merges results with any stored overrides. On the frontend, extend `AnnotationOverlay` with clickable boxes and triage-aware color coding.

## Standard Stack

### Core (already in codebase -- no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| DuckDB | existing | Persist per-annotation triage overrides | Already the data layer; new table is trivial |
| FastAPI | existing | New triage endpoint | Already the API framework |
| NumPy | existing | IoU computation reuse | Already used by `_compute_iou_matrix()` |
| TanStack Query | existing | Frontend data fetching/mutations | Already the caching/mutation layer |
| react-hotkeys-hook | existing | Keyboard shortcuts for triage cycling | Already used for sample-level triage keys |

### Supporting (no new libraries needed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| SVG (native) | n/a | Clickable bounding box overlays | Click-to-triage in detail modal (non-edit mode) |
| Zustand | existing | UI state for active triage mode | Track which annotation is being triaged |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate `annotation_triage` table | Add `triage_label` column to `annotations` table | Column addition is simpler but conflates annotation data with user triage state; separate table keeps concerns clean and allows storing who overrode, when, and from what auto-value |
| On-the-fly IoU per sample open | Precomputed batch IoU for all samples | Batch precompute is overkill -- single-sample IoU with <100 boxes takes <1ms; saves a whole precomputation pipeline |
| SVG clickable overlay | Konva-based triage layer | SVG is simpler for click interaction (just add onClick to `<g>` or `<rect>`); Konva is reserved for drag/resize editing |

**Installation:**
```bash
# No new packages needed -- all existing dependencies
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── models/
│   └── annotation_triage.py       # Pydantic models for triage request/response
├── routers/
│   └── annotation_triage.py       # PATCH/GET endpoints for per-annotation triage
├── services/
│   └── annotation_matching.py     # Single-sample IoU matching (extracted from error_analysis.py)
│
frontend/src/
├── components/
│   ├── detail/
│   │   └── triage-overlay.tsx     # Clickable SVG overlay with TP/FP/FN color coding
│   └── triage/
│       └── triage-tag-buttons.tsx # Existing -- no changes needed
├── hooks/
│   └── use-annotation-triage.ts   # TanStack Query hooks for per-annotation triage
├── types/
│   └── annotation-triage.ts       # TypeScript types for triage classifications
```

### Pattern 1: Separate Triage Table (Override Pattern)
**What:** Store auto-computed classifications as ephemeral (computed on read), and only persist manual overrides in a dedicated `annotation_triage` table.
**When to use:** When the source of truth for auto-classifications is the IoU algorithm (not a stored value), and users only override specific annotations.
**Why:** If GT or predictions change (re-import, edit), the auto-computed values automatically update. Only explicit user overrides persist. This avoids stale cached classifications.

```sql
-- DuckDB schema for annotation triage overrides
CREATE TABLE IF NOT EXISTS annotation_triage (
    annotation_id   VARCHAR NOT NULL,
    dataset_id      VARCHAR NOT NULL,
    sample_id       VARCHAR NOT NULL,
    label           VARCHAR NOT NULL,  -- 'tp', 'fp', 'fn', 'mistake'
    is_override     BOOLEAN DEFAULT true,
    created_at      TIMESTAMP DEFAULT current_timestamp
);

-- Unique constraint: one triage label per annotation
-- (DuckDB has no UNIQUE constraints, use DELETE + INSERT pattern)
```

**Merge strategy:**
```python
# Pseudocode for the endpoint
auto_results = compute_per_sample_matching(sample_id)   # {annotation_id: "tp"|"fp"|"fn"}
overrides = load_overrides(sample_id)                    # {annotation_id: "mistake"|"fp"|...}
merged = {**auto_results, **overrides}                   # Overrides win
```

### Pattern 2: Single-Sample IoU Matching (Extracted Service)
**What:** Extract the per-sample matching loop from `error_analysis.py` into a reusable function that returns per-annotation classifications instead of per-sample aggregates.
**When to use:** When opening a sample detail modal -- compute IoU matching for just that one sample.

```python
# app/services/annotation_matching.py
def match_sample_annotations(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    sample_id: str,
    source: str,
    iou_threshold: float = 0.5,
    conf_threshold: float = 0.25,
) -> list[AnnotationMatch]:
    """Compute TP/FP/FN classification for each annotation in a single sample.

    Returns a list of AnnotationMatch objects, each containing:
    - annotation_id: the annotation's ID
    - auto_label: 'tp', 'fp', 'fn', or 'label_error'
    - matched_annotation_id: ID of the matched GT/pred annotation (if any)
    - iou: the IoU score with the matched annotation

    Algorithm: Same greedy IoU matching as error_analysis.py but operating on
    annotation IDs (not just _BoxRow tuples) and returning per-annotation results.
    """
```

**Key difference from `error_analysis.py`:** The existing code works with `_BoxRow` tuples that lack annotation IDs. The new service must query with `SELECT id, ...` to preserve annotation IDs for the response and for persisting overrides.

### Pattern 3: Clickable SVG Overlay with Triage Colors
**What:** Extend the SVG annotation overlay to use triage-aware colors (green=TP, red=FP, orange=FN) and enable pointer events for clicking individual boxes.
**When to use:** In the detail modal when triage data is available (predictions exist alongside GT).

```tsx
// Color mapping for triage labels
const TRIAGE_COLORS: Record<string, string> = {
  tp: "#22c55e",        // green-500
  fp: "#ef4444",        // red-500
  fn: "#f97316",        // orange-500
  label_error: "#eab308", // yellow-500
  mistake: "#a855f7",   // purple-500
};
```

### Pattern 4: Frontend Data Flow
**What:** Fetch triage data alongside annotations, merge on the frontend, and render.
**When to use:** Every time the detail modal opens for a sample that has both GT and predictions.

```
User opens detail modal
  -> useAnnotations(sampleId) fetches annotations (existing)
  -> useAnnotationTriage(sampleId) fetches per-annotation classifications (new)
  -> Merge: each annotation gets a `triageLabel` from the triage response
  -> TriageOverlay renders color-coded boxes with onClick handlers
  -> Click triggers PATCH mutation to set/override triage label
```

### Anti-Patterns to Avoid
- **Pre-computing IoU for all samples at dataset level:** The current `error_analysis.py` already iterates all samples. For per-annotation triage, compute on-demand per sample. Do NOT build a batch precomputation pipeline -- it is unnecessary complexity.
- **Storing auto-computed labels in the database:** If you store `tp`/`fp`/`fn` labels computed from IoU and the user later edits a GT box or re-imports predictions, the stored labels become stale. Only store explicit user overrides.
- **Making the overlay a Konva component:** The triage overlay is click-only (no drag, no resize). SVG with pointer events is far simpler than Konva for this use case. Reserve Konva for the annotation editor.
- **Modifying the existing `annotations` table schema:** Adding a `triage_label` column to annotations conflates detection data with user review state. A separate table is cleaner and easier to clear/reset.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IoU computation | Custom IoU function | `_compute_iou_matrix()` from `evaluation.py` | Already vectorized with numpy, handles edge cases |
| Greedy matching | New matching algorithm | Adapt loop from `error_analysis.py` lines 103-163 | Same algorithm, just need annotation IDs added |
| Color-coded overlays | Custom canvas renderer | Extend existing `AnnotationOverlay` SVG component | SVG viewBox scaling already handles coordinate mapping |
| Triage tag CRUD | New database abstraction | Follow pattern from `triage.py` router (DELETE + INSERT) | Proven atomic update pattern with DuckDB |
| Query invalidation | Manual cache busting | TanStack Query `invalidateQueries` | Already the pattern used by `use-triage.ts` |

**Key insight:** This phase is 80% wiring together existing pieces (IoU matching, annotation rendering, triage persistence) with 20% new code (triage overlay component, new endpoint, new table).

## Common Pitfalls

### Pitfall 1: Annotation ID Availability in IoU Matching
**What goes wrong:** The existing `_load_detections()` returns `_BoxRow` tuples `(cat, x, y, w, h, conf)` WITHOUT annotation IDs. The new per-annotation matching must return results keyed by annotation ID.
**Why it happens:** `_load_detections()` was designed for aggregate statistics, not per-annotation attribution.
**How to avoid:** Write a new `_load_detections_with_ids()` variant that includes `annotation.id` in the SELECT and returns it in the tuple. Or query annotations directly by sample_id (simpler for single-sample use).
**Warning signs:** If you try to reuse `_load_detections()` as-is, you will not be able to map results back to specific annotations.

### Pitfall 2: FN Annotations Have No Prediction to Click
**What goes wrong:** False Negatives are unmatched GT boxes. They have no corresponding prediction box. The user needs to see FN-colored GT boxes, but clicking a GT box to mark it as FN is conceptually different from clicking a prediction box.
**Why it happens:** TP and FP are properties of prediction annotations; FN is a property of GT annotations.
**How to avoid:** In the triage response, include BOTH prediction classifications (tp/fp for each pred annotation) AND GT classifications (fn for unmatched GT, matched_tp for matched GT). Color-code both GT and prediction boxes. The user can click either type.
**Warning signs:** If only prediction boxes are color-coded, FN GT boxes will still use the default class-based coloring, confusing the user.

### Pitfall 3: SVG pointer-events Override
**What goes wrong:** The existing `AnnotationOverlay` has `pointer-events-none` on the SVG element (CSS class). Adding `onClick` to child `<rect>` elements will not fire.
**Why it happens:** The overlay was designed as non-interactive (view-only).
**How to avoid:** Create a new `TriageOverlay` component (or a variant of `AnnotationOverlay`) that sets `pointer-events: auto` on the SVG and individual `<rect>` elements. Keep the original `AnnotationOverlay` as-is for the grid view (non-interactive).
**Warning signs:** Clicks on bounding boxes do nothing despite having onClick handlers.

### Pitfall 4: Source Filter Interaction
**What goes wrong:** The UI store has `activeSources` filtering. If the user has hidden predictions (only showing GT), the triage overlay should not show triage colors since there are no predictions to match.
**Why it happens:** Triage requires both GT and predictions to be visible for IoU matching to make sense.
**How to avoid:** Only fetch/show triage data when both GT and at least one prediction source are active. Show a hint or disable triage mode when sources are filtered to GT-only.
**Warning signs:** Triage colors appear on GT-only view, which makes no sense.

### Pitfall 5: Highlight Mode Transition
**What goes wrong:** Current highlight mode checks `sample.tags.some(t => t.startsWith("triage:"))` for sample-level triage. Per-annotation triage is stored in a different table, not in `samples.tags`.
**Why it happens:** Highlight mode was built for sample-level tags only.
**How to avoid:** Add a `has_annotation_triage` flag to the sample data or check the `annotation_triage` table. The simplest approach: when a user overrides an annotation triage label, also set a sample-level tag like `triage:annotated` on the sample. This makes highlight mode work with zero grid-level changes.
**Warning signs:** Highlight mode stops working for annotation-triaged samples because there is no sample-level tag.

### Pitfall 6: Stale Triage After Prediction Re-Import
**What goes wrong:** User triages annotations, then re-imports predictions. Old annotation IDs are deleted and new ones created, but the `annotation_triage` table still references old IDs.
**Why it happens:** Prediction import does `DELETE FROM annotations WHERE source = ?`, creating new IDs.
**How to avoid:** Add a CASCADE-like cleanup: when predictions are re-imported for a dataset, delete any `annotation_triage` rows for that dataset where the annotation_id no longer exists. Or use a simple `ON DELETE CASCADE`-style check in the endpoint.
**Warning signs:** Old triage overrides appear with missing annotation references.

## Code Examples

### Backend: Single-Sample IoU Matching with Annotation IDs
```python
# app/services/annotation_matching.py
from __future__ import annotations
import numpy as np
from duckdb import DuckDBPyConnection
from app.services.evaluation import _compute_iou_matrix

def match_sample_annotations(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    sample_id: str,
    source: str,
    iou_threshold: float = 0.5,
    conf_threshold: float = 0.25,
) -> dict[str, dict]:
    """Return per-annotation TP/FP/FN classification for a single sample.

    Returns dict mapping annotation_id -> {
        "label": "tp"|"fp"|"fn"|"label_error",
        "matched_id": str|None,
        "iou": float|None,
    }
    """
    # Query GT annotations with IDs
    gt_rows = cursor.execute(
        "SELECT id, category_name, bbox_x, bbox_y, bbox_w, bbox_h, confidence "
        "FROM annotations WHERE dataset_id = ? AND sample_id = ? AND source = 'ground_truth'",
        [dataset_id, sample_id],
    ).fetchall()

    # Query prediction annotations with IDs
    pred_rows = cursor.execute(
        "SELECT id, category_name, bbox_x, bbox_y, bbox_w, bbox_h, confidence "
        "FROM annotations WHERE dataset_id = ? AND sample_id = ? AND source = ?",
        [dataset_id, sample_id, source],
    ).fetchall()

    results: dict[str, dict] = {}

    # Filter predictions by confidence
    filtered_preds = [
        r for r in pred_rows
        if (r[6] if r[6] is not None else 1.0) >= conf_threshold
    ]
    # Sort by confidence descending
    filtered_preds.sort(key=lambda r: -(r[6] if r[6] is not None else 1.0))

    if not gt_rows and not filtered_preds:
        return results

    # Build GT xyxy array
    if gt_rows:
        gt_xyxy = np.array(
            [[r[2], r[3], r[2] + r[4], r[3] + r[5]] for r in gt_rows],
            dtype=np.float64,
        )
        gt_ids = [r[0] for r in gt_rows]
        gt_classes = [r[1] for r in gt_rows]
    else:
        gt_xyxy = np.empty((0, 4), dtype=np.float64)
        gt_ids = []
        gt_classes = []

    matched_gt: set[int] = set()

    for pred in filtered_preds:
        pred_id, pred_cat = pred[0], pred[1]
        px, py, pw, ph = pred[2], pred[3], pred[4], pred[5]
        pred_xyxy = np.array([[px, py, px + pw, py + ph]], dtype=np.float64)

        if len(gt_xyxy) > 0:
            ious = _compute_iou_matrix(pred_xyxy, gt_xyxy)[0]
            best_idx = int(np.argmax(ious))
            best_iou = float(ious[best_idx])

            if best_iou >= iou_threshold and best_idx not in matched_gt:
                if gt_classes[best_idx] == pred_cat:
                    results[pred_id] = {
                        "label": "tp",
                        "matched_id": gt_ids[best_idx],
                        "iou": round(best_iou, 4),
                    }
                    matched_gt.add(best_idx)
                else:
                    results[pred_id] = {
                        "label": "label_error",
                        "matched_id": gt_ids[best_idx],
                        "iou": round(best_iou, 4),
                    }
                    matched_gt.add(best_idx)
            else:
                results[pred_id] = {"label": "fp", "matched_id": None, "iou": None}
        else:
            results[pred_id] = {"label": "fp", "matched_id": None, "iou": None}

    # Unmatched GT = false negatives
    for gi, gt in enumerate(gt_rows):
        if gi not in matched_gt:
            results[gt[0]] = {"label": "fn", "matched_id": None, "iou": None}
        else:
            # Matched GT -- mark as matched_tp for visual clarity
            results[gt[0]] = {"label": "tp", "matched_id": None, "iou": None}

    return results
```

### Backend: Triage Override Endpoint
```python
# app/routers/annotation_triage.py
@router.patch("/set-annotation-triage")
def set_annotation_triage(
    request: SetAnnotationTriageRequest,
    cursor: DuckDBPyConnection = Depends(get_cursor),
) -> dict:
    """Set or override triage label on a single annotation."""
    # Delete existing override for this annotation (upsert pattern)
    cursor.execute(
        "DELETE FROM annotation_triage WHERE annotation_id = ? AND dataset_id = ?",
        [request.annotation_id, request.dataset_id],
    )
    # Insert new override
    cursor.execute(
        "INSERT INTO annotation_triage (annotation_id, dataset_id, sample_id, label) "
        "VALUES (?, ?, ?, ?)",
        [request.annotation_id, request.dataset_id, request.sample_id, request.label],
    )
    return {"annotation_id": request.annotation_id, "label": request.label}
```

### Frontend: Triage-Aware SVG Overlay
```tsx
// frontend/src/components/detail/triage-overlay.tsx
const TRIAGE_COLORS: Record<string, string> = {
  tp: "#22c55e",        // green-500
  fp: "#ef4444",        // red-500
  fn: "#f97316",        // orange-500
  label_error: "#eab308",
  mistake: "#a855f7",
};

interface TriageOverlayProps {
  annotations: Annotation[];
  triageMap: Record<string, { label: string; isOverride: boolean }>;
  imageWidth: number;
  imageHeight: number;
  onClickAnnotation: (annotationId: string, currentLabel: string) => void;
}

export function TriageOverlay({
  annotations, triageMap, imageWidth, imageHeight, onClickAnnotation,
}: TriageOverlayProps) {
  const strokeWidth = Math.max(imageWidth * 0.004, 3);
  const fontSize = Math.max(imageWidth * 0.015, 10);

  return (
    <svg
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
    >
      {annotations.map((ann) => {
        const triage = triageMap[ann.id];
        const color = triage ? TRIAGE_COLORS[triage.label] ?? "#71717a" : "#71717a";
        const label = triage?.label?.toUpperCase() ?? "";
        const isPrediction = ann.source !== "ground_truth";
        const dashLen = strokeWidth * 4;
        const gapLen = strokeWidth * 2;

        return (
          <g
            key={ann.id}
            onClick={() => triage && onClickAnnotation(ann.id, triage.label)}
            className="cursor-pointer"
            style={{ pointerEvents: "auto" }}
          >
            <rect
              x={ann.bbox_x} y={ann.bbox_y}
              width={ann.bbox_w} height={ann.bbox_h}
              fill="transparent" stroke={color} strokeWidth={strokeWidth}
              strokeDasharray={isPrediction ? `${dashLen},${gapLen}` : "none"}
            />
            <text
              x={ann.bbox_x} y={ann.bbox_y - 4}
              fill={color} fontSize={fontSize} fontWeight="bold"
              paintOrder="stroke" stroke="rgba(0,0,0,0.7)"
              strokeWidth={fontSize * 0.15}
            >
              {ann.category_name} {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
```

### DuckDB Schema Migration
```python
# In app/repositories/duckdb_repo.py initialize_schema()
self.connection.execute("""
    CREATE TABLE IF NOT EXISTS annotation_triage (
        annotation_id   VARCHAR NOT NULL,
        dataset_id      VARCHAR NOT NULL,
        sample_id       VARCHAR NOT NULL,
        label           VARCHAR NOT NULL,
        is_override     BOOLEAN DEFAULT true,
        created_at      TIMESTAMP DEFAULT current_timestamp
    )
""")
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sample-level triage only (tags on samples table) | Per-annotation triage with auto-computed + manual override | Phase 14 | Users can triage individual detections, not just whole images |
| Class-based box colors (color-hash) | Triage-based colors (green=TP, red=FP, orange=FN) | Phase 14 | Visual error identification at a glance |
| Non-interactive SVG overlay | Clickable SVG overlay for triage | Phase 14 | Direct interaction with individual detections |

**FiftyOne reference (industry pattern):** FiftyOne stores evaluation status as a field on each detection object (e.g., `detection.eval = "fp"`). This is the industry standard pattern. Our approach mirrors this but separates auto-computed values from user overrides, which is cleaner for mutability.

## Open Questions

1. **Triage label cycling order:**
   - What we know: User clicks a box to override. They need to cycle through labels.
   - What's unclear: Should clicking cycle through TP -> FP -> FN -> Mistake -> (clear)? Or show a small popup picker?
   - Recommendation: Use a cycle (click advances to next label, long-press or right-click clears). Simpler than a popup. Match the sample-level triage button pattern.

2. **Label error vs FP distinction:**
   - What we know: `error_analysis.py` distinguishes `label_error` (IoU match but class mismatch) from `hard_fp` (no IoU match).
   - What's unclear: Should the user see "Label Error" as a separate category, or collapse it into FP?
   - Recommendation: Show as separate auto-category (yellow) but allow override to any label. The user requirement mentions TP/FP/FN, so label_error can map to FP for override purposes.

3. **Highlight mode scope:**
   - What we know: Current highlight mode dims samples without triage tags.
   - What's unclear: Should per-annotation triage contribute to highlight? (e.g., sample has annotation-level triage -> not dimmed)
   - Recommendation: Yes. When any annotation on a sample has a triage override, set a sample-level tag `triage:annotated` so existing highlight mode logic works without grid changes. This is the simplest integration path.

4. **Prediction source selection:**
   - What we know: A dataset can have multiple prediction sources (e.g., "yolov8-v1", "yolov8-v2").
   - What's unclear: Which source is used for IoU matching when computing triage?
   - Recommendation: Use the first non-GT source visible in `activeSources`, or accept a `source` query parameter (matching the error analysis endpoint pattern).

## Sources

### Primary (HIGH confidence)
- Codebase: `app/services/error_analysis.py` - IoU matching algorithm (lines 103-163)
- Codebase: `app/services/evaluation.py` - `_compute_iou_matrix()`, `_load_detections()` helpers
- Codebase: `app/routers/triage.py` - Sample-level triage CRUD pattern
- Codebase: `frontend/src/components/grid/annotation-overlay.tsx` - SVG overlay architecture
- Codebase: `frontend/src/components/detail/sample-modal.tsx` - Detail modal composition
- Codebase: `app/repositories/duckdb_repo.py` - Schema migration pattern (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS)

### Secondary (MEDIUM confidence)
- [FiftyOne Evaluation Docs](https://docs.voxel51.com/user_guide/evaluation.html) - Per-detection eval field pattern (eval="fp"/"tp"/"fn" stored on each detection)
- [DuckDB ALTER TABLE](https://duckdb.org/docs/stable/sql/statements/alter_table) - Schema migration syntax

### Tertiary (LOW confidence)
- None. All findings are based on direct codebase analysis and verified documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries; all existing codebase components
- Architecture: HIGH - Direct extension of existing patterns (triage router, annotation overlay, error analysis service)
- Data model: HIGH - Follows established DuckDB table creation pattern from `duckdb_repo.py`
- Frontend interaction: HIGH - SVG click handling is standard DOM; color mapping is trivial
- Pitfalls: HIGH - Identified from direct code reading (pointer-events-none, missing annotation IDs, source filtering)
- Highlight mode integration: MEDIUM - The "sample-level tag as bridge" approach is recommended but alternative approaches exist

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable -- no external dependencies to drift)
