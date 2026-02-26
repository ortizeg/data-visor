# Phase 16: Classification Evaluation - Research

**Researched:** 2026-02-18
**Domain:** Classification metrics computation, prediction import, confusion matrix, frontend evaluation UI
**Confidence:** HIGH (internal codebase extension using established patterns, no new libraries)

## Summary

Phase 16 adds classification model evaluation to a codebase that already has a mature detection evaluation pipeline. The existing detection evaluation (`app/services/evaluation.py`, ~560 lines) computes IoU-based PR curves, mAP via supervision, and detection confusion matrices -- all irrelevant for classification. Classification evaluation is fundamentally simpler: no spatial matching, no IoU thresholds, just per-sample label comparison between ground truth and predicted class.

The work spans five areas: (1) classification prediction import -- a new JSONL parser and format option for the existing prediction import dialog, (2) a new `compute_classification_evaluation` service (~50-80 lines) that computes accuracy, F1, per-class precision/recall, and confusion matrix from DuckDB queries, (3) a new `classify_errors` function for error analysis (correct/misclassified/missing), (4) frontend evaluation panel that shows classification-appropriate metrics instead of detection mAP/PR curves, and (5) GT vs predicted label display on grid thumbnails and the detail modal.

The codebase already has all infrastructure needed: the `annotations` table stores classification GT with sentinel bbox values (0.0), the `source` column distinguishes GT from predictions, `dataset_type` is stored on the dataset, and the frontend threads `datasetType` through components. Phase 15 already hid the detection-only Evaluation/Error Analysis tabs for classification -- this phase un-hides them with classification-specific implementations.

**Primary recommendation:** Create a separate `compute_classification_evaluation` function (not modify the detection one), a `ClassificationPredictionParser` for JSONL prediction import, and classification-specific frontend components/views that coexist alongside the detection evaluation pipeline. Route between them based on `dataset_type` at the API and component levels.

## Standard Stack

### Core (already in use -- no new dependencies)

| Library | Purpose | Status |
|---------|---------|--------|
| DuckDB | SQL queries for metric computation, confusion matrix | In use |
| FastAPI | API endpoints | In use |
| Pydantic | Response models | In use |
| NumPy | Metric calculation (F1, precision, recall) | In use |
| Python `json` | JSONL prediction parsing | In use |
| Next.js + React | Frontend framework | In use |
| TanStack Query | Data fetching hooks | In use |
| Recharts | Charts (class distribution bars, confusion matrix) | In use |
| Zustand | State management (filter store for cell click) | In use |

### Supporting (no new libraries needed)

Classification metrics (accuracy, F1, precision, recall, confusion matrix) are simple enough to compute with NumPy or pure Python from DuckDB query results. scikit-learn would be a natural choice for `classification_report` and `confusion_matrix`, but it is NOT in the current dependency tree and would be overkill for what amounts to ~30 lines of counting logic. The existing supervision library is detection-focused and does not provide classification metrics.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom NumPy classification metrics | scikit-learn `classification_report` | sklearn is ~50MB, adds a heavy dependency for 30 lines of logic. Custom is simple enough. |
| Separate classification eval function | Modify existing `compute_evaluation` | Detection eval is 560 lines of IoU matching. Adding classification branches would pollute it. Separate function is cleaner. |
| New `/classification-evaluation` endpoint | Reuse `/evaluation` endpoint with routing | Reusing existing endpoint keeps frontend simpler -- same hook, different response shape. Router can dispatch based on `dataset_type`. |
| Separate confusion matrix component | Reuse existing `ConfusionMatrix` component | Existing component already works generically (labels + matrix). No "background" class for classification, but the component handles any label set. Reuse directly. |

## Architecture Patterns

### Recommended Change Map

```
Backend:
  app/ingestion/
    classification_prediction_parser.py  # NEW: parse JSONL predictions with confidence
  app/services/
    classification_evaluation.py         # NEW: accuracy, F1, confusion matrix, per-class P/R/F1
    classification_error_analysis.py     # NEW: correct/misclassified/missing categorization
  app/models/
    classification_evaluation.py         # NEW: Pydantic response models
    prediction.py                        # MODIFY: add "classification_jsonl" format option
  app/routers/
    datasets.py                          # MODIFY: add classification_jsonl prediction import
    statistics.py                        # MODIFY: route evaluation endpoint by dataset_type

Frontend:
  types/
    evaluation.ts                        # MODIFY: add ClassificationEvaluationResponse type
    prediction.ts                        # MODIFY: add "classification_jsonl" format
    error-analysis.ts                    # MODIFY: add classification error types
  hooks/
    use-evaluation.ts                    # MODIFY: or create use-classification-evaluation.ts
    use-error-analysis.ts               # MODIFY: or create classification variant
  components/stats/
    stats-dashboard.tsx                  # MODIFY: un-hide Evaluation/ErrorAnalysis for classification
    evaluation-panel.tsx                 # MODIFY: branch on datasetType, render classification metrics
    classification-metrics-cards.tsx     # NEW: accuracy, macro F1, weighted F1 cards
    classification-per-class-table.tsx   # NEW: per-class P/R/F1 table
    error-analysis-panel.tsx            # MODIFY: branch on datasetType
  components/grid/
    grid-cell.tsx                        # MODIFY: show predicted label badge alongside GT
  components/detail/
    sample-modal.tsx                     # ALREADY shows GT vs predicted for classification
    prediction-import-dialog.tsx         # MODIFY: add classification_jsonl format option
```

### Pattern 1: Classification Prediction JSONL Format

**What:** Classification predictions as JSONL with filename, predicted_label, and confidence.
**When to use:** Importing classification model outputs.

```jsonl
{"filename": "img_001.jpg", "label": "cat", "confidence": 0.95}
{"filename": "img_002.jpg", "label": "dog", "confidence": 0.87}
{"filename": "img_003.jpg", "label": "bird", "confidence": 0.72}
```

The parser reuses the same flexible key lookup from `ClassificationJSONLParser`:
- Filename keys: `filename`, `file_name`, `image`, `path`
- Label keys: `label`, `class`, `category`, `class_name`, `predicted_label`, `prediction`
- Confidence keys: `confidence`, `score`, `probability`, `prob`

Produces annotation rows with sentinel bbox values (0.0), `source = run_name`, and confidence score.

### Pattern 2: Classification Evaluation Backend

**What:** Pure SQL + minimal Python for classification metrics.
**Why:** No IoU matching, no spatial reasoning -- classification eval is just label comparison.

```python
# Pseudocode for compute_classification_evaluation
def compute_classification_evaluation(cursor, dataset_id, source, conf_threshold, split):
    # 1. Query GT and prediction labels per sample
    #    SELECT s.id, gt.category_name as gt_label, pred.category_name as pred_label, pred.confidence
    #    FROM samples s
    #    LEFT JOIN annotations gt ON gt.sample_id = s.id AND gt.source = 'ground_truth'
    #    LEFT JOIN annotations pred ON pred.sample_id = s.id AND pred.source = ?
    #    WHERE s.dataset_id = ? AND pred.confidence >= ?

    # 2. Compute confusion matrix: NxN array where N = len(unique_classes)
    # 3. Derive from confusion matrix:
    #    - Accuracy = trace(CM) / sum(CM)
    #    - Per-class precision = CM[i,i] / sum(CM[:,i])
    #    - Per-class recall = CM[i,i] / sum(CM[i,:])
    #    - Per-class F1 = 2*P*R/(P+R)
    #    - Macro F1 = mean(per_class_F1)
    #    - Weighted F1 = weighted mean by support
    # 4. Return ClassificationEvaluationResponse
```

### Pattern 3: Endpoint Routing by Dataset Type

**What:** The existing `/evaluation` endpoint checks `dataset_type` and dispatches to the appropriate evaluation function.
**Why:** Frontend uses the same `useEvaluation` hook but gets a response shaped for the dataset type.

Two options:

**Option A: Same endpoint, different response** -- The router checks `dataset_type` and calls either `compute_evaluation` or `compute_classification_evaluation`. The frontend receives a discriminated union type. **Downside:** TypeScript type narrowing is more complex.

**Option B: Same endpoint, superset response** -- Return a response with optional fields. Classification omits `pr_curves` and uses `accuracy/f1` instead of `mAP`. **Downside:** Many optional fields.

**Recommendation: Option A** with a `type` discriminant field. The frontend `useEvaluation` hook returns `EvaluationResponse | ClassificationEvaluationResponse`, and components branch at the panel level (not per-widget). This is the same pattern used for `datasetType` branching elsewhere.

### Pattern 4: Classification Confusion Matrix (No Background Class)

**What:** Classification confusion matrix is simpler than detection: N x N where N = number of classes (no "background" row/col).
**Why:** In detection, unmatched predictions and GTs map to "background". In classification, every sample has exactly one GT label and at most one predicted label -- there's no spatial mismatch.

The existing `ConfusionMatrix` frontend component takes `matrix: number[][]` and `labels: string[]` -- it works unchanged. The difference is the labels array won't include "background".

For click-to-filter: classification confusion cell samples are trivial -- just query samples where `gt_label = X AND pred_label = Y`. No IoU re-matching needed.

### Pattern 5: Classification Error Analysis Categories

**What:** For classification, error categories are:
- **Correct** -- GT label matches predicted label
- **Misclassified** -- GT label differs from predicted label (with confidence above threshold)
- **Missing prediction** -- Sample has GT but no prediction (or prediction below threshold)

**Why:** Detection error analysis uses TP/Hard FP/Label Error/FN based on IoU matching. Classification has no spatial dimension, so categories simplify to match/mismatch/absent.

### Pattern 6: GT vs Predicted Badge on Grid Thumbnails

**What:** For classification datasets with predictions, grid thumbnails show both GT and predicted labels.
**Current state:** `grid-cell.tsx` shows a `ClassBadge` for GT only (line 101). Need to also show predicted label.

```tsx
// Current: only GT badge
<ClassBadge label={annotations.find(a => a.source === "ground_truth")?.category_name} />

// New: GT + Predicted, with visual differentiation
<ClassBadge label={gtLabel} />
{predLabel && (
  <PredBadge label={predLabel} isCorrect={gtLabel === predLabel} />
)}
```

Color coding: green border/bg when predicted matches GT, red when mismatch.

### Anti-Patterns to Avoid

- **Modifying existing detection evaluation code:** The detection eval is 560 lines of IoU-based matching. Do NOT add classification branches inside it. Write a separate function.
- **Using IoU threshold for classification:** Classification has no spatial matching. The evaluation controls should hide the IoU slider for classification datasets.
- **Importing predictions as detection annotations:** Classification predictions should use sentinel bbox (0.0) just like GT. They should NOT have bbox values.
- **Separate /classification-evaluation endpoint:** This would require new frontend hooks. Better to reuse the existing endpoint and dispatch by dataset_type in the router.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confusion matrix computation | Manual nested loop counting | NumPy 2D histogram or simple dict counting | Off-by-one errors, class index mapping bugs |
| F1 score from P/R | Manual formula in each place | Single utility function `compute_f1(p, r)` | Avoid div-by-zero in multiple places |
| Sample-to-label join | Python-side iteration | DuckDB JOIN query | Let the DB engine do the join, return results |

**Key insight:** Classification eval is genuinely simple -- the danger is overcomplicating it, not undercomplicating it. A ~50-80 line Python function with a handful of NumPy operations is all that's needed.

## Common Pitfalls

### Pitfall 1: Division by Zero in Metrics
**What goes wrong:** Per-class precision/recall/F1 can have zero denominators when a class has no predictions or no GT samples.
**Why it happens:** Edge case: a class exists in GT but model never predicts it, or vice versa.
**How to avoid:** Guard every division: `precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0`. Same for recall and F1.
**Warning signs:** NaN values in the frontend metrics table.

### Pitfall 2: Multi-Label vs Single-Label Confusion
**What goes wrong:** Classification JSONL parser from Phase 15 supports multi-label (list of labels per image). If a sample has multiple GT labels, which one do you compare against the prediction?
**Why it happens:** The parser emits one annotation row per label for multi-label images.
**How to avoid:** For evaluation, assume single-label classification. If a sample has multiple GT annotations, use the first one (or the one with highest confidence). Document this limitation.
**Warning signs:** Inflated confusion matrix counts (same sample counted multiple times).

### Pitfall 3: Sample ID Mismatch Between GT and Predictions
**What goes wrong:** Prediction JSONL uses filenames but samples have integer IDs from the JSONL line index. Predictions need to be matched by filename, not by sample_id directly.
**Why it happens:** ClassificationJSONLParser generates sample IDs as `"{split}_{idx}"` or `"{idx}"`, not from filenames.
**How to avoid:** The prediction parser must look up sample_id by filename, just like detection prediction import does. Build a `filename -> sample_id` lookup from the samples table.
**Warning signs:** Zero predictions imported, or predictions attached to wrong samples.

### Pitfall 4: Confidence Threshold with No Slider
**What goes wrong:** If the IoU slider is hidden for classification but the confidence slider is kept, the default conf_threshold (0.25) might filter out low-confidence predictions unexpectedly.
**Why it happens:** Detection evaluation defaults to conf_threshold=0.25. Classification users might not realize predictions below 0.25 confidence are being excluded.
**How to avoid:** Keep the confidence slider visible for classification. Only hide the IoU slider.
**Warning signs:** "Missing prediction" count unexpectedly high.

### Pitfall 5: Existing Tab Hiding Logic
**What goes wrong:** Phase 15 hides Evaluation/Error Analysis/Worst Images/Intelligence tabs for classification datasets (`!isClassification` guard in stats-dashboard.tsx). This phase needs to un-hide Evaluation and Error Analysis with classification-specific content.
**Why it happens:** Phase 15 correctly hid detection-only tabs. Phase 16 needs to selectively re-enable them.
**How to avoid:** Change the guard from `!isClassification` to a more nuanced check: always show Evaluation and Error Analysis tabs, but render different content based on datasetType. Keep Worst Images and Intelligence hidden for now (they're detection-specific).
**Warning signs:** Evaluation tab still hidden after Phase 16 changes.

## Code Examples

### Classification Evaluation Response Model

```python
# app/models/classification_evaluation.py
from pydantic import BaseModel

class ClassificationPerClassMetrics(BaseModel):
    class_name: str
    precision: float
    recall: float
    f1: float
    support: int  # number of GT samples for this class

class ClassificationEvaluationResponse(BaseModel):
    accuracy: float
    macro_f1: float
    weighted_f1: float
    per_class_metrics: list[ClassificationPerClassMetrics]
    confusion_matrix: list[list[int]]
    confusion_matrix_labels: list[str]
    conf_threshold: float
    # Discriminant field for frontend type narrowing
    evaluation_type: str = "classification"
```

### Classification Confusion Cell Samples Query

```python
# Much simpler than detection -- no IoU re-matching needed
def get_classification_confusion_cell_samples(
    cursor, dataset_id, source, actual_class, predicted_class, conf_threshold, split=None
):
    """Return sample IDs where GT=actual_class and pred=predicted_class."""
    # Build query with optional split filter
    query = """
        SELECT gt.sample_id
        FROM annotations gt
        JOIN annotations pred ON gt.sample_id = pred.sample_id AND gt.dataset_id = pred.dataset_id
        WHERE gt.dataset_id = ? AND gt.source = 'ground_truth'
        AND pred.source = ? AND pred.confidence >= ?
        AND gt.category_name = ? AND pred.category_name = ?
    """
    params = [dataset_id, source, conf_threshold, actual_class, predicted_class]

    if split:
        query += " AND gt.sample_id IN (SELECT id FROM samples WHERE dataset_id = ? AND split = ?)"
        params.extend([dataset_id, split])

    rows = cursor.execute(query, params).fetchall()
    return [r[0] for r in rows]
```

### Classification Prediction Parser

```python
# app/ingestion/classification_prediction_parser.py
class ClassificationPredictionParser:
    """Parse classification JSONL predictions into annotation rows."""

    _LABEL_KEYS = ("label", "class", "category", "class_name", "predicted_label", "prediction")
    _CONFIDENCE_KEYS = ("confidence", "score", "probability", "prob")
    _FILENAME_KEYS = ("filename", "file_name", "image", "path")

    def parse_streaming(self, file_path, sample_lookup, dataset_id, source="prediction", batch_size=5000):
        """Yield DataFrames of prediction annotation rows.

        sample_lookup: dict[filename, sample_id] from samples table
        """
        batch = []
        for line in open(file_path, encoding="utf-8"):
            record = json.loads(line.strip())
            filename = _get_field(record, self._FILENAME_KEYS)
            sample_id = sample_lookup.get(filename)
            if not sample_id:
                continue  # skip predictions for unknown files

            label = _get_field(record, self._LABEL_KEYS)
            confidence = _get_field(record, self._CONFIDENCE_KEYS)

            batch.append({
                "id": str(uuid.uuid4()),
                "dataset_id": dataset_id,
                "sample_id": sample_id,
                "category_name": str(label),
                "bbox_x": 0.0, "bbox_y": 0.0, "bbox_w": 0.0, "bbox_h": 0.0,
                "area": 0.0, "is_crowd": False,
                "source": source,
                "confidence": float(confidence) if confidence else None,
                "metadata": None,
            })

            if len(batch) >= batch_size:
                yield pd.DataFrame(batch)
                batch = []

        if batch:
            yield pd.DataFrame(batch)
```

### Frontend Classification Evaluation Panel

```tsx
// Key pattern: branch at the panel level based on datasetType
// in evaluation-panel.tsx or a wrapper component

function ClassificationEvaluation({ data }: { data: ClassificationEvaluationResponse }) {
  return (
    <div className="space-y-6">
      {/* Metric cards: Accuracy, Macro F1, Weighted F1 */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Accuracy" value={data.accuracy} />
        <MetricCard label="Macro F1" value={data.macro_f1} />
        <MetricCard label="Weighted F1" value={data.weighted_f1} />
      </div>

      {/* Confusion matrix (reuse existing component -- no background class) */}
      <ConfusionMatrix
        matrix={data.confusion_matrix}
        labels={data.confusion_matrix_labels}
        onCellClick={handleCellClick}
      />

      {/* Per-class P/R/F1 table */}
      <ClassificationPerClassTable metrics={data.per_class_metrics} />
    </div>
  );
}
```

### GT vs Predicted Badge on Grid

```tsx
// In grid-cell.tsx, extend the classification branch
{datasetType === "classification" ? (
  <>
    <ClassBadge label={gtLabel} />
    {predLabel && (
      <div className={`absolute bottom-1 right-1 z-10 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        predLabel === gtLabel
          ? "bg-green-500/80 text-white"
          : "bg-red-500/80 text-white"
      }`}>
        {predLabel}
      </div>
    )}
  </>
) : (
  // existing detection overlay
)}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Detection eval only | Detection + Classification eval side-by-side | Phase 16 | Users can evaluate both dataset types |
| Hidden eval tabs for classification | Classification-specific eval UI | Phase 16 | Full evaluation experience for classification |

**Deprecated/outdated:**
- Nothing deprecated. This is net-new functionality.

## Open Questions

1. **Multi-label classification evaluation**
   - What we know: The ClassificationJSONLParser supports multi-label (list of labels per image). Evaluation metrics for multi-label (Hamming loss, subset accuracy) differ significantly from single-label.
   - What's unclear: Does the user need multi-label evaluation now?
   - Recommendation: Scope Phase 16 to single-label classification only. If a sample has multiple GT labels, use the first one. Add multi-label support in a future phase if needed.

2. **Top-K accuracy display**
   - What we know: Classification models often report top-1 and top-5 accuracy. Current JSONL format only has one predicted label per sample.
   - What's unclear: Should the JSONL prediction format support multiple predicted labels with ranked confidence?
   - Recommendation: Keep simple -- one prediction per sample for Phase 16. The `confidence` field already provides signal. Top-K can be added later by supporting prediction arrays.

3. **PR curves for classification**
   - What we know: PR curves are meaningful for classification (varying confidence threshold to trace precision/recall). Detection evaluation already has PR curve infrastructure.
   - What's unclear: Are PR curves needed for Phase 16 or can they be deferred?
   - Recommendation: Defer PR curves for classification. The requirements specify accuracy, F1, confusion matrix, and per-class P/R/F1 -- no PR curve charts. This significantly simplifies the phase.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `app/services/evaluation.py` (560 lines, detection-only evaluation with IoU matching)
- Codebase inspection: `app/services/error_analysis.py` (detection-specific error categorization)
- Codebase inspection: `app/ingestion/classification_jsonl_parser.py` (Phase 15 classification GT parser)
- Codebase inspection: `app/ingestion/prediction_parser.py` (COCO detection prediction parser)
- Codebase inspection: `app/routers/statistics.py` (evaluation and error-analysis endpoints)
- Codebase inspection: `app/routers/datasets.py` (prediction import endpoint, format dispatch)
- Codebase inspection: `frontend/src/components/stats/stats-dashboard.tsx` (tab hiding logic)
- Codebase inspection: `frontend/src/components/stats/evaluation-panel.tsx` (detection eval UI)
- Codebase inspection: `frontend/src/components/stats/confusion-matrix.tsx` (reusable component)
- Codebase inspection: `frontend/src/components/grid/grid-cell.tsx` (ClassBadge for GT label)
- Codebase inspection: `frontend/src/components/detail/sample-modal.tsx` (already shows GT vs predicted for classification)
- Codebase inspection: `frontend/src/hooks/use-evaluation.ts` (TanStack Query hook)
- Codebase inspection: `frontend/src/hooks/use-confusion-cell.ts` (imperative fetch for cell click)
- Codebase inspection: `frontend/src/types/evaluation.ts` (TypeScript response types)

### Secondary (MEDIUM confidence)
- Classification metrics formulas (accuracy, F1, macro/weighted averaging) are well-established ML fundamentals, not library-specific.

### Tertiary (LOW confidence)
- None. All findings are from direct codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies needed, all existing libraries sufficient
- Architecture: HIGH - Clear separation pattern (separate classification eval function, existing component reuse, dataset_type routing)
- Pitfalls: HIGH - Identified from direct codebase inspection (multi-label, sample ID matching, tab hiding, div-by-zero)

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (internal codebase patterns, stable)
