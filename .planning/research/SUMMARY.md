# Project Research Summary

**Project:** DataVisor - Classification Dataset Support (v1.2)
**Domain:** Single-label image classification integration into existing detection-centric CV dataset tool
**Researched:** 2026-02-18
**Confidence:** HIGH

## Executive Summary

DataVisor is adding single-label classification dataset support to an existing detection-focused architecture. The research finding that most shapes this work: zero new dependencies are required. The existing stack (scikit-learn, Pillow, DuckDB, Recharts, Tailwind, SVG overlays) already covers every classification need. The complexity is entirely in the plumbing -- threading a `dataset_type` discriminator through every layer of the stack: schema, ingestion parsers, evaluation services, API response models, and frontend rendering. This is not a net-new feature; it is a well-scoped extension of an established codebase.

The recommended approach is `dataset_type`-gated dispatch: add a `dataset_type VARCHAR DEFAULT 'detection'` column to the `datasets` table, detect the JSONL format in `FolderScanner`, dispatch to a new `ClassificationParser` in `IngestionService`, branch evaluation at the router level into a separate `compute_classification_evaluation()` function (scikit-learn accuracy/F1/confusion matrix -- no IoU), and conditionally render class label badges instead of SVG bbox overlays in the frontend. This is clean, does not touch existing detection code paths, and leaves existing detection datasets completely unaffected by the migration.

The top risk is schema design: making bbox columns nullable or reusing sentinel values (0,0,0,0) in the `annotations` table forces every downstream consumer to defend against null/zero bboxes. There are 30+ bbox references across the codebase. The recommended approach is sentinel values (0.0, never NULL) combined with `dataset_type`-aware dispatch -- never calling detection evaluation or bbox-dependent rendering for classification datasets. The alternative (separate `classifications` table) is architecturally cleaner but adds parallel query paths in every service. Both are viable; the implementation team must decide before writing any ingestion code, as changing it later is a rewrite.

## Key Findings

### Recommended Stack

Classification support requires no new libraries. The work is entirely architectural -- extending parsers, adapting the DB schema, branching evaluation logic, and conditionally rendering overlays. Python's built-in `json.loads()` per line handles JSONL (line-delimited JSON); `ijson` streaming is unnecessary. scikit-learn's `classification_report()` and `confusion_matrix()` cover all metric needs. The existing `confusion-matrix.tsx` component accepts generic `number[][]` and needs no changes. Annotation overlays branch on `bbox_w === 0` (or `datasetType === "classification"`) to render a class label badge vs an SVG rect. No new `pip` packages. No new `npm` packages.

**Core technologies (no changes to existing dependencies):**
- `json` stdlib: JSONL parsing -- line-by-line `json.loads()`, no streaming library needed
- `scikit-learn>=1.8.0`: Accuracy, Macro/Weighted F1, per-class P/R/F1, confusion matrix -- already installed
- `pillow>=12.1.1`: Image dimension reading for classification JSONL (which omits width/height) -- already installed
- `duckdb>=1.4.4`: One new column (`dataset_type`) via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` -- follows existing migration pattern
- `recharts>=3.7.0` + React/Tailwind: Conditional rendering in evaluation panel and overlays -- no new chart types

**New files to create (backend):**
- `app/ingestion/classification_parser.py` -- JSONL parser implementing `BaseParser`
- `app/services/classification_evaluation.py` -- accuracy/F1/confusion matrix, separate from detection evaluation
- `app/models/classification_evaluation.py` -- `ClassificationEvaluationResponse` Pydantic model

**New files to create (frontend):**
- `src/components/grid/classification-label.tsx` -- class label pill overlay for grid cells and modal

See `.planning/research/STACK.md` for full file-level modification list (9 backend files, 15+ frontend files).

### Expected Features

Classification support breaks into three natural groups by user need: data ingestion and browsing, evaluation and error analysis, and polish/differentiators.

**Must have (table stakes):**
- TS-1: JSONL ingestion parser + `dataset_type` schema extension -- nothing else works without classification data in the database
- TS-2: Class label badge on thumbnails -- users expect to see the class label on the image; without it the tool shows unlabeled images
- TS-3: Classification evaluation metrics (accuracy, macro F1, weighted F1, per-class P/R/F1) -- the universal expectation for any classification tool
- TS-4: Classification confusion matrix -- the primary diagnostic tool for classification; existing component reused, no background row/column
- TS-5: Classification error analysis (Correct / Misclassified / Missing Prediction) -- simpler than detection; replaces IoU-based TP/FP/FN categories
- TS-6: Classification prediction import (JSONL or CSV format) -- required to enable any GT-vs-prediction workflow
- TS-7: Sample detail modal adaptation -- class label display, class change dropdown, no bbox editor
- TS-8: Statistics dashboard adaptation -- relabel "annotations" as "labeled images", remove bbox area histogram, hide IoU slider

**Should have (differentiators):**
- D-1: Misclassification drill-down view -- click confusion matrix cell to see all images with GT=class_i, predicted=class_j; "most confused pairs" is the single most actionable classification view
- D-2: Per-class performance sparklines in the metrics table -- color-coded bars (green/yellow/red) for P/R/F1 per class
- D-5: Embedding scatter coloring by correct/incorrect -- misclassified samples shown as red dots over the t-SNE; deep-inside-cluster mistakes reveal label errors

**Defer (v2+):**
- Multi-label classification (different data model, different metrics, different UI -- scope explosion)
- Top-K evaluation (requires importing full probability distributions per image)
- PR curves for classification (confusion matrix + per-class P/R table are more informative)
- D-3: Confidence calibration / reliability diagram
- D-4: Per-split comparison table

**Anti-features (explicitly avoid for this milestone):**
- mAP for classification -- wrong metric, confuses users
- IoU threshold slider for classification datasets -- meaningless, hide it
- Detection-specific error categories ("Hard FP") for classification -- no spatial component

See `.planning/research/FEATURES.md` for the full feature dependency graph and MVP recommendation.

### Architecture Approach

The `dataset_type` column on `datasets` is the single source of truth for conditional behavior across all layers. The pattern is: detect format in `FolderScanner` -> dispatch parser via a registry in `IngestionService` -> set `dataset_type` on the dataset record -> thread `dataset_type` through API responses to the frontend -> branch evaluation at the router into separate detection/classification functions -> conditionally render badge vs bbox overlay in components. No polymorphism needed; simple if/else at well-defined boundary points.

**Major components:**
1. `FolderScanner` (modified) -- adds `_is_classification_jsonl()` detection before falling through to COCO; `ScanResult.format` becomes `"coco" | "classification_jsonl"` (already supports arbitrary strings)
2. Parser registry in `IngestionService` (modified) -- maps format strings to parser classes; `ClassificationParser` implements `BaseParser` with sentinel bbox values (0.0) and one annotation per sample
3. `duckdb_repo.py:initialize_schema()` (modified) -- one `ALTER TABLE datasets ADD COLUMN IF NOT EXISTS dataset_type VARCHAR DEFAULT 'detection'`; no changes to `annotations` table
4. `compute_classification_evaluation()` (new) -- separate from 560-line detection evaluation; ~50 lines using scikit-learn; router branches on `dataset_type` before calling any detection logic
5. `ClassificationEvaluationResponse` (new) -- separate Pydantic model with `accuracy`, `macro_f1`, `weighted_f1`, `per_class_metrics`, `confusion_matrix`; discriminated union in frontend TypeScript types
6. `AnnotationOverlay` (modified) -- branches on `datasetType === "classification"` to render class label pill vs SVG rect; `datasetType` prop threaded from page-level dataset query

**Patterns to follow:**
- Thread `datasetType` from the top-level dataset query through props; never re-fetch inside child components
- Parser registry for format dispatch, not hardcoded `COCOParser()`
- One annotation per sample for classification -- `GROUP BY sample_id LIMIT 1` is safe; no IoU matching needed
- Branch at boundaries (router, page), not inside leaf components/queries

**Anti-patterns to avoid:**
- Separate tables per task type (doubles query maintenance surface)
- Stuffing classification metrics into detection response fields (field names become lies)
- Making `compute_evaluation()` handle both types (grafts classification into 560 lines of spatial detection logic)
- Frontend feature detection via `annotations[0]?.bbox_x === null` (fragile; fails on empty samples)

See `.planning/research/ARCHITECTURE.md` for full component inventory and suggested build order.

### Critical Pitfalls

1. **Schema pollution via nullable/sentinel bbox columns** -- If bbox columns become nullable, 30+ codebase references must each guard against NULL. If sentinel values (0,0,0,0) are used without `dataset_type`-aware dispatch, the detection evaluation computes IoU on zero-size boxes (NaN/0) and the overlay renders invisible 0-area rects. Prevention: use sentinel values (0.0) AND `dataset_type`-gated code paths that never invoke bbox-dependent logic for classification datasets. Decide the schema approach before writing any parser code; changing it later is a codebase-wide rewrite.

2. **Metric confusion -- IoU/mAP leaking into classification evaluation** -- The entire `evaluation.py` (560 lines) is IoU-centric. Passing classification data through it produces nonsensical mAP scores. The `supervision` library expects `xyxy` bounding boxes. Prevention: separate `compute_classification_evaluation()` function; router branches before any detection logic runs. The classification evaluation should be ~50 lines, not a modified version of 560.

3. **UI conditional spaghetti** -- 10+ frontend components each need different rendering for classification vs detection. If scattered `if (taskType === 'classification')` checks accumulate without a clear pattern, adding a third task type (segmentation) becomes a codebase-wide search-and-update problem. Prevention: thread `datasetType` as a prop from the page; branch at component boundaries (`AnnotationOverlay`, `EvaluationPanel`), not inside individual render expressions deep in the tree. Audit: if `taskType` checks exceed 10, the abstraction is wrong.

4. **Breaking existing detection workflows via schema migration** -- DuckDB's `ALTER COLUMN DROP NOT NULL` support varies by version. A failed migration leaves the schema partially altered with no rollback. Prevention: never change existing column constraints; use only `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (the existing migration pattern). Use sentinel bbox values (0.0) for classification, not NULL.

5. **Confusion matrix scaling for 43+ classes** -- The current confusion matrix renders as an HTML table with 32px-minimum cells. A 43-class matrix = 1,849 cells = 1,408px minimum width, unreadable on any screen. Prevention: add a "top confused pairs" ranked list as the default view; make the full NxN matrix opt-in (or canvas-rendered); threshold filter to hide cells below N occurrences.

See `.planning/research/PITFALLS.md` for 15 pitfalls including moderate (format detection false positives, annotation triage, one-annotation-per-image enforcement, prediction format mismatch) and minor (class imbalance visualization, second-system over-generalization).

## Implications for Roadmap

Based on combined research, the feature dependency graph and architecture's stated build order converge on a 3-phase structure. The critical path is: schema + ingestion -> display -> evaluation. Evaluation features are all blocked on having classification data in the database and having a prediction import path.

### Phase 1: Foundation -- Schema, Ingestion, and Display

**Rationale:** Everything else is blocked on this. The `dataset_type` column must exist before any parser can set it. The parser must run before any data appears in the database. The frontend badge must render before users can browse the dataset meaningfully. This phase has no external unknowns -- all implementation details are confirmed from direct codebase inspection.

**Delivers:** A classification dataset can be scanned, ingested, browsed in the image grid, and inspected in the sample modal. The statistics dashboard shows class distribution and labeled image counts.

**Addresses features:**
- TS-1: JSONL ingestion parser + schema extension (`dataset_type` column, `ClassificationParser`, format auto-detection in `FolderScanner`)
- TS-2: Class label badge on thumbnails (`classification-label.tsx`, `AnnotationOverlay` conditional branch)
- TS-7: Sample detail modal adaptation (no bbox editor, class label display, class change dropdown)
- TS-8: Statistics dashboard adaptation (relabeled metrics, no bbox area histogram, hidden IoU slider)

**Avoids pitfalls:**
- P1 (schema pollution): sentinel bbox 0.0 + `dataset_type`-gated dispatch; never nullable
- P4 (breaking existing detection): `ADD COLUMN IF NOT EXISTS` only; no `ALTER COLUMN`
- P6 (format detection false positives): new `_is_classification_jsonl()` before COCO fallthrough
- P9 (multi-label enforcement): parser validates one annotation per `sample_id` per source
- P3 (UI spaghetti early signal): establish the `datasetType` prop threading pattern here; don't let conditionals scatter

**Research flag:** Standard patterns -- skip `/gsd:research-phase`. All implementation details are clear from direct codebase inspection. Zero implementation ambiguity.

---

### Phase 2: Evaluation and Error Analysis

**Rationale:** Blocked on Phase 1 (needs classification data in DB and a prediction import path). Evaluation is the core analytical value of DataVisor. Classification evaluation is dramatically simpler than detection (no IoU, ~50 lines) but the API contract must be clean from the start to avoid frontend confusion.

**Delivers:** Users can import classification predictions, view accuracy/F1 metrics, explore the confusion matrix, and identify misclassified images via error analysis. The triage system works for classification (correct/incorrect per image, not per-bbox IoU).

**Addresses features:**
- TS-6: Classification prediction import (JSONL/CSV, one row per image)
- TS-3: Classification evaluation metrics (accuracy, macro F1, weighted F1, per-class P/R/F1)
- TS-4: Classification confusion matrix adaptation (no background row/col; existing click-to-filter works as-is)
- TS-5: Classification error analysis (Correct / Misclassified / Missing Prediction)

**Avoids pitfalls:**
- P2 (metric confusion): separate `compute_classification_evaluation()`; router branches before detection logic
- P7 (triage assumes IoU): new `match_classification_annotations()` with sample_id equality matching, not IoU
- P8 (error categories don't map): new `categorize_classification_errors()` with classification-specific categories
- P10 (API response leakage): `ClassificationEvaluationResponse` is a separate Pydantic model

**Uses from stack:**
- `sklearn.metrics.classification_report()` and `confusion_matrix()` -- one function call replaces 560 lines of detection evaluation
- TypeScript discriminated union: `DetectionEvaluationResponse | ClassificationEvaluationResponse`

**Research flag:** Standard patterns -- skip `/gsd:research-phase`. Classification evaluation is textbook scikit-learn usage. The router branching pattern is explicitly designed in ARCHITECTURE.md.

---

### Phase 3: Polish and Differentiators

**Rationale:** Table stakes (Phases 1-2) make the product functional. This phase makes it useful in practice for high-cardinality classification datasets like jersey numbers (43 classes). The confusion matrix scaling issue will surface immediately with real data. The misclassification drill-down and embedding coloring are the features that make DataVisor more useful than just running `sklearn.metrics.classification_report()` locally.

**Delivers:** The confusion matrix is readable at 43 classes. Per-class metrics have visual encoding (color-coded bars). Misclassified images are accessible via drill-down from the confusion matrix. Embedding scatter shows misclassification status.

**Addresses features:**
- D-1: Misclassification drill-down view (click confusion matrix cell -> filtered sample view with both labels, sorted by confidence)
- D-2: Per-class sparklines in metrics table (color-coded P/R/F1 bars)
- D-5: Embedding scatter coloring by correct/incorrect (existing scatter, new color mode toggle)

**Avoids pitfalls:**
- P5 (confusion matrix scaling at 43+ classes): "top confused pairs" ranked list as default; full matrix opt-in
- P11 (class imbalance visualization for 43+ bars): sortable table view, log-scale option for bar chart
- P3 (UI spaghetti audit): count all `taskType` conditional checks; if > 10, refactor to a `useTaskAdapter` hook
- P13 (second system effect): explicitly defer segmentation support and any task-type plugin system

**Research flag:** Confusion matrix canvas rendering for large matrices may need brief investigation if the HTML table approach proves unworkable. All other features in this phase use existing components (scatter plot, filter system, Recharts tables). Consider a quick prototype before committing to the HTML table approach for 43+ classes.

---

### Phase Ordering Rationale

- **Schema first:** The `dataset_type` column and `ClassificationParser` are shared foundations for all downstream phases. No other work can proceed without classification data in the database.
- **Display before evaluation:** Users need to browse and verify that classification data ingested correctly before attempting evaluation. This also surfaces ingestion bugs early when they are cheap to fix.
- **Evaluation before polish:** The core GT-vs-predictions workflow must work before investing in visualization enhancements. D-1 (drill-down) depends on TS-4 (confusion matrix) which depends on TS-3 (evaluation).
- **Parallelizable within Phase 1:** TS-2 (badge), TS-7 (modal), and TS-8 (stats dashboard) can be built concurrently once TS-1 (parser + schema) is complete.
- **Parallelizable within Phase 2:** TS-6 (prediction import) and TS-5 (error analysis) can proceed in parallel once TS-3 (evaluation metrics) is done.

### Research Flags

**Phases likely needing `/gsd:research-phase` during planning:**
- None identified. All implementation details are grounded in direct codebase inspection. The research team confirmed exact function signatures, component props, and SQL schema for all referenced files.

**One item to confirm at Phase 1 implementation start (not a blocker):**
- DuckDB `ALTER COLUMN DROP NOT NULL` syntax: MEDIUM confidence. The recommended approach (sentinel 0.0 values, never NULL) avoids this entirely. If the team decides nullable bbox columns are preferred for semantic cleanliness, verify DuckDB version support before committing.

**Phases with standard patterns (skip research-phase):**
- Phase 1: JSONL parsing, `BaseParser` extension, idempotent column migration -- all established patterns in the existing codebase
- Phase 2: scikit-learn classification metrics, router branching, Pydantic discriminated unions -- textbook patterns
- Phase 3: Recharts table customization, existing scatter plot coloring, confusion matrix threshold filtering -- existing component extension

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Direct codebase inspection confirmed all dependencies are already installed. Zero new packages needed. |
| Features | HIGH | FiftyOne, Roboflow, Cleanlab, Google ML docs all confirm the same feature expectations. Classification metrics are industry-standard. |
| Architecture | HIGH | All architectural decisions grounded in actual codebase files. Component interfaces and SQL schema inspected directly. One MEDIUM item: DuckDB nullable column ALTER syntax. |
| Pitfalls | HIGH | All 15 pitfalls are grounded in specific files and line numbers in the actual codebase, not theoretical risks. |

**Overall confidence:** HIGH

### Gaps to Address

- **Schema decision -- sentinel vs nullable bbox:** Both STACK.md and PITFALLS.md recommend sentinel values (0.0) to avoid nullable bbox complexity. ARCHITECTURE.md leans toward nullable for semantic cleanliness. The team must make one decision before Phase 1 implementation. Recommendation: sentinel values (simpler, zero migration risk to existing data, no DuckDB ALTER version concerns).

- **DuckDB `ALTER COLUMN DROP NOT NULL` syntax:** The recommended architecture avoids this by using sentinel values instead of NULL. If nullable columns are chosen, verify DuckDB ALTER syntax for the installed version before implementation begins. Fallback: recreate the table with nullable columns if ALTER fails.

- **Roboflow JSONL format completeness:** Research confirmed `{"image":"filename.jpg","prefix":"prompt","suffix":"class_label"}` as the target format. Validate against an actual Roboflow classification export before finalizing the parser -- optional fields (e.g., split, confidence) may be present and should be handled gracefully.

- **Confusion matrix at 43+ classes -- canvas vs HTML table:** The HTML table approach with 1,849 cells may be acceptable with CSS overflow and threshold filtering. Prototype this early in Phase 3 to decide if a canvas-based renderer is needed, rather than discovering it at the end of the phase.

## Sources

### Primary (HIGH confidence)
- DataVisor codebase -- direct inspection of `duckdb_repo.py`, `evaluation.py`, `coco_parser.py`, `base_parser.py`, `folder_scanner.py`, `annotation-overlay.tsx`, `grid-cell.tsx`, `sample-modal.tsx`, `statistics.py`, `evaluation-panel.tsx`, `annotation.ts`, `evaluation.ts`
- scikit-learn stable documentation -- `classification_report()`, `confusion_matrix()`, `precision_recall_fscore_support()`
- FiftyOne official documentation -- `evaluate_classifications()` API, classification label rendering conventions, evaluate_classifications tutorial
- Cleanlab official documentation -- image classification tutorial, datalab image issues
- Google ML Crash Course -- classification metrics definitions (accuracy, precision, recall, F1)
- Evidently AI -- multi-class metrics reference

### Secondary (MEDIUM confidence)
- Roboflow classification export format -- confirmed via user-provided sample data; may have undocumented optional fields
- DuckDB ALTER TABLE behavior -- general knowledge; version-specific behavior should be verified at implementation time

### Tertiary (LOW confidence)
- None -- all findings are grounded in HIGH or MEDIUM sources

---
*Research completed: 2026-02-18*
*Ready for roadmap: yes*
