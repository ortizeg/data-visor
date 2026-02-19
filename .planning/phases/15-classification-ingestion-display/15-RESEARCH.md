# Phase 15: Classification Ingestion & Display - Research

**Researched:** 2026-02-18
**Domain:** Classification dataset ingestion, schema extension, frontend display adaptation
**Confidence:** HIGH (this is internal codebase extension, not new technology)

## Summary

Phase 15 adds classification dataset support to a codebase currently built exclusively for object detection. The work spans four layers: (1) a new JSONL annotation parser and format auto-detection in the ingestion pipeline, (2) schema changes to track dataset type and store classification annotations using sentinel bbox values, (3) frontend grid/modal display changes to show class labels instead of bounding boxes, and (4) statistics dashboard adaptation to hide detection-only metrics.

The codebase is well-structured with clear separation of concerns -- parsers in `app/ingestion/`, Pydantic models in `app/models/`, services in `app/services/`, and component-per-feature in `frontend/src/components/`. The existing `BaseParser` ABC and streaming batch pattern provide a natural extension point for a classification JSONL parser. The sentinel bbox approach (bbox values = 0.0) means the annotations table schema is untouched, avoiding null guards in 30+ SQL queries and frontend components.

**Primary recommendation:** Extend the existing parser registry pattern with a `ClassificationJSONLParser` that produces annotation rows with sentinel bbox values (0.0), add `dataset_type VARCHAR DEFAULT 'detection'` to the datasets table, and use the `datasetType` prop threaded from the page level to branch rendering at component boundaries (grid cell, sample modal, stats dashboard).

## Standard Stack

### Core (already in use -- no new dependencies)

| Library | Purpose | Status |
|---------|---------|--------|
| DuckDB | Schema storage, SQL queries | In use |
| FastAPI | API layer | In use |
| Pydantic | Request/response models | In use |
| ijson | Streaming JSON parsing | In use (COCO parser) |
| pandas | DataFrame batch construction | In use |
| Next.js + React | Frontend framework | In use |
| Zustand | State management | In use |
| TanStack Query | Data fetching/caching | In use |
| Recharts | Charts (class distribution) | In use |

### Supporting (no new libraries needed)

This phase requires zero new dependencies. Classification JSONL files are simple enough to parse with Python's built-in `json` module line-by-line, or with the existing `ijson` dependency if streaming is desired. The frontend changes are pure React component branching.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sentinel bbox (0.0) | Nullable bbox columns | Nullable requires 30+ null guards in SQL queries, filter builder, evaluation, frontend annotation types. Sentinel avoids this entirely. |
| Separate classification_annotations table | Shared annotations table with sentinels | Separate table would require duplicating all annotation queries, filter logic, statistics queries. Shared table is simpler. |
| Dynamic format detection at query time | Stored `dataset_type` column | Stored column is a single lookup; dynamic detection requires scanning annotations for non-zero bboxes every time. |

## Architecture Patterns

### Recommended Change Map

```
Backend:
  app/ingestion/
    classification_jsonl_parser.py  # NEW: ClassificationJSONLParser
  app/services/
    folder_scanner.py               # MODIFY: detect JSONL + images layout
    ingestion.py                    # MODIFY: dispatch to parser by format
    evaluation.py                   # LEAVE (classification eval is Phase 16+)
  app/repositories/
    duckdb_repo.py                  # MODIFY: add dataset_type column
  app/models/
    dataset.py                      # MODIFY: add dataset_type field
    scan.py                         # MODIFY: format can be "classification_jsonl"
    annotation.py                   # NO CHANGE (sentinel bbox values fit existing schema)
    statistics.py                   # POSSIBLY MODIFY: add labeled_images_count
  app/routers/
    ingestion.py                    # MODIFY: error message wording
    statistics.py                   # MODIFY: classification-aware summary stats

Frontend:
  types/dataset.ts                  # MODIFY: add dataset_type field
  types/scan.ts                     # MODIFY: format can include "classification_jsonl"
  app/datasets/[datasetId]/page.tsx # MODIFY: thread datasetType prop
  components/grid/grid-cell.tsx     # MODIFY: show class badge instead of bbox overlay
  components/grid/annotation-overlay.tsx  # NO CHANGE (just not rendered for classification)
  components/detail/sample-modal.tsx      # MODIFY: show class label + dropdown
  components/detail/annotation-list.tsx   # MODIFY: hide bbox columns for classification
  components/stats/stats-dashboard.tsx    # MODIFY: hide detection-only tabs
  components/stats/annotation-summary.tsx # MODIFY: classification-appropriate labels
  components/ingest/scan-results.tsx      # MODIFY: show format badge for classification
```

### Pattern 1: Sentinel BBox Values for Classification

**What:** Classification annotations use bbox_x=0, bbox_y=0, bbox_w=0, bbox_h=0, area=0 as sentinel values. The `category_name` field carries the class label. One annotation per sample (for single-label classification).

**When to use:** When inserting classification annotations into the shared annotations table.

**Example:**
```python
# Classification annotation row (sentinel bboxes)
{
    "id": str(uuid.uuid4()),
    "dataset_id": dataset_id,
    "sample_id": sample_id,
    "category_name": "dog",         # The class label
    "bbox_x": 0.0,                  # Sentinel
    "bbox_y": 0.0,                  # Sentinel
    "bbox_w": 0.0,                  # Sentinel
    "bbox_h": 0.0,                  # Sentinel
    "area": 0.0,                    # Sentinel
    "is_crowd": False,
    "source": "ground_truth",
    "confidence": None,
    "metadata": None,
}
```

### Pattern 2: Parser Dispatch by Format

**What:** The IngestionService currently hardcodes `COCOParser()`. Extend to dispatch by format string.

**When to use:** When `ingest_with_progress` is called.

**Example:**
```python
# In IngestionService.ingest_with_progress():
if format == "coco":
    parser = COCOParser(batch_size=1000)
elif format == "classification_jsonl":
    parser = ClassificationJSONLParser(batch_size=1000)
else:
    raise ValueError(f"Unsupported format: {format}")
```

### Pattern 3: Format Auto-Detection in FolderScanner

**What:** The FolderScanner currently only detects COCO JSON files. Extend to detect classification JSONL files.

**When to use:** During `FolderScanner.scan()`.

**Detection heuristic:** Look for `.jsonl` files in the directory tree. A classification JSONL file contains lines like:
```json
{"filename": "image001.jpg", "label": "dog"}
```
Peek at the first few lines: if they parse as JSON with `filename` and `label` keys (no `bbox`/`annotations` key), classify as `classification_jsonl`.

**Example:**
```python
@staticmethod
def _is_classification_jsonl(file_path: Path) -> bool:
    """Check if a file is a classification JSONL annotation file."""
    try:
        with open(file_path) as f:
            for i, line in enumerate(f):
                if i >= 5:
                    break
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if "label" in obj and ("filename" in obj or "file_name" in obj):
                    if "bbox" not in obj and "annotations" not in obj:
                        return True
                return False
        return False
    except Exception:
        return False
```

### Pattern 4: datasetType Prop Threading

**What:** The dataset page fetches `dataset.dataset_type` and threads it as a prop to child components. Components branch at their boundary rather than deep inside.

**When to use:** Any component whose rendering differs between detection and classification.

**Example:**
```tsx
// page.tsx
<ImageGrid datasetId={datasetId} datasetType={dataset.dataset_type} />
<StatsDashboard datasetId={datasetId} datasetType={dataset.dataset_type} />
<SampleModal datasetId={datasetId} samples={allSamples} datasetType={dataset.dataset_type} />

// grid-cell.tsx
if (datasetType === "classification") {
  // Show class label badge instead of AnnotationOverlay
  const gtAnnotation = annotations.find(a => a.source === "ground_truth");
  return <ClassBadge label={gtAnnotation?.category_name} />;
} else {
  return <AnnotationOverlay ... />;
}
```

### Anti-Patterns to Avoid

- **Checking dataset_type deep inside components:** Branch at component boundaries (GridCell, SampleModal, StatsDashboard), not inside utility functions or hooks that are shared across both types.
- **Adding nullable bbox columns:** The sentinel approach was a prior decision. Do not add nullable bbox columns to the annotations table.
- **Modifying the existing 560-line evaluation.py:** Classification evaluation is separate (~50 lines, Phase 16+). Do not touch `evaluation.py` in this phase.
- **Storing dataset_type on samples:** It belongs on the datasets table -- one type per dataset, not per sample.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONL parsing | Custom streaming parser | Python `json.loads()` per line | JSONL files are small enough (one line per image), no need for ijson streaming |
| Image dimension reading | Manual PIL/cv2 calls | Existing `ImageService` | Already handles dimension extraction during thumbnail generation |
| SQL schema migration | Migration framework | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | Already established pattern (see `duckdb_repo.py` lines 84-103) |
| Frontend format badge | Custom badge component | Tailwind utility classes inline | Consistent with existing scan-results.tsx `splitColor()` pattern |

**Key insight:** This phase is mostly wiring -- connecting an existing architecture to a new data shape. The risky parts are not technical but completeness: ensuring every SQL query, every frontend component, and every display path handles the classification case.

## Common Pitfalls

### Pitfall 1: JSONL Format Ambiguity

**What goes wrong:** Different classification tools produce different JSONL schemas. Some use `"label"`, others `"class"`, `"category"`, or `"class_name"`. Some use `"filename"`, others `"file_name"`, `"image"`, or `"path"`.

**Why it happens:** No industry standard for classification JSONL format.

**How to avoid:** Support the most common key variants in the parser. Normalize on read:
```python
filename = obj.get("filename") or obj.get("file_name") or obj.get("image") or obj.get("path", "")
label = obj.get("label") or obj.get("class") or obj.get("category") or obj.get("class_name", "unknown")
```

**Warning signs:** Parser silently produces zero annotations because key names don't match.

### Pitfall 2: Classification Samples Without Annotations

**What goes wrong:** If an image file exists in the directory but has no line in the JSONL, it gets inserted as a sample with zero annotations. The grid shows it with no badge, confusingly.

**Why it happens:** JSONL may not list every image (unlabeled images are common in classification datasets).

**How to avoid:** During ingestion, only insert samples that appear in the JSONL file. Or, insert all images but mark unlabeled ones clearly in the UI. Decision: follow the COCO parser pattern -- only insert samples listed in the annotation file.

**Warning signs:** Image count in dataset doesn't match directory image count.

### Pitfall 3: Detection-Only UI Elements Leaking Through

**What goes wrong:** Classification datasets show bbox area histograms, IoU sliders, or empty bounding box overlays with sentinel values rendered as tiny dots at (0,0).

**Why it happens:** Forgetting to gate UI elements on `datasetType`.

**How to avoid:** Audit every component that references bbox values or detection-specific concepts:
- `AnnotationOverlay` -- skip rendering when `datasetType === "classification"`
- `annotation-list.tsx` -- hide Bounding Box and Area columns
- `evaluation-panel.tsx` -- hide IoU slider, use accuracy instead of mAP
- `stats-dashboard.tsx` -- rename "GT Annotations" to "Labeled Images"
- `annotation-summary.tsx` -- swap card labels

**Warning signs:** Sentinel bbox values (0,0,0,0) rendered visually anywhere.

### Pitfall 4: Category Ingestion for Classification

**What goes wrong:** The COCO parser extracts categories from a dedicated `categories` array. Classification JSONL files don't have one -- categories are implicitly defined by the set of unique labels.

**Why it happens:** Different format, different category discovery mechanism.

**How to avoid:** The ClassificationJSONLParser must do a first pass to collect unique labels, assign sequential category IDs, then do a second pass to emit annotation batches. Or, single pass collecting labels as encountered.

**Warning signs:** Empty categories table for classification datasets, breaking filter facets.

### Pitfall 5: Multi-Label Classification Collision

**What goes wrong:** If a future dataset has multiple labels per image, the single-annotation-per-sample assumption breaks.

**Why it happens:** Single-label is the common case, but multi-label exists.

**How to avoid:** Design the JSONL parser to handle `"label": ["dog", "outdoor"]` by emitting multiple annotation rows per sample. The sentinel bbox approach supports this naturally (each annotation row has its own category_name). But for Phase 15, scope to single-label only and document the multi-label extension path.

**Warning signs:** JSONL lines with array-valued `label` fields.

## Code Examples

### Classification JSONL Parser Structure

```python
class ClassificationJSONLParser(BaseParser):
    """Parse a JSONL file where each line maps filename -> class label."""

    @property
    def format_name(self) -> str:
        return "classification_jsonl"

    def parse_categories(self, file_path: Path) -> dict[int, str]:
        """First pass: collect unique labels -> sequential IDs."""
        labels: set[str] = set()
        with open(file_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                label = obj.get("label") or obj.get("class") or obj.get("category", "unknown")
                labels.add(label)
        return {i: name for i, name in enumerate(sorted(labels))}

    def build_image_batches(
        self, file_path: Path, dataset_id: str, split: str | None = None, image_dir: str = ""
    ) -> Iterator[pd.DataFrame]:
        """Yield sample rows from JSONL. Each line = one image."""
        batch = []
        for i, line in enumerate(open(file_path)):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            filename = obj.get("filename") or obj.get("file_name", "")
            sample_id = f"{split}_{i}" if split else str(i)
            batch.append({
                "id": sample_id,
                "dataset_id": dataset_id,
                "file_name": filename,
                "width": obj.get("width", 0),
                "height": obj.get("height", 0),
                "thumbnail_path": None,
                "split": split,
                "metadata": None,
                "image_dir": image_dir,
            })
            if len(batch) >= self.batch_size:
                yield pd.DataFrame(batch)
                batch = []
        if batch:
            yield pd.DataFrame(batch)

    def build_annotation_batches(
        self, file_path: Path, dataset_id: str, categories: dict[int, str], split: str | None = None
    ) -> Iterator[pd.DataFrame]:
        """Yield annotation rows with sentinel bbox values."""
        batch = []
        cat_name_to_id = {v: k for k, v in categories.items()}
        for i, line in enumerate(open(file_path)):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            label = obj.get("label") or obj.get("class") or obj.get("category", "unknown")
            sample_id = f"{split}_{i}" if split else str(i)
            ann_id = f"{split}_ann_{i}" if split else f"ann_{i}"
            batch.append({
                "id": ann_id,
                "dataset_id": dataset_id,
                "sample_id": sample_id,
                "category_name": label,
                "bbox_x": 0.0,
                "bbox_y": 0.0,
                "bbox_w": 0.0,
                "bbox_h": 0.0,
                "area": 0.0,
                "is_crowd": False,
                "source": "ground_truth",
                "confidence": None,
                "metadata": None,
            })
            if len(batch) >= self.batch_size:
                yield pd.DataFrame(batch)
                batch = []
        if batch:
            yield pd.DataFrame(batch)
```

### Schema Migration (DuckDB)

```python
# In duckdb_repo.py initialize_schema():
self.connection.execute(
    "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS dataset_type VARCHAR DEFAULT 'detection'"
)
```

### Frontend Class Badge (Grid Cell)

```tsx
// Inside GridCell, replacing AnnotationOverlay for classification datasets:
function ClassBadge({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <div className="absolute bottom-1 left-1 z-10">
      <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {label}
      </span>
    </div>
  );
}
```

### Frontend Class Label in Detail Modal

```tsx
// In SampleModal, for classification datasets:
// Show GT class label prominently with dropdown to change it
<div className="flex items-center gap-2">
  <span className="text-sm font-medium text-zinc-500">Class:</span>
  <select
    value={gtAnnotation?.category_name ?? ""}
    onChange={(e) => {
      if (gtAnnotation) {
        // Update the annotation's category_name
        updateCategoryMutation.mutate({
          annotationId: gtAnnotation.id,
          category_name: e.target.value,
        });
      }
    }}
    className="rounded border border-zinc-300 px-2 py-1 text-sm"
  >
    {categories.map((cat) => (
      <option key={cat} value={cat}>{cat}</option>
    ))}
  </select>
</div>
```

### Classification-Aware Statistics Summary

```tsx
// In AnnotationSummary, swap card definitions based on datasetType:
const DETECTION_CARDS = [
  { key: "total_images", label: "Total Images" },
  { key: "gt_annotations", label: "GT Annotations" },
  { key: "pred_annotations", label: "Predictions" },
  { key: "total_categories", label: "Categories" },
];

const CLASSIFICATION_CARDS = [
  { key: "total_images", label: "Total Images" },
  { key: "gt_annotations", label: "Labeled Images" },
  { key: "pred_annotations", label: "Predictions" },
  { key: "total_categories", label: "Classes" },
];
```

## Existing Codebase Surface Area

### Files That MUST Change

| File | Change | Reason |
|------|--------|--------|
| `app/repositories/duckdb_repo.py` | Add `dataset_type` column | INGEST-04 |
| `app/ingestion/classification_jsonl_parser.py` | NEW file | INGEST-01 |
| `app/services/folder_scanner.py` | Detect JSONL layouts | INGEST-02 |
| `app/services/ingestion.py` | Parser dispatch, store dataset_type | INGEST-01, INGEST-02 |
| `app/models/dataset.py` | Add `dataset_type` to response | INGEST-04 |
| `app/models/scan.py` | Format can be `classification_jsonl` | INGEST-02 |
| `app/routers/datasets.py` | Return dataset_type in responses | INGEST-04 |
| `frontend/src/types/dataset.ts` | Add `dataset_type` field | INGEST-04 |
| `frontend/src/types/scan.ts` | Format type update | INGEST-02 |
| `frontend/src/app/datasets/[datasetId]/page.tsx` | Thread `datasetType` prop | DISP-01 through DISP-04 |
| `frontend/src/components/grid/grid-cell.tsx` | Show class badge for classification | DISP-01 |
| `frontend/src/components/detail/sample-modal.tsx` | Show class label + dropdown | DISP-02, DISP-03 |
| `frontend/src/components/detail/annotation-list.tsx` | Hide bbox columns for classification | DISP-02 |
| `frontend/src/components/stats/stats-dashboard.tsx` | Hide detection-only tabs | DISP-04 |
| `frontend/src/components/stats/annotation-summary.tsx` | Classification-appropriate labels | DISP-04 |
| `frontend/src/components/ingest/scan-results.tsx` | Format badge for classification | INGEST-02 |

### Files That SHOULD NOT Change

| File | Reason |
|------|--------|
| `app/services/evaluation.py` | Detection evaluation untouched; classification eval is separate (future phase) |
| `app/ingestion/coco_parser.py` | COCO format unchanged |
| `app/ingestion/prediction_parser.py` | Detection predictions unchanged |
| `app/services/error_analysis.py` | Detection-specific error categories |
| `app/ingestion/detection_annotation_parser.py` | Detection predictions unchanged |

### Backend API Changes Needed

1. **New annotation update endpoint for category_name** (DISP-03): Currently `PUT /annotations/{id}` only updates bbox. Need to add `PATCH /annotations/{id}/category` or extend the existing PUT to accept `category_name`.

2. **Statistics endpoint** (DISP-04): The `GET /datasets/{id}/statistics` endpoint returns detection-centric summary stats. For classification datasets, `gt_annotations` should reflect "labeled images" (distinct sample_ids with GT annotations) rather than raw annotation count.

3. **Dataset response**: `GET /datasets/{id}` needs to include `dataset_type`.

### Classification JSONL Expected Format

```jsonl
{"filename": "img001.jpg", "label": "cat"}
{"filename": "img002.jpg", "label": "dog"}
{"filename": "img003.jpg", "label": "cat"}
```

Alternative accepted keys:
- `filename` / `file_name` / `image` / `path`
- `label` / `class` / `category` / `class_name`
- Optional: `width`, `height`, `confidence`, `split`

### Folder Layouts to Detect

**Layout D (Classification JSONL):** Split directories with JSONL + images:
```
dataset/
  train/
    annotations.jsonl
    img001.jpg
    img002.jpg
  val/
    annotations.jsonl
    img003.jpg
```

**Layout E (Flat Classification):** Single JSONL at root:
```
dataset/
  labels.jsonl
  images/
    img001.jpg
    img002.jpg
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hard-coded COCO parser | Parser dispatch by format string | Phase 15 | Enables multi-format support |
| No dataset_type tracking | `dataset_type` column on datasets | Phase 15 | Frontend can branch rendering |
| Detection-only statistics | Type-aware statistics | Phase 15 | Classification users see relevant metrics |

## Open Questions

1. **Image dimensions for classification JSONL**
   - What we know: COCO JSON includes width/height per image. Classification JSONL typically doesn't.
   - What's unclear: Should the parser read image dimensions from disk during ingestion, or store 0/0 and resolve later during thumbnail generation?
   - Recommendation: Read dimensions during thumbnail generation (existing `ImageService` path). Store 0/0 initially if not present in JSONL. The grid cell uses `object-cover` which doesn't need dimensions. The annotation overlay (not used for classification) needs dimensions. Detail modal image loads at full-res naturally.

2. **Multi-label classification**
   - What we know: Phase 15 scopes to single-label. Multi-label is a future extension.
   - What's unclear: Should the JSONL parser error on array labels or silently take the first?
   - Recommendation: If `label` is an array, emit one annotation row per label. This is forward-compatible and costs nothing with the sentinel bbox approach.

3. **Classification prediction import**
   - What we know: Detection predictions use `DetectionAnnotationParser` or `PredictionParser`. Classification predictions would be a different format.
   - What's unclear: Is classification prediction import in scope for Phase 15?
   - Recommendation: Out of scope. Phase 15 focuses on GT ingestion and display. Classification prediction import + evaluation are natural follow-ups.

4. **Annotation update for category_name change (DISP-03)**
   - What we know: Current `AnnotationUpdate` model only has bbox fields. Current `PUT /annotations/{id}` only updates bbox.
   - What's unclear: Should we extend the existing endpoint or create a new one?
   - Recommendation: Add a new `PATCH /annotations/{id}/category` endpoint or extend `AnnotationUpdate` to include optional `category_name`. Extending is simpler since the existing pattern already handles updates. A new field `category_name: str | None = None` on AnnotationUpdate, applied when present, is clean.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- direct file reads of all affected files listed above
  - `app/ingestion/base_parser.py` -- BaseParser ABC interface
  - `app/ingestion/coco_parser.py` -- reference parser implementation
  - `app/repositories/duckdb_repo.py` -- schema and migration pattern
  - `app/services/ingestion.py` -- ingestion orchestration
  - `app/services/folder_scanner.py` -- format detection heuristics
  - `app/services/evaluation.py` -- evaluation pipeline (560 lines, leave alone)
  - `app/models/` -- all Pydantic models
  - `app/routers/` -- all API endpoints
  - `frontend/src/components/` -- all display components
  - `frontend/src/types/` -- all TypeScript type definitions
  - `frontend/src/stores/` -- Zustand stores (filter, UI, ingest)

### Secondary (MEDIUM confidence)
- Prior decisions from phase description: sentinel bbox values, separate classification eval function, datasetType prop threading, parser registry

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries
- Architecture: HIGH -- extending well-established patterns in the codebase
- Pitfalls: HIGH -- derived from direct codebase analysis, not external sources
- Code examples: HIGH -- based on actual codebase patterns and verified file contents

**Research date:** 2026-02-18
**Valid until:** 2026-03-18 (stable -- internal codebase patterns, no external dependency risk)
