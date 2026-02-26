# Domain Pitfalls

**Domain:** Adding single-label classification support to an existing detection-focused CV dataset tool
**Researched:** 2026-02-18
**Confidence:** HIGH (all findings grounded in actual codebase analysis)

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or broken existing workflows.

### Pitfall 1: Schema Pollution -- Nullable BBox Columns Infect Every Query

**What goes wrong:** The `annotations` table has `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h` as `DOUBLE NOT NULL`. Classification annotations have no bounding boxes. The naive fix is making these columns nullable or stuffing sentinel values (0,0,0,0), but then every existing query that touches bbox columns -- `_load_detections()`, `_compute_iou_matrix()`, `AnnotationOverlay`, `EditableRect`, area calculations, `AnnotationUpdate` -- must guard against null/sentinel bboxes. Miss one query and you get silent wrong results or crashes.

**Why it happens:** The annotations table was designed as a detection-first schema. Every column assumes spatial data exists. The `area` column is computed as `bbox_w * bbox_h`. The `AnnotationCreate` model requires all four bbox fields. The `AnnotationUpdate` model only has bbox fields -- it literally cannot update a classification annotation.

**Concrete code locations affected:**
- `duckdb_repo.py:57-72` -- annotations table DDL with `NOT NULL` bbox columns
- `app/models/annotation.py:6-57` -- all three Pydantic models hardcode bbox fields
- `app/routers/annotations.py:42` -- `area = body.bbox_w * body.bbox_h`
- `app/services/evaluation.py:225` -- `_BoxRow` type alias includes bbox coordinates
- `frontend/src/types/annotation.ts:6-19` -- `Annotation` interface requires bbox fields
- `frontend/src/components/grid/annotation-overlay.tsx:63-72` -- renders `<rect>` from bbox

**Consequences:**
- Classification annotations with NULL bboxes break `NOT NULL` constraints on insert
- Sentinel values (0,0,0,0) produce 0-area rectangles in SVG overlays, 0-area in stats
- Every SQL query selecting `bbox_*` columns returns meaningless data for classification
- IoU computation on zero-sized boxes produces NaN or 0, silently breaking evaluation

**Prevention:** Add a `task_type` discriminator column to the `datasets` table (not annotations). Classification datasets never create bbox data. Use a separate code path for classification annotations that maps to a simpler schema view. Specifically:
1. Add `task_type VARCHAR DEFAULT 'detection'` to `datasets` table
2. For classification, annotations table still has bbox columns but they store 0.0 (not NULL) to preserve NOT NULL constraint, and a `task_type`-aware query layer skips them
3. Better: create a `classifications` table with just `(id, dataset_id, sample_id, category_name, source, confidence, metadata)` -- one row per image, no bbox columns at all. This is cleaner but requires more code changes.

**Recommendation:** Separate `classifications` table. The bbox columns are not "optional detection data" -- they are structurally meaningless for classification. Trying to reuse the annotations table forces every consumer to handle two shapes of data from one table. A separate table with shared query interfaces (via a service abstraction) is cleaner.

**Detection:** If you go the shared-table route, grep for `bbox_` across the codebase -- every hit is a location that needs a conditional. Currently 30+ references.

**Phase to address:** Phase 1 (schema design). Get this wrong and everything downstream is a rewrite.

---

### Pitfall 2: Metric Confusion -- mAP/IoU Leaking into Classification Evaluation

**What goes wrong:** The entire evaluation pipeline is built on IoU matching. `compute_evaluation()` uses `supervision.MeanAveragePrecision` and `supervision.ConfusionMatrix.from_detections()` which expect `sv.Detections` objects with `xyxy` bounding boxes. Classification evaluation needs accuracy, precision, recall, F1, and per-class metrics computed by exact label matching (no spatial component). If you try to reuse the detection evaluation with dummy bboxes, you get meaningless mAP scores.

**Why it happens:** The evaluation service (`app/services/evaluation.py`) is 560 lines of detection-specific logic: IoU matrix computation, greedy matching, COCO-style interpolated AP. The API response model (`EvaluationResponse`) returns `map50`, `map75`, `map50_95`, `iou_threshold` -- all detection-specific fields. The frontend `evaluation-panel.tsx` renders PR curves and the confusion matrix with IoU/confidence sliders.

**Concrete code locations affected:**
- `app/services/evaluation.py` -- entire file assumes detection
- `app/services/error_analysis.py` -- `categorize_errors()` uses IoU matching
- `app/services/annotation_matching.py` -- `match_sample_annotations()` is IoU-based
- `app/models/evaluation.py` -- `APMetrics` has mAP fields, `EvaluationResponse` has `iou_threshold`
- `frontend/src/types/evaluation.ts` -- TypeScript mirrors backend detection-specific types
- `frontend/src/components/stats/evaluation-panel.tsx` -- IoU slider, PR curves
- `frontend/src/components/stats/metrics-cards.tsx` -- likely shows mAP

**Consequences:**
- Showing mAP for a classification dataset is nonsensical and misleading
- IoU slider has no meaning -- users will be confused
- PR curves per class are meaningful for classification but computed differently (no spatial matching)
- Error analysis categories (Hard FP, Label Error based on IoU) do not apply

**Prevention:** Build a separate `compute_classification_evaluation()` function and a `ClassificationEvaluationResponse` model. Route based on `dataset.task_type`. Classification evaluation is actually simpler: compare `gt_category` to `pred_category` per sample. Metrics: accuracy, macro/micro precision/recall/F1, per-class precision/recall/F1, confusion matrix (still works, but simpler -- no "background" row/column from unmatched detections).

**Detection:** If the evaluation endpoint returns `iou_threshold` for a classification dataset, something went wrong.

**Phase to address:** Phase 2 (evaluation logic). Must come after schema but before UI work.

---

### Pitfall 3: UI Conditional Spaghetti -- `if detection else classification` Everywhere

**What goes wrong:** Instead of polymorphic components, developers scatter `if (taskType === 'detection')` checks throughout the frontend. Components like `AnnotationOverlay`, `SampleModal`, `EvaluationPanel`, `ErrorAnalysisPanel`, `TriageOverlay`, `FilterSidebar`, `StatsDashboard` all need different rendering for classification vs detection. With 10+ components each having 2-3 conditionals, you get 30+ branching points that are easy to miss and hard to test.

**Why it happens:** The fastest way to add classification support is to add conditionals to existing components. Each one is small and "just one more if-statement." But they compound:
- `AnnotationOverlay`: render bbox rect vs class label badge
- `SampleModal`: bbox editor vs class label display
- `EvaluationPanel`: IoU slider vs no IoU slider
- `MetricsCards`: mAP vs accuracy
- `ErrorAnalysisPanel`: spatial error types vs correct/incorrect
- `PerClassTable`: AP columns vs precision/recall/F1 columns
- `ConfusionMatrix`: background row vs no background row
- `AnnotationList`: bbox coordinates vs class label
- `DrawLayer`: bbox drawing vs class assignment
- `TriageOverlay`: per-bbox triage vs per-image triage

**Consequences:**
- Adding a third task type (segmentation, keypoint) requires touching every component again
- Testing combinatorial explosion: each component x each task type
- Easy to miss one conditional, producing a detection UI for classification data
- Code reviews become "did you check all 30 places?"

**Prevention:** Use a strategy/adapter pattern at the component boundary. Create a `TaskAdapter` that provides task-specific sub-components:
```typescript
// Instead of 30 if-statements:
const adapter = useTaskAdapter(dataset.task_type);
// adapter.AnnotationOverlay -- renders bboxes or class badges
// adapter.EvaluationPanel -- detection or classification metrics
// adapter.getMetricLabel() -- "mAP@50" or "Accuracy"
```
Alternatively, create parallel component trees: `detection/EvaluationPanel` and `classification/EvaluationPanel` with shared layout components. The dataset page picks the right tree once.

**Detection:** Count `if.*detection` or `if.*classification` or `taskType` in the frontend. If > 10, you have spaghetti.

**Phase to address:** Phase 3 (UI). Design the abstraction before writing any UI code.

---

### Pitfall 4: Breaking Existing Detection Workflows via Shared Schema Migration

**What goes wrong:** A schema migration that alters the `annotations` table (making bbox columns nullable, adding columns, changing types) breaks existing detection datasets. DuckDB does not support transactional DDL in the same way PostgreSQL does. If the migration fails midway, you can end up with a partially altered schema.

**Why it happens:** The temptation to "just" ALTER TABLE is strong. The current schema uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for backward-compatible additions (see `duckdb_repo.py:84-103`). But making `bbox_x DOUBLE NOT NULL` into `bbox_x DOUBLE` (nullable) is a destructive change that affects all existing data.

**Concrete risk:** DuckDB's `ALTER TABLE ... ALTER COLUMN` support is limited. Changing NOT NULL to nullable may require recreating the table. If classification data gets inserted into the same table with sentinel bbox values, existing queries that do `WHERE bbox_w > 0` or area-based filtering will include/exclude rows incorrectly.

**Consequences:**
- Existing detection datasets produce different query results after migration
- Users who re-open DataVisor after update find their detection workflows broken
- Area-based filters (if any exist in saved views) return wrong results
- No rollback path if migration corrupts data

**Prevention:**
1. Never modify existing column constraints -- add new tables/columns only
2. Separate `classifications` table means zero changes to existing `annotations` table
3. If you must use the shared table, add a `task_type` column (default 'detection') and filter by it -- never change existing column nullability
4. Run migration on a copy of the database first as a smoke test
5. Bump a schema version in the `datasets.metadata` JSON so old clients can warn

**Detection:** After migration, run `SELECT COUNT(*) FROM annotations WHERE bbox_x IS NULL` -- should be 0 for detection datasets.

**Phase to address:** Phase 1 (schema). Must be designed correctly before any data enters the system.

---

### Pitfall 5: Confusion Matrix Scaling with 43+ Classes

**What goes wrong:** The current confusion matrix renders as an HTML table with `min-w-[32px]` per cell. With 10 classes + background = 11x11 = 121 cells, this is manageable. With 43 jersey numbers + background = 44x44 = 1,936 cells, the matrix becomes an unreadable 1,408px-wide table (44 * 32px) with tiny rotated labels that overlap.

**Why it happens:** The `ConfusionMatrix` component was designed for ~10 classes. It uses:
- Rotated column headers with `maxHeight: 80` -- with 43 labels, they crowd
- `min-w-[32px]` cells -- fine at 10, but 44 * 32 = 1,408px minimum width
- Row-normalized values displayed as `norm.toFixed(2)` -- most cells will be "0.00" noise
- Click handler for each cell -- 1,936 click targets, most empty

**Concrete code:** `frontend/src/components/stats/confusion-matrix.tsx:26-138`

**Consequences:**
- Matrix is wider than any screen, requires horizontal scrolling
- Labels overlap and become unreadable
- Most cells are zero/near-zero, making the meaningful cells hard to find
- Performance degrades with 1,936 DOM nodes with event handlers
- Row-normalization spreads probability mass so thin that all off-diagonal cells look identical

**Prevention:**
1. Add a "top-K confused classes" view that only shows the K most confused pairs (e.g., top 20)
2. Support class grouping/collapsing for hierarchical class sets
3. Use a heatmap canvas renderer instead of HTML table for large matrices (SVG or `<canvas>`)
4. Add a threshold filter: hide cells below a count threshold
5. For 43+ classes, default to a "top confusions" bar chart instead of the full matrix
6. Make the full matrix available as a downloadable CSV for detailed analysis

**Detection:** If `confusion_matrix_labels.length > 20`, switch to the compact view automatically.

**Phase to address:** Phase 3 (UI). Can be done in parallel with evaluation logic since the component just needs to handle the existing data shape differently.

---

## Moderate Pitfalls

### Pitfall 6: Format Detection False Positives -- JSONL/CSV/Folder Misidentified or Rejected

**What goes wrong:** The `FolderScanner._is_coco_annotation()` checks if a JSON file has an `"images"` top-level key. A classification dataset's JSONL file (one JSON object per line) will fail this check because JSONL is not valid JSON -- it is newline-delimited. The scanner will report "Found JSON but not valid COCO" for `.jsonl` files, and `_BROWSE_EXTENSIONS` only shows `.json` files in the browser. Additionally, classification datasets commonly use folder-based structure (class_name/image.jpg) which has no annotation file at all -- the scanner finds zero JSON files and returns no splits.

**Why it happens:** The scanner was built exclusively for COCO format. It looks for `.json` files and validates their structure. Classification datasets commonly use:
- JSONL: `{"image": "path.jpg", "label": "cat"}` per line
- CSV: `image_path,label` columns
- Folder structure: `class_name/image.jpg` (ImageNet-style)
- JSON mapping: `{"images": {"path.jpg": "cat", ...}}`

**Concrete code:**
- `app/services/folder_scanner.py:467-488` -- `_is_coco_annotation()` only recognizes COCO structure
- `app/routers/ingestion.py:111` -- `_BROWSE_EXTENSIONS = {".json"}` excludes `.jsonl`, `.csv`
- `app/models/dataset.py:15` -- `format: str = "coco"` defaults to COCO
- `app/services/folder_scanner.py:126` -- `ScanResult` hardcodes `format="coco"`

**Prevention:**
1. Add format-specific scanner methods: `_is_classification_jsonl()`, `_is_classification_csv()`, `_is_classification_folder()`
2. Expand `_BROWSE_EXTENSIONS` to include `.jsonl`, `.csv`
3. Add a `format` field to `DetectedSplit` that can be `"coco"`, `"classification_jsonl"`, `"classification_folder"`, etc.
4. The scanner should return the detected format, not assume COCO
5. For folder-based classification, detect by checking if immediate subdirectories contain images and no annotation files exist

**Detection:** Try scanning a folder with a `.jsonl` classification file or an ImageNet-style folder -- if it returns 0 splits with a warning, the scanner needs updating.

**Phase to address:** Phase 1 (ingestion). Must detect the format before importing.

---

### Pitfall 7: Annotation Triage Assumes Spatial Matching -- Meaningless for Classification

**What goes wrong:** The entire annotation triage system (`annotation_matching.py`, `annotation_triage.py`, `triage-overlay.tsx`) is built around per-bbox IoU matching. For classification, there is one "annotation" per image (the class label). The triage categories (TP, FP, FN, Label Error) based on spatial overlap make no sense. A classification prediction is simply "correct" or "incorrect" -- there is no spatial localization to evaluate.

**Why it happens:** The triage system was Phase 14, deep into the detection workflow. It assumes:
- Multiple annotations per image (detection has many boxes per image)
- IoU-based matching to pair predictions with GT
- Per-annotation granularity (each box can be independently triaged)

For classification:
- One annotation per image (the class label)
- Matching is by sample_id only (no spatial component)
- Triage is per-image, not per-annotation

**Concrete code:**
- `app/services/annotation_matching.py:18-135` -- 100% IoU-based
- `app/routers/annotation_triage.py:46` -- calls `match_sample_annotations()` which does IoU
- `frontend/src/components/detail/triage-overlay.tsx` -- renders per-bbox triage badges

**Prevention:**
1. Classification triage is trivially computed: `gt_label == pred_label ? "correct" : "incorrect"`
2. No need for IoU matching, confidence-ordered greedy assignment, or matched_id tracking
3. Create a `match_classification_annotations()` that returns per-sample correct/incorrect
4. The triage overlay for classification should show the predicted label and whether it matches GT, not per-bbox badges

**Detection:** If the triage endpoint is called with `iou_threshold` for a classification dataset, the routing is wrong.

**Phase to address:** Phase 2 (evaluation/triage). Simpler than detection triage -- should be quick to implement.

---

### Pitfall 8: Error Analysis Categories Don't Map to Classification

**What goes wrong:** The error analysis service (`error_analysis.py`) categorizes detections as: True Positive, Hard False Positive, Label Error, False Negative. These categories are detection-specific:
- "Hard FP" means a prediction box that does not overlap any GT box -- no spatial equivalent in classification
- "Label Error" means a prediction box that overlaps a GT box of a different class -- in classification, this is just "incorrect prediction"
- "False Negative" means a GT box with no matching prediction -- in classification, this means no prediction was made for an image

**Concrete code:** `app/services/error_analysis.py:30-208` and `app/models/error_analysis.py`

**Prevention:** Classification error analysis categories should be:
- **Correct**: predicted class matches GT class
- **Misclassified**: predicted class differs from GT class (with the confused pair noted)
- **No prediction**: GT exists but no prediction (if applicable)
- **Confident wrong**: high-confidence incorrect predictions (most actionable for model improvement)

Create a `categorize_classification_errors()` function that returns these categories.

**Phase to address:** Phase 2 (evaluation).

---

### Pitfall 9: One-Annotation-Per-Image Assumption vs Multi-Label

**What goes wrong:** Single-label classification means exactly one class per image. But the schema and ingestion pipeline need to enforce this. If someone imports a classification dataset where some images have two labels (multi-label), the system should either reject it or handle it explicitly. Silently accepting multi-label data into a single-label workflow produces wrong accuracy numbers (which label counts as "correct"?).

**Why it happens:** The annotations table has no constraint preventing multiple annotations per sample. For detection, that is correct -- one image has many boxes. For single-label classification, it is a data integrity violation. Without enforcement, a malformed CSV with duplicate rows silently corrupts the dataset.

**Prevention:**
1. During ingestion, validate that each sample_id has exactly one annotation (per source)
2. If duplicates found, warn the user and either take the first or reject
3. Add `task_type` validation: classification datasets must have max 1 annotation per sample per source
4. Consider a `multi_label` flag on the dataset for future extensibility, but enforce `single_label` for this milestone

**Phase to address:** Phase 1 (ingestion validation).

---

### Pitfall 10: API Response Models Leaking Detection Fields to Classification Clients

**What goes wrong:** The `AnnotationResponse` model returns `bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`, `area`, `is_crowd` for every annotation. For classification, these fields are meaningless (0.0 or sentinel values). The `EvaluationResponse` returns `iou_threshold`, `map50`, `map75`, `map50_95` which have no meaning for classification. Frontend code consuming these fields wastes bandwidth and creates confusion. The `BatchAnnotationsResponse` groups by `sample_id` and returns lists -- for classification, each list has exactly one item, which is a different UX pattern than detection's variable-length lists.

**Why it happens:** Pydantic models were designed for detection. Adding classification means the same endpoint returns structurally different data depending on dataset type.

**Prevention:**
1. Create a `ClassificationAnnotationResponse` with just `id`, `dataset_id`, `sample_id`, `category_name`, `source`, `confidence`
2. Create a `ClassificationEvaluationResponse` with `accuracy`, `precision`, `recall`, `f1`, `per_class_metrics`, `confusion_matrix` (no mAP, no IoU threshold)
3. Or: use a discriminated union response that includes bbox/mAP fields only for detection
4. The API should return the task-appropriate response model based on dataset type
5. Frontend types should reflect this: `DetectionAnnotation | ClassificationAnnotation`

**Phase to address:** Phase 1 (API design). Affects both backend and frontend types.

---

## Minor Pitfalls

### Pitfall 11: Class Imbalance Statistics Need Different Visualization for 43+ Classes

**What goes wrong:** The class distribution chart shows annotation count per class. For detection, classes are relatively balanced (~10 classes). For classification with 43 jersey numbers, you get a bar chart with 43 bars where some numbers appear 1000x and others appear 3x. The chart becomes unreadable and the bars for rare classes are invisible.

**Prevention:** For high-cardinality classification, add:
- A sortable table view (already partially exists via `class-distribution.tsx`)
- A "long tail" indicator showing how many classes have < N samples
- A log-scale option for the bar chart
- Top-K / Bottom-K filtering

**Phase to address:** Phase 3 (UI polish).

---

### Pitfall 12: Embedding/Similarity Features Work Unchanged -- Don't Over-Adapt

**What goes wrong:** The embeddings pipeline (`embeddings.py`, `embedding-scatter.tsx`) is image-level, not annotation-level. Developers may waste time trying to "adapt" the embedding scatter for classification when it already works correctly. The scatter plot colored by class label is actually more meaningful for classification than detection.

**Prevention:** Leave the embedding pipeline alone. It already operates at the image level. The only change needed is coloring scatter points by the classification label instead of (or in addition to) detection class names. This is a minor frontend change, not a pipeline change.

**Phase to address:** Phase 3 (UI). Minimal effort.

---

### Pitfall 13: The "Second System Effect" -- Over-Generalizing the Architecture

**What goes wrong:** After seeing the pattern of "detection vs classification," developers try to build a fully generic task-agnostic framework that handles detection, classification, segmentation, keypoint detection, and object tracking. This leads to:
- Abstract base classes with 20 methods each
- A plugin system for task types
- Configuration-driven UI rendering
- Generic evaluation frameworks

All of this for what should be: add classification support as a second, simpler task type.

**Why it happens:** The existing codebase already has a `plugins/` directory with `base_plugin.py`, `hooks.py`, and `registry.py`. The temptation to make task types a plugin is strong. But classification is fundamentally simpler than detection, not a peer abstraction.

**Prevention:**
1. Support exactly two task types: detection and classification
2. Use simple if/else at routing boundaries, not inheritance hierarchies
3. Classification-specific code should be straightforward functions, not subclasses
4. Resist adding segmentation support "while we're at it"
5. The plugin system should stay for its current purpose, not be repurposed for task types

**Detection:** If you find yourself writing `class TaskType(ABC)` with 10+ abstract methods, stop.

**Phase to address:** Phase 0 (design). Set explicit scope boundaries before coding.

---

### Pitfall 14: Prediction Import Format Mismatch

**What goes wrong:** The `DetectionAnnotationParser` expects per-image JSON files with bbox annotations. Classification predictions are typically a single file: CSV, JSONL, or JSON mapping `image -> predicted_class`. Using the detection prediction parser for classification predictions will fail silently (no bboxes found, all predictions skipped).

**Concrete code:** `app/ingestion/detection_annotation_parser.py` looks for `ann.get("bbox", {})` in each annotation -- classification predictions have no bboxes.

**Prevention:** Create a `ClassificationPredictionParser` that accepts:
- CSV: `image_filename,predicted_class,confidence`
- JSONL: `{"filename": "img.jpg", "class": "cat", "confidence": 0.95}`
- JSON mapping: `{"img.jpg": {"class": "cat", "confidence": 0.95}}`

**Phase to address:** Phase 1 (ingestion).

---

### Pitfall 15: Statistics Summary Counts Diverge Between Detection and Classification

**What goes wrong:** The `get_dataset_statistics()` endpoint in `statistics.py` computes `gt_annotations` and `pred_annotations` by counting rows in the `annotations` table. For detection, annotation count != image count (many boxes per image). For classification, annotation count == image count (one label per image). If both task types share the same endpoint without context, the "500 annotations" label is confusing for classification -- users expect "500 images classified" or "500 labels."

**Prevention:**
1. For classification, relabel "annotations" as "labels" in the summary
2. Add `images_with_labels` and `images_without_labels` to classification statistics
3. Add class balance metrics: min/max/median samples per class, number of classes with < 5 samples
4. These changes are frontend-only if the backend returns raw counts

**Phase to address:** Phase 3 (UI).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Schema design | P1 (schema pollution), P4 (breaking existing) | Separate `classifications` table, never alter existing columns |
| Ingestion | P6 (format detection), P9 (multi-label), P14 (prediction format) | New format scanners, validation, separate parsers |
| Evaluation | P2 (metric confusion), P7 (triage), P8 (error categories) | Separate evaluation function, classification-specific triage |
| UI | P3 (conditional spaghetti), P5 (confusion matrix scaling), P11 (class imbalance viz) | Task adapter pattern, compact matrix view, log-scale charts |
| Architecture | P13 (over-generalization) | Two task types only, simple branching, no abstract hierarchies |
| API | P10 (response model leakage) | Task-specific response models or discriminated unions |

## Summary: Top 3 Rules of Thumb

1. **Separate table, not shared table.** Classification and detection annotations are structurally different. A `classifications` table is less code than 30+ null-checks in a shared table.

2. **Branch at the boundary, not in the leaf.** Route to detection-specific or classification-specific code at the API endpoint or page level, not inside individual components/queries.

3. **Classification is simpler -- keep it that way.** No IoU, no spatial matching, no bbox rendering. The evaluation function should be ~50 lines, not adapted from 560 lines of detection code.

## Sources

- Direct codebase analysis of all referenced files in the DataVisor repository
- DuckDB ALTER TABLE documentation: limited support for changing NOT NULL constraints (MEDIUM confidence, from training data)
- General software engineering: Strategy pattern for task-type polymorphism (HIGH confidence, well-established pattern)
