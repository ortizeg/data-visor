# Technology Stack: Classification Dataset Support

**Project:** DataVisor - Classification Dataset Extension (v1.2)
**Researched:** 2026-02-18
**Overall confidence:** HIGH

---

## Key Finding: No New Dependencies Required

Classification support requires **zero new libraries**. The existing stack already contains everything needed. The work is entirely architectural -- extending parsers, adapting the DB schema, branching evaluation logic, and conditionally rendering overlays.

This is the most important finding: the complexity is in the plumbing, not the tooling.

---

## 1. JSONL Parsing -- Python stdlib `json` module

No library needed. The classification format is line-delimited JSON:

```json
{"image":"filename.jpg","prefix":"Read the number.","suffix":"3"}
```

Python's built-in `json.loads()` per line is the correct approach. `ijson` (already installed for COCO streaming) is overkill -- JSONL is inherently streamable by reading line-by-line. Each line is a complete JSON object.

**Implementation:** A new `ClassificationParser(BaseParser)` in `app/ingestion/classification_parser.py`.

| Concern | Approach | Why |
|---------|----------|-----|
| Streaming | `for line in open(path)` | JSONL is naturally line-streamable |
| Batching | Accumulate dicts, yield DataFrames every `batch_size` lines | Matches existing `COCOParser` pattern |
| Category extraction | First pass: collect unique `suffix` values | No explicit category list in JSONL format |
| Memory | O(batch_size) not O(dataset) | Same streaming guarantee as COCO path |

**BaseParser compatibility:** The existing `BaseParser` ABC defines `parse_categories`, `build_image_batches`, and `build_annotation_batches`. The classification parser implements all three. The key difference: `build_annotation_batches` yields rows with `bbox_x=0, bbox_y=0, bbox_w=0, bbox_h=0` (sentinel values -- see section 5 for schema rationale).

**Image dimensions:** Classification JSONL does not include width/height (unlike COCO JSON). The parser uses `PIL.Image.open(path).size` (Pillow already installed as `pillow>=12.1.1`) for header-only dimension reads. This requires access to the image directory during parsing, which the existing `build_image_batches(file_path, dataset_id, split, image_dir)` signature already supports.

### Confidence: HIGH
Source: Direct codebase inspection of `BaseParser` and `COCOParser` interfaces.

---

## 2. Classification Evaluation Metrics -- `scikit-learn` (already installed, >=1.8.0)

The project already depends on `scikit-learn>=1.8.0`. It provides everything needed:

| Metric | scikit-learn Function | Purpose |
|--------|----------------------|---------|
| Accuracy | `accuracy_score(y_true, y_pred)` | Top-level summary stat |
| Per-class P/R/F1 | `precision_recall_fscore_support(y_true, y_pred, average=None)` | Replaces detection's per-class AP table |
| Macro F1 | `precision_recall_fscore_support(..., average='macro')` | Overall model quality (class-balanced) |
| Weighted F1 | `precision_recall_fscore_support(..., average='weighted')` | Overall model quality (sample-weighted) |
| Confusion Matrix | `confusion_matrix(y_true, y_pred)` | Direct NxN array, no IoU matching |

**Critical difference from detection evaluation:** Classification is dramatically simpler. No IoU matching, no confidence thresholds, no PR curves. Each image has exactly one GT label and one predicted label. The entire evaluation is `confusion_matrix(y_true, y_pred)` plus `classification_report()`.

**New service:** `app/services/classification_evaluation.py` -- separate from `app/services/evaluation.py` because the logic is fundamentally different (no IoU, no bounding boxes, no `supervision` dependency).

**What detection metrics map to in classification:**

| Detection Concept | Classification Equivalent | Notes |
|-------------------|--------------------------|-------|
| mAP@50/75/50:95 | Accuracy + Macro F1 | No IoU thresholds in classification |
| PR Curves per class | Per-class P/R/F1 table | No confidence sweep for single-label |
| IoU threshold slider | Removed (not applicable) | No spatial overlap concept |
| Confidence threshold | Kept only if predictions include confidence scores | Filters which predictions are considered |
| Confusion Matrix | Confusion Matrix (same) | Simpler: no "background" row/col |
| Error Analysis (TP/FP/FN/Label Error) | Correct/Incorrect per class | No spatial matching needed |

### Confidence: HIGH
Source: `scikit-learn>=1.8.0` already in `pyproject.toml` line 20. Functions verified in scikit-learn stable docs.

---

## 3. Confusion Matrix Frontend -- Reuse Existing Component

The existing `confusion-matrix.tsx` component accepts `matrix: number[][]` and `labels: string[]`. It is already format-agnostic. For classification:

- **No "background" row/column** -- classification has no concept of "no detection"
- The backend simply returns labels without "background"
- The component renders correctly without any changes

**Zero frontend changes needed for the confusion matrix visualization.**

### Confidence: HIGH
Source: Direct inspection of `frontend/src/components/stats/confusion-matrix.tsx` (accepts generic `number[][]`).

---

## 4. Annotation Overlay -- Conditional Class Label Badge

For classification datasets, there are no bounding boxes. The existing `AnnotationOverlay` renders SVG `<rect>` elements. For classification, render a class label badge instead.

**Approach:** The `AnnotationOverlay` component branches on `bbox_w > 0`:
- Detection annotations (`bbox_w > 0`): Render `<rect>` + label text (existing behavior)
- Classification annotations (`bbox_w === 0`): Render a colored pill/badge with the class name in the top-left corner

This reuses the existing SVG viewBox coordinate system and `getSourceColor()` utility. No new component needed -- extend the existing one with a conditional branch.

**Alternative considered:** Separate `ClassificationOverlay` component. Rejected because it would require duplicating the SVG viewBox setup and the caller would need to branch on dataset type before rendering. A single component with an internal branch is cleaner.

### Confidence: HIGH
Source: Direct inspection of `frontend/src/components/grid/annotation-overlay.tsx`.

---

## 5. Database Schema -- `dataset_type` Column

Two approaches considered for storing classification annotations:

**Option A (recommended): Sentinel bbox values (0,0,0,0) + `dataset_type` column**
- Pro: No schema migration on `annotations` table, all existing queries work unchanged
- Pro: The `dataset_type` column on `datasets` is the single dispatch point for all conditional logic
- Con: Semantically imprecise (bbox columns have values that mean "not applicable")

**Option B (rejected): Nullable bbox columns**
- Con: Breaks every existing query that assumes bbox is NOT NULL
- Con: Requires extensive SQL changes across statistics, evaluation, error analysis, and filter builder
- Con: DuckDB ALTER COLUMN to change NOT NULL constraints on existing data is non-trivial

**Implementation:** One new column on `datasets`:

```sql
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS dataset_type VARCHAR DEFAULT 'detection';
```

Values: `'detection'` or `'classification'`. Added in `duckdb_repo.py`'s `initialize_schema()` method, following the existing pattern of idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations (already used for `prediction_count`, `tags`, `image_dir`).

**No changes to the `annotations` table schema.** Classification annotations store:
- `category_name`: the class label (from JSONL `suffix` field)
- `bbox_x=0, bbox_y=0, bbox_w=0, bbox_h=0`: sentinel values
- `area=0`
- `source='ground_truth'`
- One annotation per sample (1:1 mapping, unlike detection's 1:N)

### Confidence: HIGH
Source: Direct inspection of `app/repositories/duckdb_repo.py` schema and migration patterns.

---

## 6. Format Auto-Detection -- Extend `FolderScanner`

The current `FolderScanner` only detects COCO JSON. For classification, add a parallel detection path:

| Format | File Extension | Detection Heuristic |
|--------|---------------|-------------------|
| COCO JSON | `.json` | Top-level key `"images"` (existing) |
| Classification JSONL | `.jsonl` | First line parses as JSON with `"image"` + `"suffix"` keys |

**New method:** `_is_classification_jsonl(file_path: Path) -> bool`:
1. Check file extension is `.jsonl`
2. Read first line
3. Parse with `json.loads()`
4. Verify required keys: `image`, `suffix`

**Layout detection:** Classification JSONL datasets follow the same Roboflow layout patterns already detected (Layout B: split dirs with co-located files). The scanner looks for `.jsonl` files instead of `.json` files within split directories.

**The `ScanResult.format` field** changes from always `"coco"` to `"coco" | "classification_jsonl"`. This propagates through:
- `IngestRequest.format` (already supports arbitrary strings)
- `DatasetResponse.format` (already a `str` field)
- `datasets.format` column in DuckDB (already `VARCHAR`)

### Confidence: HIGH
Source: Direct inspection of `app/services/folder_scanner.py` and `app/models/scan.py`.

---

## 7. Evaluation API Response -- Discriminated Union

The `/datasets/{id}/evaluation` endpoint currently returns `EvaluationResponse` (mAP, PR curves, etc). For classification, it needs a different shape.

**Approach:** New response model with `dataset_type` discriminator:

```python
class ClassificationEvaluationResponse(BaseModel):
    dataset_type: Literal["classification"] = "classification"
    accuracy: float
    macro_f1: float
    weighted_f1: float
    per_class_metrics: list[ClassificationPerClassMetrics]
    confusion_matrix: list[list[int]]
    confusion_matrix_labels: list[str]

class ClassificationPerClassMetrics(BaseModel):
    class_name: str
    precision: float
    recall: float
    f1: float
    support: int  # number of GT samples for this class
```

**Endpoint dispatch:** The router queries `dataset_type` from the `datasets` table and calls the appropriate evaluation function:

```python
dataset_type = cursor.execute(
    "SELECT dataset_type FROM datasets WHERE id = ?", [dataset_id]
).fetchone()[0]

if dataset_type == "classification":
    return compute_classification_evaluation(cursor, dataset_id, source, conf_threshold, split=split)
else:
    return compute_evaluation(cursor, dataset_id, source, iou_threshold, conf_threshold, split=split)
```

**Alternative considered:** Extending the existing `EvaluationResponse` with optional fields. Rejected because the metrics are fundamentally different -- a union type with many optional fields would be confusing and error-prone for the frontend to consume.

### Confidence: HIGH
Source: Direct inspection of `app/models/evaluation.py` and `app/routers/statistics.py`.

---

## 8. Frontend Evaluation Panel -- Conditional Rendering

The existing `evaluation-panel.tsx` renders PR curves, mAP summary, per-class AP table, and confusion matrix. For classification datasets, it renders a different set of components:

**Detection evaluation panel (existing, unchanged):**
- IoU threshold slider
- Confidence threshold slider
- mAP@50/75/50:95 summary cards
- PR curves (Recharts line chart)
- Per-class AP table
- Confusion matrix

**Classification evaluation panel (new conditional branch):**
- Confidence threshold slider (only if predictions have confidence)
- Accuracy + Macro F1 + Weighted F1 summary cards
- Per-class P/R/F1 table (reuse the same table component, different columns)
- Confusion matrix (reuse existing component)

**No new chart types needed.** The per-class table uses the same Tailwind-styled table pattern. Summary cards use the same card component. The confusion matrix component is reused directly. The PR curve chart is simply not rendered for classification datasets.

**Dispatch mechanism:** The `DatasetResponse` type gets a `dataset_type` field. The evaluation panel checks this and renders the appropriate metrics. The response type itself carries the `dataset_type` discriminator.

### Confidence: HIGH
Source: Direct inspection of `frontend/src/components/stats/evaluation-panel.tsx` and `frontend/src/types/evaluation.ts`.

---

## 9. Backend Parser Factory -- Dispatch Pattern

The ingestion service currently hardcodes `COCOParser`. It needs a factory:

```python
def get_parser(format: str) -> BaseParser:
    if format == "coco":
        return COCOParser(batch_size=1000)
    elif format == "classification_jsonl":
        return ClassificationParser(batch_size=1000)
    raise ValueError(f"Unknown format: {format}")
```

The `IngestionService.ingest_with_progress()` method changes from:
```python
parser = COCOParser(batch_size=1000)
```
to:
```python
parser = get_parser(format)
```

The rest of the ingestion flow (batch inserts, thumbnail generation, plugin hooks) works unchanged because all parsers implement the same `BaseParser` interface.

**dataset_type assignment:** When creating the dataset record, set `dataset_type` based on format:
```python
dataset_type = "classification" if format == "classification_jsonl" else "detection"
```

### Confidence: HIGH
Source: Direct inspection of `app/services/ingestion.py` and `app/ingestion/base_parser.py`.

---

## 10. Error Analysis Adaptation

The existing `error_analysis.py` categorizes detection errors using IoU matching (TP, Hard FP, Label Error, FN). For classification, this simplifies to:

- **Correct:** GT label == predicted label
- **Incorrect:** GT label != predicted label (with the specific GT/predicted pair recorded)

No IoU matching, no bounding box comparison. The classification error analysis is a simple label comparison per image.

**Implementation:** New function `classify_errors()` in `app/services/classification_evaluation.py` (colocated with classification metrics, not in `error_analysis.py` which is detection-specific).

**Existing `ErrorAnalysisResponse` model reuse:** The response shape can be simplified but the same pattern works -- `ErrorSummary` with counts, `PerClassErrors` with per-class breakdowns, and `samples_by_type` grouping.

### Confidence: HIGH
Source: Direct inspection of `app/services/error_analysis.py`.

---

## Complete Stack Summary

### New Files to Create

| File | Purpose | Dependencies Used |
|------|---------|-------------------|
| `app/ingestion/classification_parser.py` | Parse JSONL format | `json` stdlib, `pandas`, `PIL.Image` |
| `app/services/classification_evaluation.py` | Accuracy/F1/confusion matrix | `sklearn.metrics` |
| `app/models/classification_evaluation.py` | Response models for classification eval | `pydantic` |

### Files to Modify

| File | Change | Scope |
|------|--------|-------|
| `app/repositories/duckdb_repo.py` | Add `dataset_type` column migration | 3 lines |
| `app/services/ingestion.py` | Parser factory dispatch | ~10 lines |
| `app/services/folder_scanner.py` | JSONL format detection | ~30 lines |
| `app/models/dataset.py` | Add `dataset_type` to `DatasetResponse` | 1 line |
| `app/models/scan.py` | Allow `format` values beyond `"coco"` | Already supports it |
| `app/routers/statistics.py` | Dispatch evaluation by dataset_type | ~15 lines |
| `frontend/src/types/evaluation.ts` | Add classification eval types | ~20 lines |
| `frontend/src/components/stats/evaluation-panel.tsx` | Conditional rendering | ~50 lines |
| `frontend/src/components/grid/annotation-overlay.tsx` | Class label badge for classification | ~15 lines |

### No New Backend Dependencies

The `pyproject.toml` does not change. Everything is already installed:
- `scikit-learn>=1.8.0` -- classification metrics
- `pillow>=12.1.1` -- image dimension reading
- `pandas>=3.0.0` -- DataFrame batching
- `duckdb>=1.4.4` -- schema and queries

### No New Frontend Dependencies

The `package.json` does not change:
- `recharts>=3.7.0` -- existing charts (reused for classification tables)
- React + Tailwind -- conditional rendering
- Existing SVG overlay -- class label badges

---

## Alternatives Considered

| Decision | Chosen | Alternative | Why Not |
|----------|--------|-------------|---------|
| JSONL parsing | `json.loads()` per line | `ijson` streaming | JSONL is line-delimited; `json.loads` per line is simpler and equally streaming |
| Classification metrics | `sklearn.metrics` | Custom numpy | sklearn already installed; classification metrics are trivial |
| Schema approach | Sentinel bbox (0,0,0,0) + `dataset_type` | Nullable bbox columns | Would break all existing detection queries |
| Confusion matrix UI | Reuse `confusion-matrix.tsx` | New classification component | Existing component is format-agnostic |
| Evaluation response | Separate `ClassificationEvaluationResponse` | Extend `EvaluationResponse` with optional fields | Metrics are fundamentally different; union with optionals is confusing |
| Class label overlay | Extend existing `AnnotationOverlay` | Separate `ClassificationOverlay` | Single component with conditional branch is cleaner |
| Image dimensions | `PIL.Image.open().size` | `pyvips` | PIL header-only read is sufficient and simpler |

---

## What NOT to Add

| Technology | Why Skip |
|------------|----------|
| **Any new pip package** | `scikit-learn` + `pillow` already cover all needs |
| **Any new npm package** | Existing Recharts + Tailwind + SVG cover all visualization needs |
| **`supervision` for classification** | supervision is detection-focused (IoU, mAP). Classification metrics come from sklearn |
| **`torchmetrics`** | Would add a PyTorch-ecosystem dependency for metrics sklearn already provides |
| **Separate classification database table** | Annotations table with sentinel bbox values works cleanly with `dataset_type` dispatch |
| **GraphQL or new API layer** | REST endpoints with discriminated response types are sufficient |
| **New chart library** | No new chart types needed -- classification uses tables and the existing confusion matrix |

---

## Sources

- **Existing codebase** (HIGH confidence): Direct inspection of all referenced files
- **scikit-learn metrics**: Already validated in project dependencies, functions stable across versions
- **Roboflow JSONL format**: Project context provided by user with sample data
- **DuckDB ALTER TABLE patterns**: Already used 4 times in `duckdb_repo.py` for idempotent migrations

---
*Stack research for: DataVisor Classification Dataset Support*
*Researched: 2026-02-18*
