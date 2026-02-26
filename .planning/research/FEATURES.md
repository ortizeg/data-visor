# Feature Landscape: Classification Dataset Support

**Domain:** Single-label image classification dataset introspection
**Researched:** 2026-02-18
**Scope:** NEW features needed for classification support -- does NOT repeat existing detection features

---

## How Classification Differs from Detection

Understanding these differences drives every feature decision below.

| Aspect | Detection (current) | Classification (new) |
|--------|---------------------|---------------------|
| **Label granularity** | Per-annotation (many per image) | Per-image (one label per image) |
| **Spatial info** | Bounding boxes (x, y, w, h) | None -- label applies to entire image |
| **Matching logic** | IoU-based greedy matching | Direct string comparison (GT label vs predicted label) |
| **Error types** | TP, Hard FP, Label Error, FN | Correct, Misclassified (with confused pair) |
| **Key metrics** | mAP, AP@50/75, per-class AP | Accuracy, macro/micro F1, per-class precision/recall |
| **Confusion matrix** | Background row/col for unmatched | No background -- every image has exactly one GT and one prediction |
| **Display** | SVG bbox overlays on thumbnails | Text badge/label on thumbnail corner |
| **Ingestion format** | COCO JSON (images + annotations arrays) | JSONL (one JSON object per line: image, prefix, suffix) |

### Classification Matching (the "IoU equivalent")

In classification, matching is trivially simple: compare the predicted label to the ground truth label for each image. There is no spatial matching, no IoU threshold. The evaluation reduces to a standard confusion matrix.

FiftyOne's `evaluate_classifications()` supports three methods:
- **"simple"** (default): Direct GT label vs prediction label comparison. Each sample is marked correct/incorrect. This is what DataVisor needs.
- **"top-k"**: Prediction is correct if GT label appears in top-k predicted classes. Requires multi-class probability output (not applicable to DataVisor's single-prediction format).
- **"binary"**: Binary classification with configurable positive class. Missing labels treated as negative class.

For DataVisor's use case (single-label classification with one prediction per image), the "simple" method is the only one that matters.

---

## Table Stakes

Features users expect when inspecting classification datasets. Missing any of these would feel like a broken product.

### TS-1: JSONL Ingestion Parser

| Attribute | Detail |
|-----------|--------|
| **Why expected** | Classification datasets from Roboflow export as JSONL. This is the target format. |
| **Complexity** | Medium |
| **Depends on** | `BaseParser` abstract class (existing), `DuckDBRepo` schema (needs extension) |

**What to build:** A `ClassificationParser` that reads JSONL files where each line is `{"image":"filename.jpg","prefix":"prompt","suffix":"class_label"}`. The parser maps `suffix` to `category_name` and stores one annotation per image with sentinel bbox values (0,0,width,height -- full image) or a new schema approach.

**Schema decision:** The current `annotations` table requires `bbox_x/y/w/h`. Two options:
1. **Store with sentinel values** (bbox = full image dimensions). Simpler, avoids schema migration, but semantically wrong.
2. **Add `task_type` column to datasets table** and make bbox columns nullable. Cleaner, enables task-aware rendering throughout the app.

Recommendation: Option 2 -- add `task_type VARCHAR DEFAULT 'detection'` to `datasets` table. Make bbox columns `DOUBLE` (already are) and allow NULLs for classification. This is a one-line schema change and pays forward for future task types (segmentation, etc.).

**Folder scanner:** Extend `folder_scanner.py` to detect JSONL files alongside images. A JSONL file with `{"image":..., "suffix":...}` structure identifies a classification dataset. The existing split detection (`train/`, `valid/`, `test/` directories) works as-is since Roboflow classification exports use the same directory structure.

---

### TS-2: Class Label Display on Thumbnails

| Attribute | Detail |
|-----------|--------|
| **Why expected** | Every classification tool shows the class label on the thumbnail. Without it, users see unlabeled images. |
| **Complexity** | Low |
| **Depends on** | Grid cell component (existing), dataset `task_type` field (TS-1) |

**What to build:** A `ClassificationBadge` component that replaces the `AnnotationOverlay` (SVG bboxes) when `task_type === 'classification'`. Renders as a text badge in the top-left corner of the thumbnail.

**How competitors do it:**
- **Roboflow:** Classification label displayed as text in the top-left corner of the image with a semi-transparent colored background.
- **FiftyOne:** Classification fields shown as text tags in the sample's sidebar panel, not overlaid on the image in grid view. Image-level labels appear as fields, not spatial overlays.
- **Label Studio:** Text label below the image during annotation.

**Design decision:** Top-left corner badge with semi-transparent background, colored by class (using the existing `color-hash.ts`). Show GT label by default; when predictions exist, show both with GT solid and prediction as an outline/dashed badge below. This mirrors the existing convention where GT is solid stroke and predictions are dashed stroke.

**When GT and prediction differ:** Show both badges stacked, with the prediction badge having a red tint or strikethrough to indicate misclassification. When they match, show a single green-tinted badge. This gives immediate visual signal without opening the detail modal.

---

### TS-3: Classification Evaluation Metrics

| Attribute | Detail |
|-----------|--------|
| **Why expected** | Accuracy, F1, precision, recall are the universal classification metrics. Every ML practitioner expects these. |
| **Complexity** | Medium |
| **Depends on** | Evaluation service (existing, needs classification branch), prediction import (existing) |

**What to build:** A `ClassificationEvaluationService` that computes:

**Aggregate metrics:**
- **Accuracy:** correct / total
- **Macro F1:** unweighted average of per-class F1 scores (treats all classes equally)
- **Micro F1:** equivalent to accuracy for single-label classification
- **Weighted F1:** F1 weighted by class support (handles imbalance)

**Per-class metrics:**
- Precision, Recall, F1, Support (count of GT instances)

**Why these specific metrics:** For the jersey number dataset (43 classes, likely imbalanced), accuracy alone is misleading. Macro F1 exposes classes with poor performance regardless of their frequency. Weighted F1 gives the overall picture accounting for class sizes. Per-class precision/recall identifies which specific classes the model struggles with.

**Implementation:** Use `sklearn.metrics.classification_report()` and `sklearn.metrics.confusion_matrix()` rather than building from scratch. scikit-learn is already a transitive dependency (via supervision). Classification evaluation is dramatically simpler than detection evaluation -- no IoU, no confidence sweeping, no greedy matching. The entire evaluation is one confusion matrix computation.

**Response model:** New `ClassificationEvaluationResponse` alongside the existing detection `EvaluationResponse`. The router checks `task_type` and dispatches to the correct service.

---

### TS-4: Classification Confusion Matrix

| Attribute | Detail |
|-----------|--------|
| **Why expected** | The confusion matrix is THE diagnostic tool for classification. It shows which classes get confused with which. |
| **Complexity** | Low (existing confusion matrix component needs minor adaptation) |
| **Depends on** | Confusion matrix component (existing), classification evaluation (TS-3) |

**What to build:** Adapt the existing `ConfusionMatrix` component for classification.

**Key differences from detection confusion matrix:**
1. **No "background" row/column.** In classification, every image has exactly one GT label and one predicted label. There are no unmatched items.
2. **Simpler cell semantics.** Each cell (i, j) = count of images with GT class i predicted as class j. No IoU threshold.
3. **No IoU threshold slider.** The existing evaluation panel has IoU/confidence threshold controls -- these should be hidden for classification datasets.
4. **Confidence threshold still relevant.** If predictions have confidence scores, filtering by confidence can still be useful (exclude low-confidence predictions).

**The existing `ConfusionMatrix` component and `use-confusion-cell.ts` hook already support click-to-filter** (clicking a cell shows the contributing samples). This works perfectly for classification -- clicking cell (i, j) shows all images where GT=class_i and prediction=class_j. The only change is the backend query: instead of IoU-based matching, do a simple SQL join on sample_id between GT and prediction annotations.

**For 43 classes (jersey numbers):** The matrix will be 43x43. The existing component needs to handle this density well. Consider adding: (a) row/column sorting by error count, (b) a "most confused pairs" summary table showing the top-N off-diagonal cells. FiftyOne surfaces "most confused" pairs as a first-class concept and it is extremely useful.

---

### TS-5: Classification Error Analysis

| Attribute | Detail |
|-----------|--------|
| **Why expected** | Users need to know not just aggregate metrics but which specific images are wrong and why. |
| **Complexity** | Medium |
| **Depends on** | Error analysis service (existing, needs classification branch), classification evaluation (TS-3) |

**What to build:** A `ClassificationErrorAnalysis` service that categorizes each image as:

| Category | Detection Equivalent | Definition |
|----------|---------------------|------------|
| **Correct** | True Positive | GT label == predicted label |
| **Misclassified** | Label Error | GT label != predicted label (the GT/predicted pair is recorded) |
| **Missing prediction** | False Negative | Image has GT but no prediction |
| **Spurious prediction** | False Positive | Image has prediction but no GT (rare for classification) |

**No "Hard FP" category.** In detection, Hard FP means a prediction with no nearby GT box. In classification, there is no spatial component -- a wrong prediction is simply a misclassification. The error taxonomy is simpler.

**Per-class error breakdown:** For each class, show: TP count, misclassified count (broken down by which class they were confused with), missed count. This is richer than the detection per-class table because we can show the confusion target.

**"Most confused pairs" summary:** Extract the top-N off-diagonal confusion matrix cells and present as a ranked list: "Class '3' confused with '8' (N=23 times)" etc. This is the single most actionable view for classification debugging.

---

### TS-6: Classification Prediction Import

| Attribute | Detail |
|-----------|--------|
| **Why expected** | Users need to compare model predictions against ground truth. |
| **Complexity** | Low |
| **Depends on** | Prediction parser (existing), JSONL parser (TS-1) |

**What to build:** Extend the prediction import dialog to accept classification predictions. Two formats:

1. **JSONL format** (matching ingestion): `{"image":"filename.jpg","suffix":"predicted_class","confidence":0.95}`
2. **CSV format** (simpler): `filename,predicted_class,confidence`

The existing prediction import flow stores predictions as annotations with `source != 'ground_truth'`. For classification, each prediction is one annotation per image (instead of potentially many bboxes).

**Confidence handling:** Classification models often output a probability distribution over all classes. For DataVisor's single-label scope, only the top-1 prediction and its confidence are imported. Top-k support is a future enhancement (see Differentiators).

---

### TS-7: Sample Detail Modal Adaptation

| Attribute | Detail |
|-----------|--------|
| **Why expected** | Clicking an image must show useful information. The detection modal shows bboxes; the classification modal should show class info. |
| **Complexity** | Medium |
| **Depends on** | Sample modal (existing), annotation editor (existing), dataset `task_type` |

**What to build:** Conditional rendering in `sample-modal.tsx` based on `task_type`:

**For classification datasets:**
- Remove bbox overlay, editable-rect, draw-layer components
- Show GT class label prominently (large text above image)
- Show predicted class label (if exists) with confidence score
- Show correct/incorrect status with color coding (green/red)
- Show class change dropdown (for editing the GT label -- replaces bbox editing)
- Retain: similarity panel, tags, triage overlay, keyboard navigation

**The annotation editor** currently supports bbox move/resize/delete and class change. For classification, only class change is relevant. The `class-picker.tsx` component (dropdown to change category) works as-is.

---

### TS-8: Statistics Dashboard Adaptation

| Attribute | Detail |
|-----------|--------|
| **Why expected** | The overview tab shows annotation counts, class distribution, split breakdown. These need to reflect classification semantics. |
| **Complexity** | Low |
| **Depends on** | Stats dashboard (existing), statistics hooks (existing) |

**What to build:** Adapt dashboard text and metrics for classification context:

| Detection term | Classification term |
|----------------|-------------------|
| "Annotations" | "Labeled images" |
| "Annotations per image" histogram | "Class distribution" (same chart, simpler) |
| "Bounding box area" histogram | Remove (not applicable) |
| mAP/AP metrics cards | Accuracy/F1 metrics cards |
| IoU threshold slider | Remove |

The underlying data is the same (annotations table rows), but the presentation changes. The class distribution chart works identically -- it counts annotations per category, which for classification is images per class.

---

## Differentiators

Features that set DataVisor apart. Not expected, but valuable. Build these after table stakes.

### D-1: Misclassification Drill-Down View

| Attribute | Detail |
|-----------|--------|
| **Value proposition** | Click a confused pair in the confusion matrix and see side-by-side examples of "predicted 8, actually 3" with the images. No other lightweight tool does this well. |
| **Complexity** | Medium |
| **Depends on** | Confusion matrix click-to-filter (TS-4), classification error analysis (TS-5) |

**What to build:** When a user clicks a confusion matrix cell (i, j), show a dedicated panel with:
1. All images where GT=class_i and prediction=class_j
2. Thumbnails with both labels visible (badge: "GT: 3 / Pred: 8")
3. Sort by confidence (most confident mistakes first -- these are the most concerning)
4. One-click ability to correct the GT label if it is actually wrong (label error)

This extends the existing click-to-filter behavior to be richer for classification. FiftyOne shows the filtered sample list, but DataVisor can show a purpose-built comparison view.

---

### D-2: Class-Level Performance Sparklines

| Attribute | Detail |
|-----------|--------|
| **Value proposition** | At-a-glance view of which classes perform well and which are disasters, without reading a table of numbers. |
| **Complexity** | Low |
| **Depends on** | Per-class metrics (TS-3), Recharts (existing) |

**What to build:** In the per-class metrics table, add inline sparkline-style bars for precision, recall, and F1. Color-code: green (>0.9), yellow (0.7-0.9), red (<0.7). Sort by worst-performing class by default to surface problems immediately.

---

### D-3: Top-K Confidence Distribution

| Attribute | Detail |
|-----------|--------|
| **Value proposition** | Shows where the model is uncertain vs confident, separated by correct/incorrect predictions. Reveals overconfident mistakes. |
| **Complexity** | Medium |
| **Depends on** | Classification predictions with confidence (TS-6), Recharts (existing) |

**What to build:** Two overlaid histograms:
1. Confidence distribution of **correct** predictions (expect: skewed right, high confidence)
2. Confidence distribution of **incorrect** predictions (expect: more spread out)

If the incorrect predictions have high confidence, the model is dangerously overconfident. If they cluster at low confidence, a simple threshold can filter them.

Also: **confidence calibration plot** (reliability diagram) showing predicted confidence vs actual accuracy. Most models are poorly calibrated, and this visualization makes it obvious.

---

### D-4: Per-Split Evaluation Comparison

| Attribute | Detail |
|-----------|--------|
| **Value proposition** | Compare model performance across train/val/test splits. Large gap between train and val accuracy immediately reveals overfitting. |
| **Complexity** | Low |
| **Depends on** | Split handling (existing), classification evaluation (TS-3) |

**What to build:** A comparison table/chart showing accuracy, macro F1, and per-class F1 side-by-side for each split. Highlight cells where test performance is significantly worse than train (>5% drop). This is trivial to compute (run classification evaluation per split) but extremely informative.

---

### D-5: Embedding Scatter with Classification Coloring

| Attribute | Detail |
|-----------|--------|
| **Value proposition** | The existing t-SNE scatter plot colored by class label instantly shows cluster quality. Misclassifications visible as dots in the wrong cluster. |
| **Complexity** | Low |
| **Depends on** | Embedding scatter (existing), classification labels |

**What to build:** The existing embedding scatter already supports coloring by class. For classification datasets, default to coloring by GT class label. Add a toggle to color by:
1. **GT class** (default) -- shows natural cluster structure
2. **Predicted class** -- shows model's view of the data
3. **Correct/incorrect** -- highlights all misclassifications as red dots

Option 3 is the killer feature: overlay misclassification status on the embedding plot. Misclassified samples that are near the decision boundary (cluster edge) are expected. Misclassified samples deep inside a correct cluster suggest label errors.

---

## Anti-Features

Features to explicitly NOT build for this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Multi-label classification** | Different data model (multiple labels per image), different metrics (hamming loss, subset accuracy), different UI (checkbox lists instead of single badge). Scope explosion. | Scope to single-label only. Add multi-label in a future milestone if needed. |
| **Top-K evaluation** | Requires importing full probability distributions (N probabilities per image per class). Complicates prediction import schema significantly. | Import only top-1 prediction with confidence. Note: the confidence score captures some of this info already. |
| **PR curves for classification** | PR curves are less informative for multi-class classification than for detection. The confusion matrix and per-class precision/recall table are better tools. Confidence-based filtering (existing) handles the threshold sweep use case. | Show per-class precision/recall in a table. Use the confidence histogram (D-3) for threshold analysis. |
| **mAP for classification** | mAP is a detection metric (requires IoU). Accuracy and macro F1 are the standard classification metrics. Showing mAP would confuse users. | Show accuracy, macro F1, weighted F1. |
| **Bbox editing for classification** | No bounding boxes. The editable-rect, draw-layer components are irrelevant. | Show class label editor (dropdown) instead. |
| **IoU threshold controls** | No spatial matching, no IoU. Showing an IoU slider would confuse users. | Hide IoU controls when `task_type === 'classification'`. |
| **Detection-specific error categories** | "Hard FP" (no nearby GT box) has no meaning in classification. "Label Error" (correct box, wrong class) conflates with misclassification. | Use simpler categories: Correct, Misclassified, Missing Prediction. |

---

## Feature Dependencies

```
[TS-1: JSONL Parser + Schema]
    |
    +---> [TS-2: Class Label Badge]
    |         |
    |         +---> [D-5: Embedding Coloring] (uses class labels)
    |
    +---> [TS-6: Prediction Import]
    |         |
    |         +---> [TS-3: Classification Eval Metrics]
    |         |         |
    |         |         +---> [TS-4: Confusion Matrix Adaptation]
    |         |         |         |
    |         |         |         +---> [D-1: Misclassification Drill-Down]
    |         |         |
    |         |         +---> [TS-5: Error Analysis]
    |         |         |         |
    |         |         |         +---> [D-3: Confidence Distribution]
    |         |         |
    |         |         +---> [D-2: Per-Class Sparklines]
    |         |         |
    |         |         +---> [D-4: Per-Split Comparison]
    |         |
    +---> [TS-7: Detail Modal Adaptation]
    |
    +---> [TS-8: Stats Dashboard Adaptation]
```

**Critical path:** TS-1 (parser/schema) unblocks everything. TS-6 (prediction import) unblocks all evaluation features. TS-3 (metrics) unblocks all downstream analysis.

**Parallelizable:** TS-2 (badge display), TS-7 (detail modal), and TS-8 (stats dashboard) can be built in parallel once TS-1 is complete. They all depend on having classification data in the database but not on each other.

---

## MVP Recommendation

**Phase 1 (Core Ingestion + Display):**
1. TS-1: JSONL ingestion parser + schema extension
2. TS-2: Class label badge on thumbnails
3. TS-7: Sample detail modal adaptation
4. TS-8: Statistics dashboard adaptation

This gets a classification dataset loaded, browsable, and visually meaningful. Users can explore the dataset, see class distribution, filter by class, use the embedding scatter.

**Phase 2 (Evaluation + Error Analysis):**
5. TS-6: Classification prediction import
6. TS-3: Classification evaluation metrics
7. TS-4: Confusion matrix adaptation
8. TS-5: Classification error analysis

This enables the full GT-vs-predictions workflow: import predictions, see accuracy/F1, explore the confusion matrix, identify misclassified samples.

**Phase 3 (Differentiators):**
9. D-5: Embedding coloring by correct/incorrect (low effort, high impact)
10. D-1: Misclassification drill-down view
11. D-2: Per-class sparklines
12. D-3: Confidence distribution histogram
13. D-4: Per-split comparison

**Defer:** Multi-label classification, top-k evaluation, PR curves, mAP.

---

## Existing Features That Work As-Is for Classification

These features require NO changes:

| Feature | Why It Works |
|---------|-------------|
| **Image grid browser** | Renders thumbnails. Classification just needs a different overlay (badge instead of bbox). |
| **t-SNE embedding scatter** | DINOv2 embeddings are computed from images, not annotations. Works identically. |
| **Lasso filtering** | Selects by sample ID. Task-agnostic. |
| **Find similar** | Qdrant similarity search uses image embeddings. Task-agnostic. |
| **Near-duplicates** | Embedding distance. Task-agnostic. |
| **Saved views** | Filter state persistence. Task-agnostic. |
| **Tags / triage workflow** | Sample-level operations. Task-agnostic. |
| **Keyboard shortcuts** | Sample navigation. Task-agnostic. |
| **Split filtering** | Filters by split field. Task-agnostic. |
| **Search by filename** | Text search. Task-agnostic. |
| **VLM auto-tagging** | Uses image content, not annotations. Task-agnostic. |
| **AI agent analysis** | Operates on statistics and error data. Needs updated prompts for classification context but architecture is the same. |

---

## Sources

### FiftyOne (HIGH confidence -- official documentation)
- [FiftyOne Classification Evaluation API](https://docs.voxel51.com/api/fiftyone.utils.eval.classification.html)
- [FiftyOne Evaluating Models](https://docs.voxel51.com/user_guide/evaluation.html)
- [FiftyOne Evaluate Classifications Tutorial](https://docs.voxel51.com/tutorials/evaluate_classifications.html)
- [FiftyOne Drawing Labels](https://docs.voxel51.com/user_guide/draw_labels.html)

### Cleanlab (HIGH confidence -- official documentation)
- [Cleanlab Image Classification Tutorial](https://docs.cleanlab.ai/master/tutorials/image.html)
- [Cleanlab Datalab Image Issues](https://docs.cleanlab.ai/master/tutorials/datalab/image.html)
- [Cleanlab GitHub](https://github.com/cleanlab/cleanlab)

### Roboflow (MEDIUM confidence -- product documentation)
- [Roboflow Classification Label Visualization](https://docs.roboflow.com/workflow-blocks/visualize-predictions/classification-label-visualization)

### Classification Metrics (HIGH confidence -- authoritative references)
- [Google ML Classification Metrics](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall)
- [Evidently AI Multi-class Metrics](https://www.evidentlyai.com/classification-metrics/multi-class-metrics)
- [scikit-learn confusion_matrix](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.confusion_matrix.html)

### Label Studio (MEDIUM confidence -- official documentation)
- [Label Studio Image Classification Template](https://labelstud.io/templates/image_classification)

---
*Classification feature landscape for: DataVisor classification support milestone*
*Researched: 2026-02-18*
