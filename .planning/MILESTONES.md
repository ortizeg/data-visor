# Project Milestones: DataVisor

## v1.1 Deployment, Workflow & Competitive Parity (Shipped: 2026-02-13)

**Delivered:** Production-ready Docker deployment, smart dataset ingestion UI, annotation editing, error triage workflows, interactive visualizations with grid filtering, keyboard shortcuts, and per-annotation TP/FP/FN classification.

**Phases completed:** 8-14 (20 plans total)

**Key accomplishments:**

- Production-ready Docker stack (Caddy + FastAPI + Next.js) with single-user auth, GCP deployment scripts, and comprehensive documentation
- Smart dataset ingestion wizard with auto-detection of COCO layouts (Roboflow/Standard/Flat) and multi-split support
- Annotation editing via react-konva canvas (move, resize, draw, delete bounding boxes) with DuckDB persistence
- Error triage workflow: per-sample tagging, per-annotation TP/FP/FN auto-classification via IoU matching, worst-images ranking, and highlight mode
- Interactive data discovery: clickable confusion matrix, near-duplicate detection, histogram filtering, and find-similar — all piping results to the grid
- Full keyboard navigation with 16 shortcuts across grid, modal, triage, and editing contexts

**Stats:**

- 171 files created/modified
- ~19,460 lines of code added (9,306 Python + 10,154 TypeScript)
- 7 phases, 20 plans, 97 commits
- 2 days (Feb 12-13, 2026)

**Git range:** `a83d6cf` → `1bed6cf`

**What's next:** Format expansion (YOLO/VOC), PR curves, per-class AP metrics

---

## v1.0 MVP (Shipped: 2026-02-12)

**Delivered:** A unified CV dataset introspection tool with visual browsing, annotation overlays, model comparison, embedding visualization, error analysis, and AI-powered pattern detection.

**Phases completed:** 1-7 (21 plans total)

**Key accomplishments:**

- DuckDB-backed streaming ingestion pipeline with ijson for 100K+ scale COCO datasets, supporting local and GCS image sources
- Virtualized infinite-scroll grid with SVG annotation overlays and deterministic class-to-color hashing
- Full metadata filtering, search, saved views, and bulk tagging system
- Model prediction import with GT vs Predictions comparison toggle and statistics dashboard
- DINOv2 embedding generation with t-SNE reduction and deck.gl scatter plot with lasso-to-grid cross-filtering
- Error categorization pipeline (TP/FP/FN/Label Error) and Qdrant-powered similarity search
- Pydantic AI agent for error pattern detection with action recommendations, and Moondream2 VLM auto-tagging

**Stats:**

- 212 files created/modified
- 12,720 lines of code (6,950 Python + 5,770 TypeScript)
- 7 phases, 21 plans, 98 commits
- 2 days from project start to ship (Feb 10-12, 2026)

**Git range:** `558f71c` → `a83d6cf`

**What's next:** Interactive model evaluation dashboard (PR curves, confusion matrix, per-class AP metrics)

---

## v1.2 Classification Dataset Support (Shipped: 2026-02-19)

**Delivered:** First-class single-label classification dataset support with full feature parity to detection workflows — from JSONL ingestion through evaluation metrics to production-ready polish for high-cardinality datasets.

**Phases completed:** 15-17 (6 plans total)

**Key accomplishments:**

- Classification JSONL parser with auto-detection of dataset type, multi-split ingestion, and sentinel bbox pattern for unified schema
- Grid browsing with class label badges and detail modal with dropdown class editor (PATCH mutation)
- Classification evaluation: accuracy, macro/weighted F1, per-class precision/recall/F1, and clickable confusion matrix
- Error analysis categorizing each image as correct, misclassified, or missing prediction
- Confusion matrix polish with threshold filtering and overflow scroll for 43+ classes, most-confused pairs summary
- Embedding scatter color modes: GT class, predicted class, and correct/incorrect with Tableau 20 categorical palette

**Stats:**

- 61 files created/modified
- ~6,052 lines of code added
- 3 phases, 6 plans, 27 commits
- 1 day (Feb 18, 2026)

**Git range:** `5264e51` → `67a7a9c`

**What's next:** TBD — next milestone planning

---

