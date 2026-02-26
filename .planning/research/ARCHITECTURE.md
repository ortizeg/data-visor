# Architecture Patterns: Classification Dataset Support

**Domain:** Single-label classification integration into existing detection-centric DataVisor
**Researched:** 2026-02-18
**Confidence:** HIGH -- based on direct codebase analysis, no external dependencies needed

---

## Executive Summary

Classification support requires threading a `dataset_type` discriminator through every layer of the stack: schema, ingestion, API responses, frontend rendering, and evaluation. The key architectural decision is to **reuse the existing `annotations` table with nullable bbox columns** rather than creating a separate table. This preserves all existing query patterns, filtering, and statistics while classification annotations simply have `NULL` bbox values. The frontend conditionally renders class labels (pill/chip) vs bounding boxes based on the dataset type, and the evaluation service branches between detection metrics (mAP/IoU) and classification metrics (accuracy/precision/recall/F1).

---

## Existing Architecture Snapshot (Relevant Surfaces)

Before defining integration points, here are the exact existing structures that classification support touches:

### DuckDB Schema (from `duckdb_repo.py`)
```sql
-- datasets: NO dataset_type column. format is always "coco".
datasets(id, name, format, source_path, image_dir, image_count,
         annotation_count, category_count, prediction_count, created_at, metadata)

-- annotations: bbox columns are NOT NULL. Every row must have bbox values.
annotations(id, dataset_id, sample_id, category_name,
            bbox_x DOUBLE NOT NULL, bbox_y DOUBLE NOT NULL,
            bbox_w DOUBLE NOT NULL, bbox_h DOUBLE NOT NULL,
            area, is_crowd, source, confidence, metadata)

-- samples: dataset-agnostic, works for both detection and classification
samples(id, dataset_id, file_name, width, height, thumbnail_path, split, metadata, image_dir, tags)

-- categories: dataset-agnostic, works for both types
categories(dataset_id, category_id, name, supercategory)
```

### Ingestion Pipeline (from `ingestion.py`, `coco_parser.py`, `folder_scanner.py`)
- `FolderScanner` detects COCO layouts only (checks for `"images"` key in JSON)
- `IngestionService.ingest_with_progress()` hardcodes `COCOParser()`
- `ScanResult.format` is always `"coco"`
- All parsers yield DataFrames with bbox columns

### Evaluation (from `evaluation.py`)
- `compute_evaluation()` builds `sv.Detections` objects with xyxy bounding boxes
- IoU matching is hardcoded throughout (no concept of non-spatial matching)
- `_load_detections()` queries `bbox_x, bbox_y, bbox_w, bbox_h` from annotations
- Response model: `EvaluationResponse` has `pr_curves`, `ap_metrics`, `iou_threshold`

### Frontend (from `annotation-overlay.tsx`, `grid-cell.tsx`, `sample-modal.tsx`)
- `AnnotationOverlay` renders SVG `<rect>` elements using `ann.bbox_x/y/w/h`
- `Annotation` type has required `bbox_x/y/w/h: number` fields
- `SampleModal` shows annotation editor (Konva bbox editing), annotation table with bbox columns
- `EvaluationPanel` shows PR curves, mAP cards, per-class AP table, confusion matrix

---

## Recommended Architecture

### High-Level Integration Pattern

```
                    dataset_type = "detection" | "classification"
                              |
        +---------------------+---------------------+
        |                     |                     |
    Ingestion             Rendering            Evaluation
    (parser per          (conditional          (metric strategy
     format)              overlay)              per type)
```

The `dataset_type` field on the `datasets` table is the single source of truth that drives conditional behavior across all layers. Every component reads this value and branches accordingly. Simple if/else branching at well-defined boundary points -- no polymorphism or plugin system needed.

### Component Boundaries

| Component | Responsibility | Communicates With | Change Type |
|-----------|---------------|-------------------|-------------|
| `datasets` table | Stores `dataset_type` column | All components read it | ADD column |
| `annotations` table | Stores all annotations (bbox nullable for classification) | Parsers write, API reads | ALTER bbox to nullable |
| `ClassificationFolderParser` | Parses folder-of-folders layout | IngestionService | NEW |
| `ClassificationPredictionParser` | Parses classification prediction CSV/JSON | Ingestion router | NEW |
| `IngestionService` | Routes to correct parser based on format | Parsers, DuckDB | MODIFY |
| `FolderScanner` | Auto-detects dataset format | Ingestion router | MODIFY |
| `classification_evaluation.py` | Computes accuracy/F1/confusion matrix | Statistics router | NEW |
| `AnnotationOverlay` (frontend) | Renders bbox SVG or class label pill | GridCell, SampleModal | MODIFY |
| `EvaluationPanel` (frontend) | Shows detection or classification metrics | Stats dashboard | MODIFY |
| `DatasetResponse` / `AnnotationResponse` | API response models | Frontend types | MODIFY |

### Data Flow: Classification Ingestion

```
User points scanner at folder
    |
    v
FolderScanner detects structure:
    folder-of-folders?  -> format = "classification_folders"
    CSV with labels?    -> format = "classification_csv"
    COCO with bbox?     -> format = "coco" (existing, unchanged)
    |
    v
ScanResult returned with format string + detected splits
    |
    v
IngestionService dispatches to ClassificationFolderParser
    |
    v
Parser yields sample batches (same schema as detection -- width/height from PIL)
    |
    v
Parser yields annotation batches:
    - category_name = folder name (class label)
    - bbox_x/y/w/h = NULL
    - area = NULL
    - source = "ground_truth"
    - ONE annotation per sample (single-label classification)
    |
    v
DuckDB bulk insert (same INSERT INTO annotations pattern)
    |
    v
datasets row created with dataset_type = "classification"
```

### Data Flow: Classification Evaluation

```
GET /datasets/{id}/evaluation
    |
    v
Router reads dataset_type from datasets table
    |
    v
if dataset_type == "classification":
    compute_classification_evaluation()    # NEW function
else:
    compute_evaluation()                   # existing detection path
    |
    v
Classification evaluation:
    1. Load GT: one annotation per sample (source='ground_truth')
    2. Load preds: highest-confidence prediction per sample
    3. Match by sample_id (no IoU, no spatial matching)
    4. Build confusion matrix (no "background" row/col)
    5. Compute per-class precision/recall/F1
    6. Compute overall accuracy, macro-F1, weighted-F1
    7. Return ClassificationEvaluationResponse
```

---

## Key Architectural Decisions

### Decision 1: Reuse `annotations` Table with Nullable Bbox

**Recommendation:** Reuse the existing `annotations` table. Make bbox columns nullable.

**Why this is clearly the right choice:**
- Every existing query path (statistics, filtering, batch annotations, triage) filters on `category_name`, `source`, `dataset_id` -- none require non-null bbox.
- The statistics endpoint (`GROUP BY category_name`) works identically for classification.
- Saved views, tags, embeddings, similarity search -- all sample-level features work without changes.
- A separate `classification_annotations` table would require parallel query paths in every service, doubling the maintenance surface.

**Schema migration (in `duckdb_repo.py:initialize_schema`):**
```sql
-- Add dataset_type to datasets
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS dataset_type VARCHAR DEFAULT 'detection';

-- Make bbox columns nullable for classification support
-- DuckDB supports DROP NOT NULL via ALTER TABLE
ALTER TABLE annotations ALTER COLUMN bbox_x DROP NOT NULL;
ALTER TABLE annotations ALTER COLUMN bbox_y DROP NOT NULL;
ALTER TABLE annotations ALTER COLUMN bbox_w DROP NOT NULL;
ALTER TABLE annotations ALTER COLUMN bbox_h DROP NOT NULL;
```

**Risk note (MEDIUM confidence):** DuckDB's `ALTER COLUMN DROP NOT NULL` syntax needs verification against current DuckDB version. Fallback approach: change the `CREATE TABLE IF NOT EXISTS annotations` statement to remove `NOT NULL` from bbox columns. Since the table already exists, this alone does nothing -- but combined with a migration that creates a new table, copies data, drops old, and renames, it works. Verify during implementation.

**Simpler fallback:** Change the `CREATE TABLE` statement to not have `NOT NULL` on bbox columns. For existing databases, store classification bbox as `0.0` instead of `NULL`. This avoids ALTER entirely but is semantically less clean. The code paths would check `bbox_w == 0 AND bbox_h == 0` as "no bbox" rather than `IS NULL`.

### Decision 2: `dataset_type` on `datasets` Table

**Recommendation:** Yes. Add `dataset_type VARCHAR DEFAULT 'detection'`.

**Why:**
- Single source of truth for conditional behavior across all layers.
- Default of `'detection'` means zero migration impact on existing datasets.
- Frontend reads it once per dataset load and threads it through props.
- Evaluation router uses it to select the metric strategy.
- Future types (segmentation, keypoints) extend the same pattern.

**Not on annotations:** All annotations in a dataset share the same type. There is no mixed detection+classification dataset in DataVisor's model. The dataset-level discriminator is sufficient.

### Decision 3: Frontend Conditional Rendering

**Recommendation:** Thread `datasetType` through component props from the dataset query. Branch at component boundaries, not deep inside components.

**Where conditional rendering applies:**

| Component | Detection Behavior | Classification Behavior |
|-----------|-------------------|------------------------|
| `AnnotationOverlay` | SVG bbox rectangles with class labels | Class label pill/chip in top-left corner |
| `GridCell` | Overlay shows boxes | Overlay shows label pill |
| `SampleModal` image area | SVG bbox overlays | Class label overlay (no boxes) |
| `SampleModal` annotation table | Columns: class, bbox, area, source | Columns: class, confidence, source (no bbox) |
| `AnnotationEditor` (Konva) | Draggable/resizable bbox editing | Class picker dropdown (no Konva canvas) |
| `DrawLayer` / `EditableRect` | Shown in edit mode | Hidden (no bbox to draw) |
| `EvaluationPanel` header | mAP@50, mAP@75, mAP@50:95 cards | Accuracy, Macro-F1, Weighted-F1 cards |
| `PRCurveChart` | Shown (per-class PR curves) | Hidden (not meaningful for classification) |
| `PerClassTable` | Columns: AP50, AP75, AP50:95, P, R | Columns: Precision, Recall, F1, Support |
| `ConfusionMatrix` | Has "background" row/col for FP/FN | No "background" -- pure NxN class matrix |
| `ErrorAnalysis` panel | IoU-based error categories | Misclassification categories (simpler) |
| `PredictionImportDialog` | Accepts COCO results JSON | Accepts classification CSV/JSON |
| Filter sidebar | Bbox area filter shown | Bbox area filter hidden |

**Implementation pattern:**
```typescript
// Dataset type flows from page -> components
const { data: dataset } = useDataset(datasetId);
const datasetType = dataset?.dataset_type ?? "detection";

// AnnotationOverlay branches at the top
export function AnnotationOverlay({ annotations, imageWidth, imageHeight, datasetType }) {
  if (datasetType === "classification") {
    return <ClassificationLabel annotations={annotations} />;
  }
  // Existing SVG bbox rendering unchanged
  return <svg viewBox={...}>...</svg>;
}
```

### Decision 4: Separate Evaluation Function (NOT Shared)

**Recommendation:** Add `compute_classification_evaluation()` as a separate function. Do NOT retrofit the detection evaluation to handle both.

**Why the detection code cannot be reused:**
- Detection evaluation builds `sv.Detections` objects with xyxy bounding boxes -- classification has none.
- Detection uses IoU matching to determine TP/FP/FN -- classification matches by sample_id.
- Detection's confusion matrix includes a "background" class -- classification does not.
- Detection computes AP (area under PR curve at multiple IoU thresholds) -- classification computes F1.
- The `_load_detections()` helper queries bbox columns that are NULL for classification.

**New response model:**
```python
class ClassificationEvaluationResponse(BaseModel):
    """Evaluation payload for classification datasets."""
    accuracy: float
    macro_precision: float
    macro_recall: float
    macro_f1: float
    weighted_f1: float
    per_class_metrics: list[ClassificationPerClassMetrics]
    confusion_matrix: list[list[int]]
    confusion_matrix_labels: list[str]
    conf_threshold: float

class ClassificationPerClassMetrics(BaseModel):
    class_name: str
    precision: float
    recall: float
    f1: float
    support: int  # number of GT samples for this class
```

**Router branching:**
```python
@router.get("/{dataset_id}/evaluation")
def get_evaluation(dataset_id, source, iou_threshold, conf_threshold, split, db):
    cursor = db.connection.cursor()
    dataset_type = cursor.execute(
        "SELECT dataset_type FROM datasets WHERE id = ?", [dataset_id]
    ).fetchone()[0]

    if dataset_type == "classification":
        return compute_classification_evaluation(
            cursor, dataset_id, source, conf_threshold, split
        )
    else:
        return compute_evaluation(
            cursor, dataset_id, source, iou_threshold, conf_threshold, split
        )
```

**Frontend union type:**
```typescript
// The hook returns different shapes based on dataset_type
// Use discriminated union or simply check for presence of `accuracy` field
type EvaluationData = DetectionEvaluationResponse | ClassificationEvaluationResponse;

function isClassificationEval(data: EvaluationData): data is ClassificationEvaluationResponse {
  return "accuracy" in data;
}
```

### Decision 5: Ingestion Auto-Detection via FolderScanner

**Recommendation:** Extend `FolderScanner.scan()` to detect classification layouts BEFORE falling through to COCO detection. Classification layouts are cheaper to detect (structural directory patterns, no JSON parsing needed).

**Classification layout: folder-of-folders (ImageNet-style)**
```
dataset/
  train/
    cat/          # class label = directory name
      img001.jpg
      img002.jpg
    dog/
      img003.jpg
  val/
    cat/
      img004.jpg
    dog/
      img005.jpg
```

Detection heuristic:
1. Root or split subdirectories contain subdirectories whose names are NOT known split names.
2. Those subdirectories contain image files (no JSON files).
3. Multiple sibling class directories exist (>= 2 classes).

**Classification layout: CSV labels**
```
dataset/
  labels.csv       # columns: filename, label (or image, class)
  images/
    img001.jpg
```

Detection heuristic:
1. Root contains a CSV file.
2. CSV has 2+ columns, first column values match filenames in an image directory.

**Scanner modification (in `folder_scanner.py`):**
```python
def scan(self, root_path: str) -> ScanResult:
    # 1. Try classification folder-of-folders (cheapest check)
    splits = self._try_classification_folders(root, warnings)
    if splits:
        return ScanResult(format="classification_folders", splits=splits, ...)

    # 2. Try classification CSV
    splits = self._try_classification_csv(root, warnings)
    if splits:
        return ScanResult(format="classification_csv", splits=splits, ...)

    # 3. Fall through to existing COCO detection (unchanged)
    splits = self._try_layout_b(root, warnings)
    if not splits:
        splits = self._try_layout_a(root, warnings)
    if not splits:
        splits = self._try_layout_c(root, warnings)
    return ScanResult(format="coco", splits=splits, ...)
```

**Important:** The `ScanResult.format` field currently is always `"coco"`. This now becomes the actual detected format string that drives parser dispatch in `IngestionService`.

---

## New Components to Build

### Backend

| Component | File | Purpose |
|-----------|------|---------|
| `ClassificationFolderParser` | `app/ingestion/classification_folder_parser.py` | Parse ImageNet-style folder-of-folders into samples + annotations |
| `ClassificationCSVParser` | `app/ingestion/classification_csv_parser.py` | Parse CSV label files into samples + annotations |
| `ClassificationPredictionParser` | `app/ingestion/classification_prediction_parser.py` | Parse classification prediction CSV/JSON |
| `compute_classification_evaluation` | `app/services/classification_evaluation.py` | Accuracy/F1/confusion matrix (pure numpy) |
| `ClassificationEvaluationResponse` | `app/models/evaluation.py` | Response model for classification metrics |
| Schema migration | `app/repositories/duckdb_repo.py` | `dataset_type` column, nullable bbox columns |
| Scanner extensions | `app/services/folder_scanner.py` | `_try_classification_folders()`, `_try_classification_csv()` |

### Frontend

| Component | File | Purpose |
|-----------|------|---------|
| `ClassificationLabel` | `src/components/grid/classification-label.tsx` | Class label pill overlay for grid cells and modal |
| `ClassificationEvaluationPanel` | `src/components/stats/classification-eval-panel.tsx` | Accuracy/F1 metrics display with confusion matrix |
| `ClassificationPerClassTable` | `src/components/stats/classification-per-class-table.tsx` | Per-class P/R/F1/Support table |

### Modified Components (Existing Files)

| Component | File | What Changes |
|-----------|------|-------------|
| `DuckDBRepo.initialize_schema` | `duckdb_repo.py` | Add `dataset_type` column, make bbox nullable |
| `FolderScanner` | `folder_scanner.py` | Add classification layout detection methods |
| `IngestionService` | `services/ingestion.py` | Parser dispatch by format (registry pattern) |
| `DatasetResponse` | `models/dataset.py` | Add `dataset_type: str = "detection"` field |
| `AnnotationResponse` | `models/annotation.py` | Make bbox fields `Optional[float] = None` |
| `AnnotationCreate` | `models/annotation.py` | Make bbox fields optional |
| `BaseParser` | `ingestion/base_parser.py` | Relax bbox requirement in docstring |
| `get_evaluation` router | `routers/statistics.py` | Branch on dataset_type |
| `get_dataset_statistics` router | `routers/statistics.py` | Adjust summary labels for classification |
| `AnnotationOverlay` | `annotation-overlay.tsx` | Conditional bbox vs label rendering |
| `GridCell` | `grid-cell.tsx` | Pass `datasetType` prop to overlay |
| `SampleModal` | `sample-modal.tsx` | Conditional annotation display, hide bbox editing for classification |
| `StatsDashboard` | `stats-dashboard.tsx` | Route to correct evaluation panel |
| `EvaluationPanel` | `evaluation-panel.tsx` | Branch on dataset type |
| `AnnotationList` | `annotation-list.tsx` | Hide bbox columns for classification |
| `ScanResults` UI | `scan-results.tsx` | Show correct format badge |
| `PredictionImportDialog` | `prediction-import-dialog.tsx` | Support classification prediction format |
| `Dataset` type | `types/dataset.ts` | Add `dataset_type` field |
| `Annotation` type | `types/annotation.ts` | Make bbox fields optional (`number | null`) |
| `useEvaluation` hook | `hooks/use-evaluation.ts` | Handle union response type |
| `useFilteredEvaluation` hook | `hooks/use-filtered-evaluation.ts` | Handle classification eval response |

---

## Patterns to Follow

### Pattern 1: Type Discriminator Threading

**What:** Pass `dataset_type` as a prop from the top-level dataset query down to components that need conditional behavior. Never re-fetch it inside child components.

**When:** Any component that renders differently for detection vs classification.

**Why:** Single fetch, single source of truth. Components remain pure.

```typescript
// Page level: fetch once
const { data: dataset } = useDataset(datasetId);

// Thread to children
<ImageGrid datasetType={dataset.dataset_type} ... />
<StatsDashboard datasetType={dataset.dataset_type} ... />
<SampleModal datasetType={dataset.dataset_type} ... />
```

### Pattern 2: Parser Registry for Ingestion Dispatch

**What:** Map format strings to parser classes instead of hardcoding `COCOParser()`.

**When:** `IngestionService` creates a parser for ingestion.

```python
PARSER_REGISTRY: dict[str, type[BaseParser]] = {
    "coco": COCOParser,
    "classification_folders": ClassificationFolderParser,
    "classification_csv": ClassificationCSVParser,
}

# In ingest_with_progress():
parser_class = PARSER_REGISTRY.get(format)
if parser_class is None:
    raise ValueError(f"Unsupported format: {format}")
parser = parser_class(batch_size=1000)
```

### Pattern 3: Evaluation Strategy Selection

**What:** The evaluation router reads `dataset_type` and dispatches to the correct evaluation function. Each function returns its own response model.

**When:** Evaluation endpoint is called.

```python
if dataset_type == "classification":
    return compute_classification_evaluation(cursor, dataset_id, source, conf_threshold, split)
else:
    return compute_evaluation(cursor, dataset_id, source, iou_threshold, conf_threshold, split)
```

### Pattern 4: One Annotation Per Sample for Classification

**What:** Classification datasets have exactly one ground-truth annotation per sample (the class label). Predictions also have one annotation per sample (the predicted class with confidence). This is enforced by the parser, not by the schema.

**When:** Classification ingestion and evaluation.

**Why this matters:** The evaluation service can safely do `GROUP BY sample_id` and take the first row, rather than needing to handle multiple annotations per sample.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Separate Tables for Each Dataset Type

**What:** Creating `classification_annotations`, `detection_annotations`, etc.

**Why bad:** Every query in the codebase touches the `annotations` table. Statistics (`GROUP BY category_name`), filtering, batch fetch, triage -- all would need parallel implementations. The codebase has ~15 queries against the annotations table across 6 services.

**Instead:** Nullable bbox columns in the existing table. Classification rows have NULL bbox.

### Anti-Pattern 2: Repurposing Detection Response Fields

**What:** Stuffing accuracy into `map50`, precision into `map75`, etc. to avoid a new response model.

**Why bad:** The frontend would need to know that `map50` really means "accuracy" when `dataset_type === "classification"`. Field names become lies. API consumers are confused.

**Instead:** Separate response models. The frontend discriminates on the response shape.

### Anti-Pattern 3: Making the Detection Evaluation Handle Both Types

**What:** Adding `if dataset_type == "classification"` branches inside `compute_evaluation()`, `_load_detections()`, `_build_detections()`, etc.

**Why bad:** The detection evaluation is deeply spatial -- every helper function deals with bounding boxes, xyxy conversion, IoU matrices. Grafting classification logic into this creates an unmaintainable chimera.

**Instead:** A separate, clean `compute_classification_evaluation()` function. Classification evaluation is simple (array comparison, confusion matrix) -- it does not need supervision library or IoU machinery.

### Anti-Pattern 4: Frontend Feature Detection Instead of Type Discrimination

**What:** Checking `if annotations[0]?.bbox_x === null` to determine rendering mode.

**Why bad:** Fragile. Fails on samples with no annotations. Requires loading annotations before knowing how to render. Creates subtle bugs.

**Instead:** Use `dataset_type` from the dataset metadata (loaded once, always available). The type determines rendering, not the data shape.

---

## Scalability Considerations

| Concern | At 1K images | At 100K images | At 1M images |
|---------|-------------|---------------|-------------|
| Classification annotations (1 per image) | 1K rows, trivial | 100K rows, fast | 1M rows, may want index on (dataset_id, sample_id) |
| Confusion matrix computation | In-memory numpy, instant | In-memory numpy, <1s | In-memory numpy, ~2s (1M label comparisons) |
| Folder-of-folders ingestion (many small files) | Fast | Moderate (100K filesystem stats) | Slow -- but same as image loading |
| NULL bbox storage | None (DuckDB columnar compression) | None | None -- NULLs compress to near-zero in columnar |
| Statistics queries on mixed tables | No impact | No impact | No impact -- DuckDB predicate pushdown handles it |

Classification datasets are strictly simpler than detection: 1 annotation per image, no spatial matching, no IoU. The existing architecture handles the scale without modification.

---

## Suggested Build Order

Build order follows data flow dependencies: schema before parsers, parsers before frontend display, evaluation needs data.

| Order | What | Dependencies | Rationale |
|-------|------|--------------|-----------|
| 1 | Schema migration + API model updates | None | Foundation: must exist before anything else |
| 2 | Classification folder parser + scanner detection | Step 1 | End-to-end ingestion works |
| 3 | Frontend conditional rendering (grid + modal) | Step 2 | Users can see classification datasets |
| 4 | Classification evaluation service + frontend | Step 3 | Metrics for classification predictions |
| 5 | Classification prediction import | Step 1 | Import predictions for evaluation |
| 6 | CSV parser + additional format support | Step 1 | Secondary ingestion format, lower priority |

**Critical path:** Steps 1 -> 2 -> 3 -> 4 are sequential. Steps 5 and 6 can proceed in parallel after step 1.

**What stays unchanged (no work needed):**
- Embeddings + scatter plot (sample-level, no bbox dependency)
- Similarity search (sample-level, no bbox dependency)
- Saved views (filter state, no bbox dependency)
- Tags / triage (annotation-level, uses category_name not bbox)
- Thumbnail generation (image-level, no annotation dependency)

---

## Sources

- **Direct codebase analysis:** `duckdb_repo.py` (schema), `evaluation.py` (metrics), `coco_parser.py` + `base_parser.py` (ingestion), `folder_scanner.py` (detection), `annotation-overlay.tsx` + `grid-cell.tsx` + `sample-modal.tsx` (frontend rendering), `statistics.py` (API), `evaluation-panel.tsx` (frontend metrics display)
- **DuckDB ALTER TABLE:** Need to verify `ALTER COLUMN DROP NOT NULL` support in current version -- MEDIUM confidence on exact syntax
- **ImageNet folder-of-folders convention:** Standard classification dataset layout -- HIGH confidence
- **scikit-learn classification metrics patterns:** Standard accuracy/precision/recall/F1 computation -- HIGH confidence (though we use pure numpy, not sklearn)
