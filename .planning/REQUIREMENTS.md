# Requirements: DataVisor v1.1

**Defined:** 2026-02-12
**Core Value:** A single tool that replaces scattered scripts: load any CV dataset, visually browse with annotation overlays, compare GT vs predictions, cluster via embeddings, and surface mistakes — all in one workflow.

## v1.1 Requirements

Requirements for Deployment, Workflow & Competitive Parity milestone.

### Deployment & Infrastructure

- [x] **DEPLOY-01**: Project runs as a 3-service Docker Compose stack (backend, frontend, Caddy reverse proxy) with persistent volume mounts for DuckDB, Qdrant, and thumbnails
- [x] **DEPLOY-02**: Single-user basic auth via Caddy protects all routes with automatic HTTPS via Let's Encrypt
- [x] **DEPLOY-03**: GCP VM deployment script provisions Compute Engine instance, persistent disk, firewall rules, and starts services
- [x] **DEPLOY-04**: Local run script starts all services with a single command
- [x] **DEPLOY-05**: Deployment documentation covers local setup, GCP deployment, and environment configuration

### Dataset Ingestion

- [x] **INGEST-01**: User can point at a local folder path from the UI and trigger dataset import
- [x] **INGEST-02**: Folder scanner auto-detects COCO format structure (images/ + annotations JSON)
- [x] **INGEST-03**: Folder scanner auto-detects train/val/test split subdirectories
- [x] **INGEST-04**: User confirms detected structure before import begins (detection is suggestion, not action)
- [x] **INGEST-05**: Import progress shown via SSE stream with per-split status

### Annotation Management

- [x] **ANNOT-01**: User can move bounding boxes by dragging in the sample detail modal
- [x] **ANNOT-02**: User can resize bounding boxes via drag handles in the sample detail modal
- [x] **ANNOT-03**: User can delete bounding boxes in the sample detail modal
- [x] **ANNOT-04**: User can draw new bounding boxes in the sample detail modal and assign a class
- [x] **ANNOT-05**: Only ground truth annotations are editable (predictions are immutable)
- [x] **ANNOT-06**: User can click "Find Similar" on any sample to query Qdrant and display nearest neighbors in grid

### Error Triage & Quality

- [x] **TRIAGE-01**: User can tag individual samples/annotations as FP, TP, FN, or mistake
- [x] **TRIAGE-02**: Highlight mode dims non-error samples in the grid, emphasizing errors
- [x] **TRIAGE-03**: "Worst images" ranking surfaces samples with highest combined error score (error count + confidence spread + uniqueness)
- [x] **TRIAGE-04**: Interactive confusion matrix that filters grid when a cell is clicked
- [x] **TRIAGE-05**: Near-duplicate detection surfaces visually similar images in the dataset
- [x] **TRIAGE-06**: Interactive histograms on the statistics dashboard — clicking a bar filters the grid

### UX

- [ ] **UX-01**: Keyboard shortcuts for sample navigation (arrows, j/k, Enter, Escape)
- [ ] **UX-02**: Keyboard shortcuts for error triage (number keys for quick-tag, h for highlight toggle)
- [ ] **UX-03**: Keyboard shortcuts for annotation editing (Delete, Ctrl+Z, e for edit mode)
- [ ] **UX-04**: Shortcut help overlay triggered by ? key

## v1.2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Format Expansion

- **FMT-01**: YOLO format parser (.txt annotation files with class_id + normalized xywh)
- **FMT-02**: Pascal VOC format parser (XML annotation files)
- **FMT-03**: Dataset export in COCO and YOLO formats

### Evaluation

- **EVAL-01**: PR curves per class
- **EVAL-02**: Per-class AP metrics dashboard

### Advanced

- **ADV-01**: Model zoo / in-app inference (ONNX/TorchScript)
- **ADV-02**: Custom workspaces / panel layouts
- **ADV-03**: Customizable keyboard shortcut remapping
- **ADV-04**: CVAT/Label Studio integration for complex annotation workflows

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-user collaboration / RBAC | Personal tool — single-user auth for VM security only |
| Video annotation support | Image-only for now; multiplies complexity |
| Training pipeline integration | DataVisor inspects data, doesn't train models |
| Mobile/tablet interface | Desktop browser only |
| Real-time streaming inference | Batch-oriented analysis |
| 3D point cloud visualization | Different rendering pipeline entirely |
| Full annotation editor (polygon, segmentation) | Bounding box CRUD only for v1.1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEPLOY-01 | Phase 8 | Complete |
| DEPLOY-02 | Phase 8 | Complete |
| DEPLOY-03 | Phase 8 | Complete |
| DEPLOY-04 | Phase 8 | Complete |
| DEPLOY-05 | Phase 8 | Complete |
| INGEST-01 | Phase 9 | Complete |
| INGEST-02 | Phase 9 | Complete |
| INGEST-03 | Phase 9 | Complete |
| INGEST-04 | Phase 9 | Complete |
| INGEST-05 | Phase 9 | Complete |
| ANNOT-01 | Phase 10 | Complete |
| ANNOT-02 | Phase 10 | Complete |
| ANNOT-03 | Phase 10 | Complete |
| ANNOT-04 | Phase 10 | Complete |
| ANNOT-05 | Phase 10 | Complete |
| ANNOT-06 | Phase 12 | Complete |
| TRIAGE-01 | Phase 11 | Complete |
| TRIAGE-02 | Phase 11 | Complete |
| TRIAGE-03 | Phase 11 | Complete |
| TRIAGE-04 | Phase 12 | Complete |
| TRIAGE-05 | Phase 12 | Complete |
| TRIAGE-06 | Phase 12 | Complete |
| UX-01 | Phase 13 | Pending |
| UX-02 | Phase 13 | Pending |
| UX-03 | Phase 13 | Pending |
| UX-04 | Phase 13 | Pending |

**Coverage:**
- v1.1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-02-12*
*Last updated: 2026-02-13 — Phase 12 requirements marked Complete*
