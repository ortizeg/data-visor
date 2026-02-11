# Roadmap: VisionLens

## Overview

VisionLens replaces scattered CV scripts with a unified dataset introspection tool. The roadmap moves from data foundation (DuckDB + streaming ingestion) through visual browsing and filtering, then branches into parallel tracks for model predictions and embedding visualization, before converging on error analysis and the novel AI agent layer. Seven phases deliver all 26 v1 requirements, with Phases 4 and 5 executable in parallel.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Data Foundation** - DuckDB-backed ingestion pipeline with streaming COCO parser, image serving, and plugin architecture
- [ ] **Phase 2: Visual Grid** - Virtualized image grid with annotation overlays and deterministic color hashing
- [ ] **Phase 3: Filtering & Search** - Sidebar metadata filters, search/sort, saved views, and tagging
- [ ] **Phase 4: Predictions & Comparison** - Import model predictions, GT vs Predictions toggle, dataset statistics
- [ ] **Phase 5: Embeddings & Visualization** - Embedding generation, deck.gl scatter plot, lasso-to-grid filtering
- [ ] **Phase 6: Error Analysis & Similarity** - Error categorization pipeline and Qdrant-powered similarity search
- [ ] **Phase 7: Intelligence & Agents** - Pydantic AI agent for pattern detection, action recommendations, VLM auto-tagging

## Phase Details

### Phase 1: Data Foundation
**Goal**: Users can load a COCO dataset from local disk or GCS and have all metadata queryable in DuckDB with cached thumbnails ready for display
**Depends on**: Nothing (first phase)
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05, PLUGIN-01
**Success Criteria** (what must be TRUE):
  1. User can point VisionLens at a COCO JSON file (100K+ annotations) and it ingests without OOM via streaming parser
  2. User can load images from both a local directory and a GCS bucket using the same interface
  3. Thumbnails are generated and cached during ingestion so subsequent browsing is instant
  4. All sample metadata (filenames, dimensions, classes, splits) is stored in DuckDB and queryable via the API
  5. A BasePlugin Python class exists with defined extension points that a developer can subclass
**Plans**: TBD

Plans:
- [ ] 01-01: FastAPI project scaffolding, DuckDB connection management (single-writer, cursor-per-request)
- [ ] 01-02: Streaming COCO parser with ijson, DuckDB schema, and ingestion pipeline
- [ ] 01-03: Image serving layer (local filesystem + GCS storage abstraction, thumbnail generation and caching)
- [ ] 01-04: BasePlugin class, hook registry, and plugin loading mechanism

### Phase 2: Visual Grid
**Goal**: Users can visually browse 100K+ images in a performant grid with bounding box annotations overlaid on each thumbnail
**Depends on**: Phase 1
**Requirements**: GRID-01, GRID-02, GRID-04, GRID-05
**Success Criteria** (what must be TRUE):
  1. User can scroll through 100K+ image thumbnails without UI lag via virtualized infinite scroll
  2. Bounding box annotations render on thumbnails with class labels visible
  3. Each class name always maps to the same color across sessions (deterministic hashing)
  4. User can click any thumbnail to open a detail modal showing full-resolution image and all metadata
**Plans**: TBD

Plans:
- [ ] 02-01: Next.js app scaffolding, TanStack Virtual grid, thumbnail loading with LRU blob management
- [ ] 02-02: Canvas-based annotation overlay rendering (react-konva) with deterministic class-to-color hashing
- [ ] 02-03: Sample detail modal with full-resolution image, metadata display, and annotation list

### Phase 3: Filtering & Search
**Goal**: Users can slice the dataset by any metadata field, search by filename, tag samples, and save filter configurations for reuse
**Depends on**: Phase 2
**Requirements**: FILT-01, FILT-02, FILT-03, FILT-04
**Success Criteria** (what must be TRUE):
  1. User can filter the grid by class, split, tags, or any metadata field via sidebar controls
  2. User can search by filename and sort the grid by any metadata column
  3. User can save a filter configuration as a named view and reload it later
  4. User can add or remove tags on individual samples or bulk selections
**Plans**: TBD

Plans:
- [ ] 03-01: Sidebar filter UI, DuckDB dynamic filter query builder, filter state management (Zustand)
- [ ] 03-02: Search and sort functionality, saved views (persist to DuckDB), bulk tagging operations

### Phase 4: Predictions & Comparison
**Goal**: Users can import model predictions and visually compare them against ground truth annotations with dataset-level statistics
**Depends on**: Phase 2 (annotation rendering)
**Requirements**: EVAL-01, GRID-03, EVAL-03
**Parallel with**: Phase 5 (independent)
**Success Criteria** (what must be TRUE):
  1. User can import a JSON file of pre-computed model predictions and see them stored alongside ground truth
  2. User can toggle between GT-only, Predictions-only, and both overlaid (solid lines for GT, dashed for predictions)
  3. User can view a dataset statistics dashboard showing class distribution, annotation counts, and split breakdown
**Plans**: TBD

Plans:
- [ ] 04-01: Prediction import pipeline (JSON format), DuckDB storage schema for predictions
- [ ] 04-02: GT vs Predictions comparison toggle (dual-layer rendering: solid vs dashed), UI controls
- [ ] 04-03: Dataset statistics dashboard (class distribution, annotation counts, split breakdown charts)

### Phase 5: Embeddings & Visualization
**Goal**: Users can generate image embeddings and explore their dataset as a 2D scatter plot with interactive lasso selection that filters the grid
**Depends on**: Phase 1 (data layer, Qdrant)
**Requirements**: EMBED-01, EMBED-02, EMBED-03, EMBED-04
**Parallel with**: Phase 4 (independent)
**Success Criteria** (what must be TRUE):
  1. User can trigger embedding generation for a dataset and monitor progress (background computation with progress bar)
  2. Embeddings are reduced to 2D via UMAP or t-SNE and displayed as a deck.gl scatter plot with zoom and pan
  3. User can hover over points in the scatter plot and see image thumbnails
  4. User can lasso-select points in the scatter plot and the grid view filters to show only those selected images
**Plans**: TBD

Plans:
- [ ] 05-01: Embedding generation pipeline (SigLIP 2 / DINOv2 benchmark spike), Qdrant storage with named vectors
- [ ] 05-02: UMAP/t-SNE dimensionality reduction as async background task with WebSocket progress
- [ ] 05-03: deck.gl ScatterplotLayer with zoom, pan, hover thumbnails, WebGL context loss recovery
- [ ] 05-04: Lasso selection to grid filtering via Zustand cross-filter state

### Phase 6: Error Analysis & Similarity
**Goal**: Users can categorize prediction errors and find visually similar images to any sample in the dataset
**Depends on**: Phase 4 (predictions), Phase 5 (embeddings + Qdrant)
**Requirements**: EVAL-02, AGENT-03
**Success Criteria** (what must be TRUE):
  1. User can view each prediction error categorized as Hard False Positive, Label Error, or False Negative
  2. User can select any image and find visually similar images ranked by embedding distance via Qdrant similarity search
**Plans**: TBD

Plans:
- [ ] 06-01: IoU-based evaluation pipeline (TP/FP/FN matching), error categorization logic and UI
- [ ] 06-02: Query Coordinator for hybrid DuckDB + Qdrant queries, similarity search "find similar" action

### Phase 7: Intelligence & Agents
**Goal**: An AI agent automatically detects patterns in prediction errors and recommends corrective actions, while VLM auto-tagging enriches sample metadata
**Depends on**: Phase 6 (error categories, similarity search)
**Requirements**: AGENT-01, AGENT-02, AGENT-04
**Research flag**: NEEDS RESEARCH -- Pydantic AI tool design, VLM prompt engineering, calibration methodology
**Success Criteria** (what must be TRUE):
  1. Agent monitors error distribution and surfaces detected patterns (e.g., "90% of False Negatives occur in low-light images")
  2. Agent recommends specific actions based on patterns (e.g., "collect more nighttime training data" or "apply brightness augmentation")
  3. User can run VLM auto-tagging (Moondream2) on samples to add descriptive tags (dark, blurry, indoor, crowded, etc.)
**Plans**: TBD

Plans:
- [ ] 07-01: Pydantic AI agent with DuckDB/Qdrant tools for error distribution analysis
- [ ] 07-02: Pattern detection engine and action recommendation system
- [ ] 07-03: VLM auto-tagging pipeline (Moondream2), calibration framework, confidence scoring

## Progress

**Execution Order:**
Phases execute in numeric order. Phases 4 and 5 may execute in parallel (independent dependencies).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Foundation | 0/4 | Not started | - |
| 2. Visual Grid | 0/3 | Not started | - |
| 3. Filtering & Search | 0/2 | Not started | - |
| 4. Predictions & Comparison | 0/3 | Not started | - |
| 5. Embeddings & Visualization | 0/4 | Not started | - |
| 6. Error Analysis & Similarity | 0/2 | Not started | - |
| 7. Intelligence & Agents | 0/3 | Not started | - |
