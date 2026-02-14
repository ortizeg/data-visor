# Feature Gap Analysis: DataVisor v1.1 vs FiftyOne & Encord

**Domain:** Computer Vision Dataset Introspection / Exploration Tooling
**Researched:** 2026-02-12
**Mode:** Competitive analysis (FiftyOne + Encord vs DataVisor)
**Overall Confidence:** HIGH (grounded in official documentation from both platforms)

---

## How to Read This Document

Each feature gap is categorized by:
- **Priority:** Table Stakes (expected by CV engineers) / Differentiator (competitive edge) / Nice-to-Have (marginal value for v1.1)
- **Complexity:** Low (< 1 day) / Medium (1-3 days) / High (3+ days)
- **Depends On:** Existing DataVisor v1.0 features or new features needed first
- **Competitor Reference:** Specific documentation or behavior observed

---

## 1. Dataset Ingestion & Format Support

### 1A. Multi-Format Import (YOLO, VOC, KITTI, TFRecords, BDD)

**What competitors do:**

FiftyOne's `fo.Dataset.from_dir()` supports 15+ formats out of the box:
- COCO Detection, VOC Detection, YOLOv4, YOLOv5, KITTI Detection
- TFRecords (classification + detection), BDD100K, CVAT (image + video)
- OpenLABEL, DICOM, GeoJSON, GeoTIFF
- Image/Video classification directory trees
- FiftyOne native format

The API requires explicit `dataset_type` specification -- there is no automatic format detection. Example:
```python
dataset = fo.Dataset.from_dir(
    dataset_dir="/path/to/data",
    dataset_type=fo.types.COCODetectionDataset,
    label_field="ground_truth",
)
```

Encord ingestion is cloud-native: users register files from AWS S3, GCS, Azure, or OTC OSS buckets. Local upload is supported but the primary workflow is cloud storage integration via SDK. Encord's SDK enables programmatic ETL pipelines for ingestion.

**What DataVisor has:** COCO format only via streaming ijson parser.

**Gap:** DataVisor only supports COCO. CV engineers commonly have datasets in YOLO (especially YOLOv5/v8 from Ultralytics) and VOC (legacy Pascal datasets). Missing YOLO support is the most critical gap -- it is the most popular training format today.

**Priority:** TABLE STAKES -- YOLO and VOC are the two most common formats after COCO. Missing them means users must convert externally before loading.

**Complexity:** MEDIUM per format. Each format needs: (a) parser that maps to DataVisor's internal schema, (b) path resolution for images/labels, (c) tests with real-world datasets.

- YOLO: Parse `dataset.yaml` for class names, read `.txt` label files (class_id cx cy w h), resolve image paths from `images/` directory structure
- VOC: Parse XML annotation files with `<object>` elements, resolve image paths from `JPEGImages/`
- KITTI: Parse space-delimited `.txt` files with 15 columns per object

**Depends on:** Existing ingestion pipeline. DataVisor's streaming parser architecture should be extended with a format-detection step before parsing begins.

**Recommendation:** Add YOLO and VOC for v1.1. KITTI and others can wait for v1.2+. Design a `FormatDetector` class that inspects folder contents (presence of `*.yaml`, `*.xml`, `*.json`) and recommends the parser.

---

### 1B. Train/Val/Test Split Handling

**What competitors do:**

FiftyOne handles splits via the `split` parameter on `add_dir()`:
```python
dataset = fo.Dataset(name)
for split in ["train", "val", "test"]:
    dataset.add_dir(
        dataset_dir=dataset_dir,
        dataset_type=fo.types.YOLOv5Dataset,
        split=split,
        tags=split,  # Tags each sample with its split name
    )
```

This means: (a) each split is loaded separately, (b) samples are tagged with their split, (c) users can filter by split tag in the App. FiftyOne also has `Brain.compute_leaky_splits()` to detect data leakage between train/test.

Encord handles splits at the project level -- datasets are created per split, and projects reference specific datasets. The platform does not auto-detect folder structure.

**What DataVisor has:** No split awareness. The ingestion UI takes a single annotations file and image directory.

**Gap:** Most real-world datasets have train/val/test directories. Users must currently load each split separately and cannot filter by split. There is no detection of the common `train/`, `val/`, `test/` folder pattern.

**Priority:** TABLE STAKES -- every real dataset has splits. Without this, the first thing a user does after loading is wonder "where are my val images?"

**Complexity:** MEDIUM.
- Auto-detect: Scan for `train/`, `val/`, `test/` subdirectories; check for YOLO's `dataset.yaml` split definitions
- Tag on ingest: Add a `split` metadata field to each sample during ingestion
- Filter: The existing sidebar filtering system handles this automatically once the field exists

**Depends on:** Ingestion pipeline (existing). Sidebar filtering (existing -- works on any metadata field).

**Recommendation:** During ingestion, scan the target directory for split subdirectories. If found, present them in the UI and let the user select which splits to load. Tag each sample with its split name. The existing metadata filtering will handle split-based browsing.

---

### 1C. Smart Folder Detection UI

**What competitors do:**

FiftyOne requires Python code to load datasets -- there is no folder-detection UI. The user must know the format and write `fo.Dataset.from_dir(...)` with the correct type. This is a pain point evidenced by multiple GitHub issues about `from_dir()` failing on slightly non-standard folder structures (issues #1780, #1781, #1951).

Encord's workflow is: (1) register cloud storage, (2) create a dataset in the platform, (3) upload/sync files. It is guided but requires configuration.

Neither competitor has a "point at folder and auto-detect" experience.

**What DataVisor has:** Manual file selection in the ingestion UI.

**Gap:** There is an opportunity to leapfrog both competitors with a smart ingestion UI that: (a) accepts a root directory, (b) scans for annotation files and image directories, (c) infers the format, (d) detects splits, (e) shows a preview before import.

**Priority:** DIFFERENTIATOR -- neither FiftyOne nor Encord does this well. FiftyOne forces Python; Encord forces cloud config. A "drag-and-drop folder" experience is genuinely better.

**Complexity:** MEDIUM.
- Directory scanner: Look for `*.json` (COCO), `*.yaml` + `*.txt` (YOLO), `*.xml` (VOC)
- Preview: Show detected format, split count, image count, class count before import
- Confirmation: Let user override detected format if wrong

**Depends on:** Multi-format import (1A). Split handling (1B).

**Recommendation:** Build a `DatasetDetector` service that returns a `DetectionResult` with: format type, annotation paths, image directories, splits found, sample counts. The frontend renders this as a confirmation dialog before ingestion begins.

---

### 1D. Dataset Zoo / Pre-Built Datasets

**What competitors do:**

FiftyOne has a Dataset Zoo with one-line loading of 20+ benchmark datasets:
```python
import fiftyone.zoo as foz
dataset = foz.load_zoo_dataset("coco-2017", split="validation")
```
Available datasets include COCO-2017, CIFAR-10/100, ImageNet, BDD100K, Open Images, Cityscapes, ActivityNet, KITTI, and a `quickstart` dataset with 200 samples for demos.

Encord does not have a dataset zoo -- users bring their own data.

**What DataVisor has:** No pre-built dataset loading.

**Gap:** The quickstart experience matters. FiftyOne users can go from `pip install` to exploring a dataset in 30 seconds. DataVisor users must have their own COCO dataset ready.

**Priority:** NICE-TO-HAVE for v1.1 (a single demo dataset is sufficient). TABLE STAKES for onboarding/documentation purposes.

**Complexity:** LOW. Bundle a small demo dataset (50-100 COCO images with annotations and predictions) for first-run experience. Not a full zoo.

**Depends on:** Nothing. Just needs a sample dataset bundled or downloadable.

**Recommendation:** Ship a `quickstart` command or UI button that loads a bundled demo dataset. This is critical for documentation, demos, and first-time users. Defer a full dataset zoo indefinitely -- it is not core to the tool's value.

---

### 1E. Dataset Export

**What competitors do:**

FiftyOne exports to all the same formats it imports, via:
```python
dataset_or_view.export(
    export_dir="/path/to/export",
    dataset_type=fo.types.YOLOv5Dataset,
    label_field="ground_truth",
)
```
Key parameters: `export_media` (copy/move/symlink/omit), `abs_paths`, `classes` (explicit class list), `data_path`/`labels_path` (separate media and labels). Views can be exported -- so a filtered subset exports only matching samples.

Encord exports labels via SDK in JSON format and supports integration with training pipelines.

**What DataVisor has:** No export functionality.

**Gap:** After users curate a dataset (filter, tag errors, exclude bad samples), they need to export the cleaned subset for training. Without export, the curation work is stranded inside DataVisor.

**Priority:** TABLE STAKES -- the end-to-end workflow is: load -> explore -> curate -> export for training. Export completes the loop.

**Complexity:** MEDIUM.
- Export a DatasetView (filtered subset) to COCO, YOLO, or VOC format
- Handle media: copy vs symlink vs manifest-only
- Write annotation files in target format

**Depends on:** Multi-format import (1A, for the format writers). Saved views / filtering (existing).

**Recommendation:** Implement export for COCO and YOLO formats in v1.1. The current view (with all active filters) should be exportable. Support `copy` and `symlink` media modes. This closes the curation loop.

---

## 2. Annotation Management

### 2A. In-App Annotation Editing (Move, Resize, Delete Bounding Boxes)

**What competitors do:**

FiftyOne does NOT have in-app annotation editing. It delegates to external tools (CVAT, Label Studio, Labelbox) via `dataset.annotate()`:
```python
anno_key = "corrections"
view.annotate(
    anno_key,
    backend="cvat",
    label_field="ground_truth",
    allow_additions=True,
    allow_deletions=True,
    allow_spatial_edits=True,
)
# Later, after editing in CVAT:
view.load_annotations(anno_key)
```
This is a roundtrip: FiftyOne -> CVAT -> FiftyOne. Annotations are not editable in the FiftyOne App itself.

Encord has a full-featured annotation editor with:
- Bounding boxes, rotatable bounding boxes, polygons, polylines, keypoints, bitmasks, object primitives
- Vertex management: add/remove/move vertices on polygons
- Brush tool and eraser for freehand polygon refinement
- Copy/paste labels across frames (Ctrl+C, Ctrl+V)
- Undo/redo (Ctrl+Z, Ctrl+Shift+Z)
- Merge and subtract polygons
- SAM 2 model-assisted segmentation
- Interpolation for frame-to-frame tracking
- Bulk label operations: merge objects, mass-delete by class/confidence/frame range
- Wacom tablet support

**What DataVisor has:** Read-only annotation display. No editing.

**Gap:** DataVisor's PROJECT.md scopes this as "quick corrections only, not CVAT replacement." This is the right call. The question is: what is the minimum viable annotation editing for an introspection tool?

**Priority:** TABLE STAKES at the "quick correction" level. When a user spots a wrong bounding box during error triage, they should be able to fix it immediately without context-switching to CVAT.

**Complexity:** HIGH for full editing. MEDIUM for the minimum viable set:
- Delete a bounding box (click -> delete key)
- Move a bounding box (drag)
- Resize a bounding box (drag corners/edges)
- Change class label (dropdown or hotkey)
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z)

Full polygon editing, brush tools, interpolation, etc. are out of scope per PROJECT.md.

**Depends on:** Sample detail modal (existing). Annotation overlay rendering (existing).

**Recommendation:** Implement bbox-only editing in the sample detail modal: select -> move/resize/delete -> save. No polygon editing, no new annotation creation (that is CVAT territory). Add undo/redo with a simple command stack. This covers 90% of "quick correction" needs.

---

### 2B. Create New Annotations

**What competitors do:**

FiftyOne: Not possible in-app. Must use CVAT/Label Studio integration.

Encord: Full creation workflow -- select a tool (bbox, polygon, etc.), draw on the image, assign class from ontology, save. Ontology-driven: classes are defined upfront in a project ontology.

**What DataVisor has:** No annotation creation.

**Gap:** Sometimes during triage, a user finds a missing annotation (false negative) and wants to add a bounding box. This is a natural part of the correction workflow.

**Priority:** NICE-TO-HAVE for v1.1. The primary workflow is editing existing annotations, not creating new ones. New annotation creation can be added in v1.2 if users request it.

**Complexity:** MEDIUM. Requires: draw-to-create interaction, class assignment UI, persistence to DuckDB.

**Depends on:** Annotation editing (2A).

**Recommendation:** Defer to v1.2. Focus v1.1 on edit/delete of existing annotations. If added later, scope to bounding boxes only (click-drag to create, assign class from existing class list).

---

### 2C. Annotation Backend Integration (CVAT, Label Studio)

**What competitors do:**

FiftyOne's annotation integration is a key feature:
- `dataset.annotate()` uploads samples to CVAT/Label Studio/Labelbox
- Configurable permissions: `allow_additions`, `allow_deletions`, `allow_label_edits`, `allow_spatial_edits`
- Label schema defines task type, classes, and custom attributes
- `dataset.load_annotations()` merges results back
- Annotation runs are tracked: rename, inspect, delete

Encord IS an annotation platform, so this is not "integration" but rather native capability.

**What DataVisor has:** No integration with external annotation tools.

**Gap:** For heavy annotation tasks (re-labeling hundreds of samples), an integration with CVAT would be valuable. But DataVisor is a personal tool, and setting up CVAT is non-trivial.

**Priority:** NICE-TO-HAVE for v1.1. Most users of a personal introspection tool will make quick fixes in-app, not set up a separate CVAT instance. Defer until there is demonstrated need.

**Complexity:** HIGH. Requires CVAT API integration, task creation, status tracking, result merging.

**Depends on:** Nothing, but is only useful if the user has CVAT/Label Studio running.

**Recommendation:** Defer indefinitely. Instead, support exporting flagged samples to COCO format (from 1E), which can be imported into any annotation tool. This achieves the same goal without tight coupling.

---

## 3. Error Triage & Quality Analysis

### 3A. Interactive Evaluation Dashboard (Confusion Matrix, PR Curves, Per-Class AP)

**What competitors do:**

FiftyOne's Model Evaluation panel is a standout feature:
- Interactive confusion matrix: click any cell to filter the grid to those specific GT/prediction pairs
- PR curves with adjustable confidence thresholds
- Per-class metrics: precision, recall, F1, AP
- All metrics are linked to the dataset view -- changing filters updates the evaluation metrics
- Subset evaluation: `use_subset()` to evaluate on specific conditions (e.g., only nighttime images)

Encord Active provides model quality metrics focused on active learning:
- Entropy, Least Confidence, Margin, Variance, Mean Object Confidence
- These rank samples by uncertainty for prioritized re-annotation

**What DataVisor has:** Error categorization (TP/FP/FN/Label Error) and dataset statistics dashboard (class distribution, annotation counts). No confusion matrix, no PR curves, no per-class AP.

**Gap:** The confusion matrix with click-to-filter is FiftyOne's killer evaluation feature. A CV engineer evaluating a model needs to see "my model confuses 'car' with 'truck' 40% of the time" and then immediately see those misclassified samples. DataVisor has the error categorization but lacks the statistical visualization layer.

**Priority:** TABLE STAKES for a model evaluation tool. DataVisor already has GT vs Predictions comparison, but without aggregate metrics (confusion matrix, mAP, per-class AP), the evaluation is sample-by-sample rather than systematic.

**Complexity:** HIGH.
- Confusion matrix: Aggregate TP/FP/FN by class pair, render interactive heatmap, click-to-filter
- PR curves: Sweep confidence thresholds, compute precision/recall per class, Recharts line chart
- Per-class AP: Standard COCO-style AP computation
- All must link to the grid view for click-to-filter

**Depends on:** Evaluation pipeline (existing -- TP/FP/FN matching). Statistics dashboard (existing -- extend it). Recharts (existing in stack).

**Recommendation:** Build the confusion matrix with click-to-filter as the centerpiece. This single feature closes the biggest evaluation gap. PR curves and per-class AP can follow. Use Recharts (already in the stack) for visualization.

---

### 3B. Quality Scoring Metrics (Uniqueness, Hardness, Mistakenness)

**What competitors do:**

FiftyOne Brain provides four computed quality scores:
- **Uniqueness:** Non-duplicate detection, comparing image content across the dataset. Useful for deduplication and early-stage data selection.
- **Hardness:** Per-sample difficulty during training, computed from model logits. Helps identify which unlabeled examples deserve annotation budget.
- **Mistakenness:** Annotation error probability, computed from model logits. Identifies likely mislabeled samples. Works on classification and detection.
- **Representativeness:** How typical a sample is, revealing common data modes vs outliers.

Additionally:
- **Exact duplicate detection:** Identifies identical files with different names.
- **Near-duplicate detection:** Finds visually similar images that may cause data quality issues.
- **Leaky splits detection:** Finds potential data leakage between train/test/val splits.

Encord Active provides 25+ quality metrics in three categories:
- **Data quality:** Brightness (0-1), Sharpness (0-1), Uniqueness, Area, Diversity
- **Label quality:** Border Proximity, Broken Object Tracks, Classification Quality, Label Duplicates, Object Classification Quality, Annotation Quality Score, Relative Area, Aspect Ratio
- **Issue shortcuts:** Pre-configured filters for common problems -- Duplicates (uniqueness < 0.00001), Blur (sharpness < 0.005), Dark (brightness < 0.1), Bright (brightness > 0.7), Low Annotation Quality (quality < 0.02)

**What DataVisor has:** Error categorization (Hard FP, Label Error, FN) and Pydantic AI agent for pattern detection. No per-sample quality scores. No deduplication. No hardness/mistakenness scoring.

**Gap:** DataVisor categorizes errors but does not score individual samples on quality dimensions. FiftyOne's mistakenness score and Encord's issue shortcuts are the most actionable features -- they surface the "worst" samples automatically.

**Priority:** TABLE STAKES for the "worst images ranking" feature planned in v1.1. A combined quality score requires component metrics.

**Complexity:** MEDIUM per metric.
- Image uniqueness: Compute from existing DINOv2 embeddings + Qdrant similarity search (infrastructure exists)
- Image brightness/sharpness: Simple image processing metrics (OpenCV)
- Near-duplicate detection: Cosine similarity threshold on existing embeddings
- Mistakenness: Requires model logits (not just predictions), which DataVisor does not currently import

**Depends on:** DINOv2 embeddings (existing). Qdrant (existing). Evaluation pipeline (existing).

**Recommendation:** For v1.1, implement:
1. **Near-duplicate detection** using existing embeddings (low effort, high value)
2. **Image quality metrics** (brightness, sharpness, contrast) for the AI agent
3. **Composite "worst sample" score** combining: error count + low confidence + low uniqueness

Defer hardness and mistakenness -- they require model logits, which would need a new import schema.

---

### 3C. Error Triage Workflow (Review, Tag, Resolve)

**What competitors do:**

FiftyOne's triage workflow is programmatic:
1. Run `evaluate_detections()` to tag TP/FP/FN
2. Create a view filtering to FP or FN samples
3. Browse in the App, optionally clicking confusion matrix cells
4. Batch-tag samples via the App's tag icon
5. Programmatically process tagged samples

FiftyOne App batch operations include: select samples in grid -> tag selected -> clone selected -> delete selected -> delete selected labels. Selection works via checkbox on each sample.

Encord's triage workflow is more structured:
1. Encord Active surfaces issues via quality metrics and shortcuts (Blur, Dark, Low Quality, etc.)
2. Users create "Collections" -- saved groups of problematic data units
3. Issues can be tagged and tracked in Project Analytics
4. Workflows route flagged samples back to annotation stages (Annotate -> Review -> Approve pipeline)
5. Review mode: approve (N key), reject (B key), toggle review edit mode (Ctrl+E)
6. "Data Agents" automate triage by integrating foundation models into workflows

**What DataVisor has:** Error categorization (Hard FP, Label Error, FN), bulk tagging, saved views, AI agent recommendations. No structured review-approve workflow. No issue tracking.

**Gap:** The gap is not in error detection (DataVisor's categorization + AI agent is strong) but in the triage workflow UX:
- No dedicated "error review" mode that dims non-error samples
- No approve/reject/skip workflow for reviewing flagged items
- No progress tracking (reviewed 45/120 flagged samples)

**Priority:** DIFFERENTIATOR -- a focused error triage mode with keyboard-driven review (approve/reject/skip) would be faster than both FiftyOne's programmatic approach and Encord's multi-platform workflow.

**Complexity:** MEDIUM.
- Review mode: filter to error samples, highlight current, dim others
- Keyboard: N = correct (remove error tag), B = confirmed error, Space = skip
- Progress: "Reviewed 45/120 -- 23 confirmed errors, 22 false alarms"
- Persistence: Track review status per sample

**Depends on:** Error categorization (existing). Tagging (existing). Keyboard shortcuts (new, see section 5).

**Recommendation:** Build a dedicated "Triage Mode" that enters a focused review workflow: shows one error sample at a time, keyboard-driven approve/reject/skip, progress tracking, auto-advances to next sample. This is the kind of opinionated UX that makes DataVisor better than FiftyOne for error review, where FiftyOne forces users to manually browse and tag.

---

### 3D. Worst Images Ranking (Combined Quality Score)

**What competitors do:**

FiftyOne Brain's `compute_hardness()` and `compute_mistakenness()` each produce a per-sample float score that can be sorted to find the worst samples. Users combine multiple scores by creating computed fields:
```python
dataset.set_field("quality_score", F("mistakenness") + F("hardness"))
```

Encord Active's issue shortcuts pre-define thresholds (blur < 0.005, dark < 0.1, etc.) and surface samples that fail multiple checks.

Neither platform has a single "worst images" composite ranking out of the box.

**What DataVisor has:** Error categorization but no numeric ranking. The AI agent detects patterns but does not rank individual samples.

**Gap:** A composite "data quality score" that ranks every sample by how problematic it is. This would power the "Smart worst images ranking" feature planned for v1.1.

**Priority:** DIFFERENTIATOR -- neither competitor does this as a first-class feature. A "Problems" tab showing samples ranked by composite badness score is novel.

**Complexity:** MEDIUM.
- Define component metrics: error count, confidence variance, brightness, sharpness, near-duplicate distance, annotation density
- Normalize each to 0-1
- Weighted combination into single score
- Store in DuckDB, expose as sortable field
- UI: "Worst Images" view sorted by composite score

**Depends on:** Quality metrics (3B). Error categorization (existing).

**Recommendation:** Define a `quality_score` field computed from: (a) number of errors on sample, (b) mean prediction confidence (low = uncertain), (c) near-duplicate distance (high = unusual), (d) image quality metrics. Surface as a sortable column and as a dedicated "Worst Images" view.

---

## 4. Deployment & Infrastructure

### 4A. Docker Deployment

**What competitors do:**

FiftyOne (open-source) provides a Dockerfile for building custom images:
- Configurable Python version
- Persistent `/fiftyone` directory for databases and datasets
- Docker Compose not officially provided for OSS, but community examples exist

FiftyOne Enterprise provides:
- Helm chart for Kubernetes deployment (helm.fiftyone.ai)
- Docker Compose for smaller deployments
- Central Authentication Service (CAS)
- Multi-container architecture: app, API, database, CAS

Encord is SaaS-only -- no self-hosted Docker deployment. Data stays in user's cloud storage; the platform is hosted by Encord.

**What DataVisor has:** No Docker support. Runs locally with `uvicorn` + `npm run dev`.

**Gap:** DataVisor needs Docker for cloud VM deployment (per PROJECT.md). This is the most basic deployment gap.

**Priority:** TABLE STAKES for v1.1 (explicitly in scope per milestone definition).

**Complexity:** MEDIUM.
- Dockerfile: Multi-stage build (Python backend + Node frontend build)
- Docker Compose: Backend, frontend, Qdrant services
- Volume mounts: Dataset storage, DuckDB database, Qdrant data
- Environment configuration: Image source paths, GPU support (optional)

**Depends on:** Nothing. Can be built in parallel with features.

**Recommendation:** Multi-stage Dockerfile: (1) Node build stage for frontend, (2) Python runtime with bundled frontend. Docker Compose with three services: app, qdrant, and an init container for setup. Map volumes for `/data` (datasets), `/db` (DuckDB), `/qdrant` (vectors).

---

### 4B. Authentication

**What competitors do:**

FiftyOne OSS: No authentication. Anyone with access to the port can use it.

FiftyOne Enterprise: Full auth via Central Authentication Service (CAS), supporting OIDC/OAuth2, Auth0, and air-gapped deployments. Role-based access control with user groups and permissions.

Encord: Cloud-hosted with SSO, SAML, team management, SOC-2/HIPAA/GDPR compliance.

**What DataVisor has:** No authentication. Open port.

**Gap:** When deployed on a cloud VM, the app is exposed to the internet. Basic auth is the minimum security requirement. This is explicitly in scope for v1.1.

**Priority:** TABLE STAKES for cloud deployment. Without auth, anyone who discovers the URL can access your dataset.

**Complexity:** LOW.
- Single-user basic auth (username/password from environment variable)
- Applied as middleware on all API routes and frontend routes
- No user management, no RBAC, no SSO -- just a password gate

**Depends on:** Docker deployment (4A).

**Recommendation:** Implement as FastAPI middleware: check `Authorization: Basic ...` header against `DATAVISOR_USERNAME` / `DATAVISOR_PASSWORD` env vars. Frontend: show login form, store token in session. This is explicitly scoped as single-user in PROJECT.md -- do not over-engineer.

---

### 4C. Cloud Deployment Scripts

**What competitors do:**

FiftyOne Enterprise: Helm chart for Kubernetes with detailed docs (helm.fiftyone.ai). Community Docker deployment guides.

FiftyOne OSS: Remote sessions via SSH port forwarding (`fiftyone app connect --destination user@host`). This is the simplest cloud access pattern.

Encord: No deployment needed (SaaS).

**What DataVisor has:** No deployment scripts.

**Gap:** PROJECT.md specifies "GCP deployment script + local run script with setup instructions."

**Priority:** TABLE STAKES for v1.1 (explicitly in scope).

**Complexity:** LOW-MEDIUM.
- `scripts/deploy-gcp.sh`: Create GCE instance, install Docker, pull/build image, start compose
- `scripts/run-local.sh`: Docker compose up with sensible defaults
- Documentation: Setup instructions, port configuration, data mounting

**Depends on:** Docker deployment (4A). Auth (4B).

**Recommendation:** Provide two scripts: (1) `run-local.sh` for Docker Compose on local machine, (2) `deploy-gcp.sh` for GCE VM provisioning with startup script. Both use Docker Compose. The GCP script should configure firewall rules for port 443 only with auth required.

---

### 4D. Remote Sessions / Tunnel Access

**What competitors do:**

FiftyOne supports remote sessions natively:
```bash
# On remote machine
fiftyone app launch --remote --port 5151

# On local machine
fiftyone app connect --destination user@remote --port 5151
```
This sets up SSH port forwarding automatically. Users can also manually forward: `ssh -N -L 5151:localhost:5151 user@remote`.

**What DataVisor has:** No remote session support.

**Gap:** Minor gap if Docker + auth is implemented (users just hit the URL). SSH tunneling is a nice developer convenience but not essential when basic auth exists.

**Priority:** NICE-TO-HAVE. Docker + auth covers the primary use case.

**Complexity:** LOW. Document the SSH tunnel approach: `ssh -N -L 8080:localhost:8080 user@vm`.

**Depends on:** Docker deployment (4A).

**Recommendation:** Document SSH tunneling as an alternative to basic auth for security-conscious users. No code needed -- just docs.

---

## 5. Keyboard Shortcuts & Power-User UX

### 5A. Core Navigation Shortcuts

**What competitors do:**

FiftyOne App shortcuts (accessed via `?` key):
- `?` -- Show all shortcuts
- `z` -- Crop/zoom to visible labels
- `ESC` -- Reset view
- Arrow keys (up/down) -- Rotate z-order of overlapping labels
- Spacebar -- Play/pause video
- `<` / `>` -- Frame-by-frame navigation (video, when paused)
- `0-9` -- Seek to 0%-90% of video
- Grid filtering and sorting via sidebar (no keyboard shortcuts for grid navigation)

FiftyOne notably does NOT have keyboard shortcuts for: navigating between samples in the grid, toggling label visibility by keyboard, or sample selection by keyboard. These are open feature requests (GitHub issues #2120, #1761).

Encord annotation editor shortcuts (comprehensive):
- **Navigation:** Arrow keys (next/previous sample, frame navigation), Space (play/pause)
- **Editing:** Ctrl+Z/Ctrl+Shift+Z (undo/redo), Backspace (delete), Ctrl+C/V (copy/paste)
- **Review:** N (approve), B (reject), Ctrl+E (toggle review edit)
- **Tools:** D (freehand drawing), G (brush), H (eraser), `[`/`]` (brush size)
- **Annotation:** A (add vertex), S (remove vertex), F (edit vertex), Enter (complete), Esc (cancel)
- **Display:** Shift+H (hide all labels), Shift+N (show object names)
- **Bulk:** Ctrl+A (select all), Shift+D (remove from frame)
- **Meta:** Ctrl+Shift+K (open shortcuts menu), Ctrl+S (save), Shift+Enter (submit task)

**What DataVisor has:** No keyboard shortcuts.

**Gap:** Keyboard navigation is expected by power users. Both competitors support it, though FiftyOne's implementation is incomplete (no grid navigation shortcuts).

**Priority:** TABLE STAKES for power-user adoption. CV engineers reviewing hundreds of samples expect keyboard navigation. The triage workflow (3C) depends on this.

**Complexity:** MEDIUM.

**Depends on:** Sample detail modal (existing). Grid view (existing). Triage mode (new, 3C).

**Recommendation:** Implement in two tiers:

**Tier 1 (v1.1 must-have):**
| Shortcut | Action |
|----------|--------|
| `?` | Show shortcuts help overlay |
| `ArrowLeft` / `ArrowRight` | Previous/next sample in modal |
| `ESC` | Close modal / cancel action |
| `Space` | Toggle label visibility |
| `G` | Toggle GT labels |
| `P` | Toggle prediction labels |
| `T` | Tag current sample |
| `Delete` / `Backspace` | Delete selected annotation (when editing) |
| `Ctrl+Z` / `Cmd+Z` | Undo (when editing) |
| `1-9` | Quick-assign class by index (when editing) |

**Tier 2 (v1.1 nice-to-have):**
| Shortcut | Action |
|----------|--------|
| `J` / `K` | Navigate grid (previous/next row) |
| `Enter` | Open selected sample in modal |
| `E` | Enter edit mode on selected annotation |
| `F` | Toggle fullscreen on modal |
| `/` | Focus search bar |
| `N` / `B` | Approve / Reject in triage mode |

---

### 5B. Customizable Hotkeys

**What competitors do:**

Encord allows customizable hotkeys: users can remap keyboard shortcuts to match their workflow preferences. Shortcuts menu via Ctrl+Shift+K.

FiftyOne does not support customizable hotkeys.

**What DataVisor has:** No shortcuts at all.

**Gap:** Minor. Fixed shortcuts with good defaults cover 95% of needs.

**Priority:** NICE-TO-HAVE. Not worth the complexity for v1.1.

**Complexity:** MEDIUM. Requires a settings UI and keymap storage.

**Recommendation:** Defer. Ship with sensible fixed defaults. Revisit if users request remapping.

---

## 6. View & Workspace Management

### 6A. Custom Workspaces / Panel Layouts

**What competitors do:**

FiftyOne Spaces (since v0.19) allow:
- Multiple panels open simultaneously (Grid, Embeddings, Histograms, Map, Model Evaluation)
- Split panels horizontally or vertically
- Drag tabs between panels
- Save workspace layouts with name, description, and color
- Load saved workspaces programmatically or via UI
- Workspace state includes panel types, sizes, positions, and internal panel state

Encord does not have customizable workspace layouts -- it uses a fixed editor interface.

**What DataVisor has:** Fixed layout with grid view and side-by-side embedding panel.

**Gap:** FiftyOne's workspace system is mature and powerful. However, DataVisor's fixed layout already shows grid + embeddings + sidebar, which covers the primary workflow. Multi-panel workspaces are a power feature with diminishing returns for a personal tool.

**Priority:** NICE-TO-HAVE for v1.1. The current layout works.

**Complexity:** HIGH. Requires a panel framework, drag-and-drop layout, persistence.

**Depends on:** Nothing, but affects all existing UI components.

**Recommendation:** Defer to v1.2+. Focus v1.1 on the single-layout experience with the planned new features (triage mode, evaluation dashboard). If workspaces are ever added, start with a simple tab system rather than full drag-and-drop panels.

---

### 6B. Histograms / Distribution Panels

**What competitors do:**

FiftyOne has a Histograms panel that shows:
- Distribution of any field (class labels, confidence scores, metadata values)
- Interactive: click histogram bars to filter the grid
- Updates automatically as the view changes

Encord Active shows metric distributions for each quality metric.

**What DataVisor has:** Dataset statistics dashboard with class distribution (bar chart) and annotation counts. Not interactive (clicking does not filter).

**Gap:** Interactive histograms that filter the grid are a natural extension of the existing statistics dashboard.

**Priority:** DIFFERENTIATOR -- interactive histograms (click bar to filter) would connect the statistics dashboard to the grid view, enabling quick data exploration by distribution.

**Complexity:** MEDIUM.
- Render histograms for any numeric/categorical field (Recharts, already in stack)
- Click handler: clicking a bar adds a filter to the sidebar
- Bidirectional: changing sidebar filters updates histogram highlighting

**Depends on:** Statistics dashboard (existing). Sidebar filtering (existing). Recharts (existing).

**Recommendation:** Make the existing statistics dashboard interactive. When a user clicks on a class in the distribution chart, filter the grid to that class. When they click a confidence range bar, filter to that range. This requires minimal new UI -- just adding click handlers to existing Recharts components and dispatching filter actions to the Zustand store.

---

### 6C. Map / Geolocation Panel

**What competitors do:**

FiftyOne has a Map panel (Mapbox GL JS) for datasets with GeoLocation fields:
- Scatterplot of sample locations on a map
- Lasso selection on the map filters the grid
- Multiple map types

Encord does not have a map panel.

**What DataVisor has:** No geolocation support.

**Gap:** Only relevant for datasets with GPS metadata (autonomous driving, satellite imagery, drone footage).

**Priority:** NICE-TO-HAVE. Out of scope for v1.1 unless the user's datasets include geolocation.

**Complexity:** MEDIUM. Mapbox GL JS integration, GeoJSON field handling.

**Recommendation:** Defer. Only build if there is a specific need for geolocation-aware datasets.

---

## 7. Advanced Features

### 7A. Model Zoo (Run Inference In-App)

**What competitors do:**

FiftyOne Model Zoo provides:
```python
import fiftyone.zoo as foz
model = foz.load_zoo_model("faster-rcnn-resnet50-fpn-coco-torch")
dataset.apply_model(model, label_field="predictions")
```
- 70+ pre-trained models from PyTorch and TensorFlow
- `apply_model()` runs inference and stores predictions as label fields
- `compute_embeddings()` generates embeddings from any model
- Custom model support via `TorchImageModel` class

Encord integrates models via "Data Agents" for pre-labeling and automated review.

**What DataVisor has:** Import pre-computed predictions (JSON). VLM auto-tagging (Moondream2). No general model inference.

**Gap:** DataVisor imports predictions but does not run inference. Users must run models externally and import results.

**Priority:** NICE-TO-HAVE for v1.1. The import-predictions workflow is sufficient for a personal tool. Running inference adds GPU management complexity.

**Complexity:** HIGH. Model download, GPU scheduling, inference pipeline, result storage.

**Depends on:** Prediction import (existing).

**Recommendation:** Defer. The existing "import predictions" workflow is pragmatic. Running inference is a different product surface. If added later, start with a single model (e.g., YOLOv8) rather than a full zoo.

---

### 7B. Similarity Search UX

**What competitors do:**

FiftyOne supports multiple similarity backends:
- scikit-learn, Qdrant, Redis, Pinecone, MongoDB, Elasticsearch, Milvus, LanceDB
- "Find similar" from any sample: `dataset.sort_by_similarity(sample_id, k=25)`
- Image-level and patch-level (object crop) similarity
- Text-to-image similarity via CLIP embeddings

Encord Active provides similarity search, natural language search, and image-based search.

**What DataVisor has:** Qdrant vector storage for similarity search. The infrastructure exists but there is no "find similar" UI interaction.

**Gap:** The backend capability exists but the UX is missing. Users cannot right-click a sample and say "find similar images."

**Priority:** TABLE STAKES -- the infrastructure is already built. Exposing it via UI is low-hanging fruit with high value.

**Complexity:** LOW. Add a "Find Similar" button/context menu item on each sample that queries Qdrant and updates the grid view.

**Depends on:** Qdrant similarity search (existing). Grid view (existing).

**Recommendation:** Add a "Find Similar" action to the sample detail modal and grid context menu. Query Qdrant for the k nearest neighbors by embedding, display results in the grid. This is one of the highest value-to-effort features available.

---

### 7C. Plugin System Enhancement (Python Panels, Operators)

**What competitors do:**

FiftyOne's plugin system (mature, since v0.17+):
- **Panels:** Full React components embedded in the App, with Python backend logic
- **Python Panels (since v0.25):** Write panels entirely in Python (no JS needed)
- **Operators:** User-facing actions (simple to complex) that can be composed
- Configuration via `fiftyone.yml` manifest
- Plugin marketplace and curated plugin list

**What DataVisor has:** `BasePlugin` class with ingestion/UI/transformation hooks.

**Gap:** DataVisor's plugin system is simpler by design (Python-only). The gap is not in architecture but in ecosystem -- there are no third-party plugins yet.

**Priority:** NICE-TO-HAVE for v1.1. The plugin system exists and works. Enhancements are not urgent.

**Complexity:** Varies by enhancement.

**Recommendation:** No plugin system changes for v1.1. Focus on core features. The existing `BasePlugin` is sufficient for extensibility.

---

### 7D. 3D Visualization (Point Clouds, Meshes)

**What competitors do:**

FiftyOne (since v0.17/0.24): 3D point cloud visualization, 3D bounding boxes, 3D polylines, mesh rendering, orthographic projection in grid view, dedicated 3D visualizer with configurable lights and materials.

Encord (2025): LiDAR point cloud support (.pcd, .ply, .las, .laz, .mcap), sensor fusion visualization.

**What DataVisor has:** 2D images only.

**Gap:** Only relevant for 3D CV datasets (autonomous driving, robotics).

**Priority:** OUT OF SCOPE per PROJECT.md. "3D point cloud visualization -- different rendering pipeline entirely."

**Recommendation:** Defer indefinitely per project constraints.

---

### 7E. Video Support

**What competitors do:**

FiftyOne: Video datasets with frame-by-frame browsing, temporal detection, playback controls (spacebar play/pause, `<`/`>` frame navigation, `0-9` seek).

Encord: Full video annotation with keyframe interpolation, object tracking, temporal ranges.

**What DataVisor has:** Image-only.

**Gap:** Out of scope per PROJECT.md.

**Priority:** OUT OF SCOPE. "Video annotation support -- image-only for now."

**Recommendation:** Defer per project constraints.

---

## 8. Data Operations

### 8A. View Expressions / Advanced Filtering

**What competitors do:**

FiftyOne provides a rich Python API for dataset views:
```python
from fiftyone import ViewField as F

# Chain view stages
view = (
    dataset
    .match_tags("validation")
    .match(F("metadata.size_bytes") >= 48 * 1024)
    .filter_labels("predictions", F("confidence") > 0.8)
    .sort_by("filepath")
    .limit(100)
)
```

View stages include: `match()`, `filter_labels()`, `filter_field()`, `exists()`, `select()`, `exclude()`, `select_fields()`, `exclude_fields()`, `sort_by()`, `limit()`, `skip()`, `take()`, `shuffle()`, `match_tags()`, plus array operations (`.length()`, `.filter()`, `.map()`).

Saved views store the filter rules, not the data -- storage efficient.

**What DataVisor has:** Sidebar metadata filtering (dynamic on any field), search by filename, sort by metadata, saved views. No programmatic view API.

**Gap:** DataVisor's UI-based filtering covers the common cases. The gap is the lack of a programmatic API for complex multi-stage filter chains. This matters for power users who want reproducible, scriptable data exploration.

**Priority:** NICE-TO-HAVE for v1.1. The UI-based filtering covers 90% of use cases. A Python API is a v2 feature.

**Complexity:** HIGH for a full view expression system. LOW for extending the existing filter system.

**Depends on:** Sidebar filtering (existing). DuckDB (existing -- already supports complex SQL).

**Recommendation:** Defer the Python view API. For v1.1, extend the sidebar to support: (a) filter by annotation count, (b) filter by prediction confidence range, (c) filter by error type. These cover the most common advanced filtering needs without a programmatic API.

---

### 8B. Computed / Derived Fields

**What competitors do:**

FiftyOne allows adding computed fields:
```python
dataset.add_sample_field("num_objects", fo.IntField)
dataset.set_values("num_objects", [len(s.ground_truth.detections) for s in dataset])
```
And ViewExpressions for on-the-fly computation:
```python
view = dataset.set_field("quality", F("mistakenness") + F("hardness"))
```

**What DataVisor has:** Metadata fields from ingestion. No user-defined computed fields.

**Gap:** Computed fields are useful for combining multiple metrics into composite scores (like the quality score from 3D).

**Priority:** NICE-TO-HAVE for v1.1. Can be implemented server-side with DuckDB computed columns.

**Complexity:** LOW for server-side computed fields in DuckDB. MEDIUM for exposing in UI.

**Depends on:** DuckDB (existing).

**Recommendation:** Implement the quality score (3D) as a computed field in DuckDB. Do not build a general user-defined field system for v1.1 -- just pre-compute the fields DataVisor needs.

---

## Feature Priority Summary

### Must Build for v1.1 (Table Stakes + High-Value Differentiators)

| # | Feature | Priority | Complexity | Section |
|---|---------|----------|------------|---------|
| 1 | YOLO + VOC format import | Table Stakes | Medium | 1A |
| 2 | Train/val/test split handling | Table Stakes | Medium | 1B |
| 3 | Smart folder detection UI | Differentiator | Medium | 1C |
| 4 | Dataset export (COCO, YOLO) | Table Stakes | Medium | 1E |
| 5 | Bbox editing (move/resize/delete) | Table Stakes | High | 2A |
| 6 | Interactive confusion matrix + click-to-filter | Table Stakes | High | 3A |
| 7 | Near-duplicate detection | Table Stakes | Low | 3B |
| 8 | Image quality metrics (brightness, sharpness) | Table Stakes | Low | 3B |
| 9 | Error triage mode (keyboard review workflow) | Differentiator | Medium | 3C |
| 10 | Worst images composite ranking | Differentiator | Medium | 3D |
| 11 | Docker deployment | Table Stakes | Medium | 4A |
| 12 | Basic auth | Table Stakes | Low | 4B |
| 13 | Deployment scripts (local + GCP) | Table Stakes | Low-Medium | 4C |
| 14 | Keyboard shortcuts (Tier 1) | Table Stakes | Medium | 5A |
| 15 | "Find Similar" UI button | Table Stakes | Low | 7B |
| 16 | Interactive histograms (click-to-filter) | Differentiator | Medium | 6B |

### Defer to v1.2+

| # | Feature | Why Defer | Section |
|---|---------|-----------|---------|
| 17 | Create new annotations | Quick corrections (edit/delete) are sufficient for v1.1 | 2B |
| 18 | CVAT/Label Studio integration | Export to COCO format achieves same goal | 2C |
| 19 | PR curves + per-class AP | Confusion matrix is the priority; curves follow naturally | 3A |
| 20 | Mistakenness / hardness scoring | Requires model logits import schema | 3B |
| 21 | Custom workspaces | Current layout works; panels are a large refactor | 6A |
| 22 | Customizable hotkeys | Fixed defaults are sufficient | 5B |
| 23 | Model zoo / in-app inference | Import predictions workflow is pragmatic | 7A |
| 24 | View expression Python API | UI filtering covers 90% of use cases | 8A |
| 25 | Demo / quickstart dataset | Low effort but not core to v1.1 delivery | 1D |

### Explicitly Out of Scope

| Feature | Reason | Section |
|---------|--------|---------|
| 3D point cloud visualization | Different rendering pipeline, per PROJECT.md | 7D |
| Video support | Image-only, per PROJECT.md | 7E |
| Map / geolocation panel | No current need for geo datasets | 6C |
| Multi-user auth / RBAC | Personal tool, per PROJECT.md | 4B |
| Plugin system overhaul | Existing BasePlugin is sufficient | 7C |

---

## Feature Dependencies (v1.1 Build Order)

```
[Docker + Auth + Deploy Scripts]  (parallel with everything)
     |
     v
[YOLO + VOC Parsers] ──> [Smart Folder Detection UI] ──> [Split Handling]
     |
     v
[Dataset Export]  (requires format writers from parsers)
     |
     v
[Image Quality Metrics] ──> [Near-Duplicate Detection] ──> [Composite Score]
     |                                                          |
     v                                                          v
[Bbox Editing in Modal] ──> [Keyboard Shortcuts] ──> [Error Triage Mode]
     |                                                          |
     v                                                          v
[Interactive Confusion Matrix] ──────────────────────> [Click-to-Filter]
     |
     v
[Interactive Histograms]
     |
     v
["Find Similar" Button]  (uses existing Qdrant infrastructure)
```

**Critical path:** Docker/Auth and Format Parsers can start simultaneously. Most features build on existing infrastructure (DuckDB, Qdrant, Zustand stores). The confusion matrix and triage mode are the two highest-complexity features and should be prioritized early in development.

---

## Sources

### FiftyOne (HIGH confidence -- official documentation)
- [FiftyOne Import Datasets (v1.12.0)](https://docs.voxel51.com/user_guide/import_datasets.html)
- [FiftyOne Export Datasets (v1.11.1)](https://docs.voxel51.com/user_guide/export_datasets.html)
- [FiftyOne Using Datasets (v1.12.0)](https://docs.voxel51.com/user_guide/using_datasets.html)
- [FiftyOne Dataset Views (v1.12.0)](https://docs.voxel51.com/user_guide/using_views.html)
- [FiftyOne App (v1.12.0)](https://docs.voxel51.com/user_guide/app.html)
- [FiftyOne Evaluation (v1.11.1)](https://docs.voxel51.com/user_guide/evaluation.html)
- [FiftyOne Brain](https://docs.voxel51.com/brain.html)
- [FiftyOne Annotation (v1.11.0)](https://docs.voxel51.com/user_guide/annotation.html)
- [FiftyOne Environments](https://docs.voxel51.com/installation/environments.html)
- [FiftyOne Model Zoo (v1.11.1)](https://docs.voxel51.com/model_zoo/index.html)
- [FiftyOne Dataset Zoo (v1.11.1)](https://docs.voxel51.com/dataset_zoo/datasets.html)
- [FiftyOne Plugins Development (v1.11.1)](https://docs.voxel51.com/plugins/developing_plugins.html)
- [FiftyOne Interactive Plots (v1.12.0)](https://docs.voxel51.com/user_guide/plots.html)
- [FiftyOne Enterprise Helm Chart](https://helm.fiftyone.ai/)
- [FiftyOne Teams Deployment (GitHub)](https://github.com/voxel51/fiftyone-teams-app-deploy)

### FiftyOne (MEDIUM confidence -- blog posts, GitHub issues)
- [FiftyOne v0.24 Announcement (3D, Workspaces)](https://voxel51.com/blog/announcing-fiftyone-0-24-with-3d-meshes-and-custom-workspaces)
- [FiftyOne v0.25 Announcement (Python Panels, SAM 2)](https://voxel51.com/blog/announcing-fiftyone-0-25)
- [FiftyOne GitHub Issue #2120 (Selection shortcut FR)](https://github.com/voxel51/fiftyone/issues/2120)
- [FiftyOne GitHub Issue #1761 (Hide labels shortcut FR)](https://github.com/voxel51/fiftyone/issues/1761)
- [FiftyOne GitHub Issue #1780 (from_dir failure bug)](https://github.com/voxel51/fiftyone/issues/1780)
- [FiftyOne GitHub Issue #1781 (VOC same-directory bug)](https://github.com/voxel51/fiftyone/issues/1781)
- [FiftyOne Model Evaluation Blog](https://voxel51.com/blog/unified-model-insights-with-fiftyone-model-evaluation-workflows)

### Encord (HIGH confidence -- official documentation)
- [Encord Getting Started](https://docs.encord.com/platform-documentation/GettingStarted/gettingstarted-welcome)
- [Encord Annotate Overview](https://docs.encord.com/platform-documentation/Annotate/annotate-overview)
- [Encord Label Editor](https://docs.encord.com/platform-documentation/Annotate/annotate-label-editor)
- [Encord Editor Shortcuts](https://docs.encord.com/platform-documentation/Annotate/annotate-label-editor/annotate-label-editor-settings-shortcuts)
- [Encord Active Overview](https://docs.encord.com/platform-documentation/Active/active-overview)
- [Encord Active Issue Shortcuts](https://docs.encord.com/platform-documentation/Active/active-basics/active-issue-shortcuts-prediction-types)
- [Encord Active Model Quality Metrics](https://docs.encord.com/platform-documentation/Active/active-quality-metrics/active-model-quality-metrics)
- [Encord 2025 Release Notes](https://docs.encord.com/release-notes/releasenotes-2025)

### Encord (MEDIUM confidence -- marketing/blog)
- [Encord Product Updates Feb 2025](https://encord.com/blog/encord-product-updates-february-2025/)
- [Encord Data Quality Metrics Blog](https://encord.com/blog/data-quality-metrics/)
- [Encord Annotate Product Page](https://encord.com/annotate/)

---
*Competitive feature analysis for: DataVisor v1.1 vs FiftyOne (Voxel51) + Encord*
*Researched: 2026-02-12*
