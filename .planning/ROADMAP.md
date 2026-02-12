# Roadmap: DataVisor

## Milestones

- v1.0 MVP - Phases 1-7 (shipped 2026-02-12)
- **v1.1 Deployment, Workflow & Competitive Parity** - Phases 8-13 (in progress)

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

### v1.1 Deployment, Workflow & Competitive Parity (In Progress)

**Milestone Goal:** Make DataVisor deployable (Docker + GCP), secure for cloud access, and close key workflow gaps vs FiftyOne/Encord -- smart ingestion, annotation editing, error triage, interactive visualizations, and keyboard-driven navigation.

**Phase Numbering:**
- Integer phases (8, 9, 10, ...): Planned milestone work
- Decimal phases (9.1, 9.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 8: Docker Deployment & Auth** - Dockerized 3-service stack with Caddy reverse proxy, basic auth, and deployment scripts
- [ ] **Phase 9: Smart Ingestion** - No-code dataset import from folder path with auto-detection and confirmation
- [ ] **Phase 10: Annotation Editing** - Move, resize, delete, and draw bounding boxes via react-konva in sample detail modal
- [ ] **Phase 11: Error Triage** - Tag errors, highlight mode, and worst-images ranking with DuckDB persistence
- [ ] **Phase 12: Interactive Viz & Discovery** - Confusion matrix, near-duplicates, interactive histograms, and find-similar
- [ ] **Phase 13: Keyboard Shortcuts** - Keyboard navigation, triage hotkeys, edit shortcuts, and help overlay

## Phase Details

### Phase 8: Docker Deployment & Auth
**Goal**: DataVisor runs as a deployable Docker stack with single-user auth, accessible securely on a cloud VM or locally with a single command
**Depends on**: Phase 7 (v1.0 complete)
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05
**Success Criteria** (what must be TRUE):
  1. User can run `docker compose up` and access DataVisor at `http://localhost` with all features working (grid, embeddings, error analysis)
  2. User is prompted for username/password before accessing any page or API endpoint, and unauthenticated requests are rejected
  3. User can run a deployment script that provisions a GCP VM with persistent disk and starts DataVisor accessible at a public IP with HTTPS
  4. User can follow deployment documentation to configure environment variables, deploy to GCP, and set up a custom domain
  5. DuckDB data, Qdrant vectors, and thumbnail cache persist across container restarts without data loss
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD
- [ ] 08-03: TBD

### Phase 9: Smart Ingestion
**Goal**: Users can import datasets from the UI by pointing at a folder, reviewing auto-detected structure, and confirming import -- no CLI or config files needed
**Depends on**: Phase 8 (auth protects new endpoints)
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05
**Success Criteria** (what must be TRUE):
  1. User can enter a folder path in the UI and trigger a scan that returns detected dataset structure
  2. Scanner correctly identifies COCO annotation files and image directories within the folder
  3. Scanner detects train/val/test split subdirectories and presents them as separate importable splits
  4. User sees the detected structure as a confirmation step and can approve or adjust before import begins
  5. Import progress displays per-split status via real-time SSE updates until completion
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD

### Phase 10: Annotation Editing
**Goal**: Users can make quick bounding box corrections directly in the sample detail modal without leaving DataVisor
**Depends on**: Phase 8 (auth protects mutation endpoints)
**Requirements**: ANNOT-01, ANNOT-02, ANNOT-03, ANNOT-04, ANNOT-05
**Success Criteria** (what must be TRUE):
  1. User can enter edit mode in the sample detail modal and drag a bounding box to a new position
  2. User can grab resize handles on a bounding box and change its dimensions
  3. User can delete a bounding box and the deletion persists after closing the modal
  4. User can draw a new bounding box and assign it a class label
  5. Only ground truth annotations show edit controls; prediction annotations remain read-only and non-interactive
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD
- [ ] 10-03: TBD

### Phase 11: Error Triage
**Goal**: Users can systematically review and tag errors with a focused triage workflow that persists decisions and surfaces the worst samples first
**Depends on**: Phase 8 (extends v1.0 error analysis)
**Requirements**: TRIAGE-01, TRIAGE-02, TRIAGE-03
**Success Criteria** (what must be TRUE):
  1. User can tag any sample or annotation as FP, TP, FN, or mistake, and the tag persists across page refreshes
  2. User can activate highlight mode to dim non-error samples in the grid, making errors visually prominent
  3. User can view a "worst images" ranking that surfaces samples with the highest combined error score (error count + confidence spread + uniqueness)
**Plans**: TBD

Plans:
- [ ] 11-01: TBD
- [ ] 11-02: TBD

### Phase 12: Interactive Viz & Discovery
**Goal**: Users can explore dataset quality interactively -- clicking visualization elements filters the grid, finding similar samples and near-duplicates is one click away
**Depends on**: Phase 11 (triage data informs confusion matrix), Phase 8 (auth protects endpoints)
**Requirements**: ANNOT-06, TRIAGE-04, TRIAGE-05, TRIAGE-06
**Success Criteria** (what must be TRUE):
  1. User can click "Find Similar" on any sample to see nearest neighbors from Qdrant displayed in the grid
  2. User can view a confusion matrix and click any cell to filter the grid to samples matching that GT/prediction pair
  3. User can trigger near-duplicate detection and browse groups of visually similar images
  4. User can click a bar in any statistics dashboard histogram to filter the grid to samples in that bucket
**Plans**: TBD

Plans:
- [ ] 12-01: TBD
- [ ] 12-02: TBD
- [ ] 12-03: TBD

### Phase 13: Keyboard Shortcuts
**Goal**: Power users can navigate, triage, and edit entirely from the keyboard without reaching for the mouse
**Depends on**: Phase 10 (annotation edit shortcuts), Phase 11 (triage shortcuts), Phase 12 (all UI features exist)
**Requirements**: UX-01, UX-02, UX-03, UX-04
**Success Criteria** (what must be TRUE):
  1. User can navigate between samples in the grid and modal using arrow keys, j/k, Enter, and Escape
  2. User can quick-tag errors during triage using number keys and toggle highlight mode with h
  3. User can delete annotations and undo edits with keyboard shortcuts while in annotation edit mode
  4. User can press ? to open a shortcut help overlay listing all available keyboard shortcuts
**Plans**: TBD

Plans:
- [ ] 13-01: TBD
- [ ] 13-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 8 -> 9 -> 10 -> 11 -> 12 -> 13
(Note: Phases 9, 10, 11 are independent after Phase 8. Execution is sequential but no inter-dependency exists between 9/10/11.)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Data Foundation | v1.0 | 4/4 | Complete | 2026-02-10 |
| 2. Visual Grid | v1.0 | 3/3 | Complete | 2026-02-10 |
| 3. Filtering & Search | v1.0 | 2/2 | Complete | 2026-02-11 |
| 4. Predictions & Comparison | v1.0 | 3/3 | Complete | 2026-02-11 |
| 5. Embeddings & Visualization | v1.0 | 4/4 | Complete | 2026-02-11 |
| 6. Error Analysis & Similarity | v1.0 | 2/2 | Complete | 2026-02-12 |
| 7. Intelligence & Agents | v1.0 | 3/3 | Complete | 2026-02-12 |
| 8. Docker Deployment & Auth | v1.1 | 0/TBD | Not started | - |
| 9. Smart Ingestion | v1.1 | 0/TBD | Not started | - |
| 10. Annotation Editing | v1.1 | 0/TBD | Not started | - |
| 11. Error Triage | v1.1 | 0/TBD | Not started | - |
| 12. Interactive Viz & Discovery | v1.1 | 0/TBD | Not started | - |
| 13. Keyboard Shortcuts | v1.1 | 0/TBD | Not started | - |
