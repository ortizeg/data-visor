# Roadmap: DataVisor

## Milestones

- v1.0 MVP - Phases 1-7 (shipped 2026-02-12) — [archive](.planning/milestones/v1.0-ROADMAP.md)
- v1.1 Deployment, Workflow & Competitive Parity - Phases 8-14 (shipped 2026-02-13) — [archive](.planning/milestones/v1.1-ROADMAP.md)
- v1.2 Classification Dataset Support - Phases 15-17 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-7) - SHIPPED 2026-02-12</summary>

### Phase 1: Data Foundation
**Goal**: DuckDB-backed streaming ingestion pipeline for COCO datasets at 100K+ scale
**Plans**: 4 plans (complete)

### Phase 2: Visual Grid
**Goal**: Virtualized infinite-scroll grid with SVG annotation overlays
**Plans**: 3 plans (complete)

### Phase 3: Filtering & Search
**Goal**: Full metadata filtering, search, saved views, and bulk tagging
**Plans**: 2 plans (complete)

### Phase 4: Predictions & Comparison
**Goal**: Model prediction import with GT vs Predictions comparison
**Plans**: 3 plans (complete)

### Phase 5: Embeddings & Visualization
**Goal**: DINOv2 embeddings with t-SNE reduction and deck.gl scatter plot
**Plans**: 4 plans (complete)

### Phase 6: Error Analysis & Similarity
**Goal**: Error categorization pipeline and Qdrant-powered similarity search
**Plans**: 2 plans (complete)

### Phase 7: Intelligence & Agents
**Goal**: Pydantic AI agent for error patterns and Moondream2 VLM auto-tagging
**Plans**: 3 plans (complete)

</details>

<details>
<summary>v1.1 Deployment, Workflow & Competitive Parity (Phases 8-14) - SHIPPED 2026-02-13</summary>

### Phase 8: Docker Deployment & Auth
**Goal**: Deployable Docker stack with single-user auth, accessible on cloud VM or locally
**Plans**: 5 plans (complete)

### Phase 9: Smart Ingestion
**Goal**: No-code dataset import from folder path with auto-detection and confirmation
**Plans**: 2 plans (complete)

### Phase 10: Annotation Editing
**Goal**: Move, resize, delete, and draw bounding boxes via react-konva in sample detail modal
**Plans**: 3 plans (complete)

### Phase 11: Error Triage
**Goal**: Tag errors, highlight mode, and worst-images ranking with DuckDB persistence
**Plans**: 2 plans (complete)

### Phase 12: Interactive Viz & Discovery
**Goal**: Confusion matrix, near-duplicates, interactive histograms, and find-similar
**Plans**: 3 plans (complete)

### Phase 13: Keyboard Shortcuts
**Goal**: Keyboard navigation, triage hotkeys, edit shortcuts, and help overlay
**Plans**: 2 plans (complete)

### Phase 14: Per-Annotation Triage
**Goal**: Auto-discover TP/FP/FN per bounding box via IoU overlap, color-coded boxes in detail modal, click to override classifications
**Plans**: 3 plans (complete)

</details>

### v1.2 Classification Dataset Support (In Progress)

**Milestone Goal:** First-class single-label classification dataset support with full feature parity to detection workflows -- from ingestion through evaluation to polish.

#### Phase 15: Classification Ingestion & Display
**Goal**: Users can import, browse, and inspect classification datasets with the same ease as detection datasets
**Depends on**: Phase 14 (existing codebase)
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04, DISP-01, DISP-02, DISP-03, DISP-04
**Success Criteria** (what must be TRUE):
  1. User can point the ingestion wizard at a folder with JSONL annotations and images, and the system auto-detects it as a classification dataset
  2. User can import multi-split classification datasets (train/valid/test) in a single operation, just like detection datasets
  3. User sees class label badges on grid thumbnails instead of bounding box overlays when browsing a classification dataset
  4. User sees GT class label prominently in the sample detail modal and can change it via a dropdown
  5. Statistics dashboard shows classification-appropriate metrics (labeled images count, class distribution) with no detection-only elements visible (no bbox area histogram, no IoU slider)
**Plans**: 2 plans (complete)
Plans:
- [x] 15-01-PLAN.md -- Backend: schema migration, ClassificationJSONLParser, FolderScanner detection, IngestionService dispatch, API endpoints
- [x] 15-02-PLAN.md -- Frontend: type updates, grid class badges, detail modal class label/dropdown, classification-aware statistics

#### Phase 16: Classification Evaluation
**Goal**: Users can import predictions and analyze classification model performance with accuracy, F1, confusion matrix, and error categorization
**Depends on**: Phase 15
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05
**Success Criteria** (what must be TRUE):
  1. User can import classification predictions in JSONL format with confidence scores and see them alongside ground truth
  2. User sees accuracy, macro F1, weighted F1, and per-class precision/recall/F1 metrics in the evaluation panel
  3. User sees a confusion matrix and can click any cell to filter the grid to images with that GT/predicted class pair
  4. User sees each image categorized as correct, misclassified, or missing prediction in the error analysis view
  5. User sees GT vs predicted label comparison on grid thumbnails and in the detail modal
**Plans**: 2 plans (complete)
Plans:
- [x] 16-01-PLAN.md -- Backend: classification prediction parser, evaluation service, error analysis service, endpoint routing
- [x] 16-02-PLAN.md -- Frontend: types, hooks, prediction import dialog, evaluation panel, error analysis panel, grid badges

#### Phase 17: Classification Polish
**Goal**: Classification workflows are production-ready for high-cardinality datasets (43+ classes) with visual aids that surface actionable insights
**Depends on**: Phase 16
**Requirements**: POLISH-01, POLISH-02, POLISH-03, POLISH-04
**Success Criteria** (what must be TRUE):
  1. Confusion matrix renders readably at 43+ classes with threshold filtering and overflow handling
  2. User can color the embedding scatter plot by GT class, predicted class, or correct/incorrect status
  3. User sees a ranked list of most-confused class pairs derived from the confusion matrix
  4. User sees per-class performance sparklines with color-coded thresholds (green/yellow/red) in the metrics table
**Plans**: 2 plans
Plans:
- [ ] 17-01-PLAN.md -- Confusion matrix threshold/overflow, most-confused pairs, F1 bars in per-class table
- [ ] 17-02-PLAN.md -- Embedding scatter color modes (GT class, predicted class, correct/incorrect)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Data Foundation | v1.0 | 4/4 | Complete | 2026-02-10 |
| 2. Visual Grid | v1.0 | 3/3 | Complete | 2026-02-10 |
| 3. Filtering & Search | v1.0 | 2/2 | Complete | 2026-02-11 |
| 4. Predictions & Comparison | v1.0 | 3/3 | Complete | 2026-02-11 |
| 5. Embeddings & Visualization | v1.0 | 4/4 | Complete | 2026-02-11 |
| 6. Error Analysis & Similarity | v1.0 | 2/2 | Complete | 2026-02-12 |
| 7. Intelligence & Agents | v1.0 | 3/3 | Complete | 2026-02-12 |
| 8. Docker Deployment & Auth | v1.1 | 5/5 | Complete | 2026-02-12 |
| 9. Smart Ingestion | v1.1 | 2/2 | Complete | 2026-02-12 |
| 10. Annotation Editing | v1.1 | 3/3 | Complete | 2026-02-12 |
| 11. Error Triage | v1.1 | 2/2 | Complete | 2026-02-12 |
| 12. Interactive Viz & Discovery | v1.1 | 3/3 | Complete | 2026-02-13 |
| 13. Keyboard Shortcuts | v1.1 | 2/2 | Complete | 2026-02-13 |
| 14. Per-Annotation Triage | v1.1 | 3/3 | Complete | 2026-02-13 |
| 15. Classification Ingestion & Display | v1.2 | 2/2 | Complete | 2026-02-18 |
| 16. Classification Evaluation | v1.2 | 2/2 | Complete | 2026-02-18 |
| 17. Classification Polish | v1.2 | 0/2 | Not started | - |
