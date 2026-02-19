# DataVisor

## What This Is

DataVisor is an open-source dataset introspection tool for computer vision — an alternative to Voxel51. It combines a high-performance visual browser with VLM-powered agentic workflows to automatically discover dataset blind spots (poor lighting, rare occlusions, label errors). Built as a personal tool for exploring 100K+ image datasets with COCO detection or JSONL classification annotations.

## Core Value

A single tool that replaces scattered one-off scripts: load any CV dataset, visually browse with annotation overlays, compare ground truth against predictions, cluster via embeddings, and surface mistakes — all in one workflow.

## Current State

**Shipped:** v1.2 (2026-02-19)
**Codebase:** ~38K LOC (16,256+ Python + 15,924+ TypeScript) across 17 phases
**Architecture:** FastAPI + DuckDB + Qdrant (backend), Next.js + Tailwind + deck.gl + Recharts (frontend), Pydantic AI (agents), Moondream2 (VLM)

## Requirements

### Validated

- Streaming COCO ingestion with ijson at 100K+ scale, local + GCS sources — v1.0
- DuckDB metadata storage with fast analytical queries — v1.0
- Virtualized grid with SVG annotation overlays, deterministic color hashing — v1.0
- GT vs Predictions comparison toggle — v1.0
- t-SNE embeddings with deck.gl scatter plot, lasso-to-grid filtering — v1.0
- Error categorization (TP/FP/FN/Label Error) + Qdrant similarity search — v1.0
- Pydantic AI agent for error patterns + Moondream2 VLM auto-tagging — v1.0
- Metadata filtering, search, saved views, bulk tagging — v1.0
- Docker 3-service stack with Caddy auth, GCP deployment scripts — v1.1
- Smart ingestion UI with auto-detection of COCO layouts and multi-split support — v1.1
- Annotation editing via react-konva (move, resize, draw, delete) — v1.1
- Error triage: sample tagging, per-annotation TP/FP/FN via IoU, worst-images ranking, highlight mode — v1.1
- Interactive discovery: confusion matrix, near-duplicates, histogram filtering, find-similar — v1.1
- Keyboard shortcuts: 16 shortcuts across grid, modal, triage, editing — v1.1
- Auto-detect dataset type (detection vs classification) from annotation format — v1.2
- JSONL classification ingestion with multi-split support — v1.2
- Grid browsing with class label badges for classification datasets — v1.2
- Classification prediction import and GT vs predicted comparison — v1.2
- Classification stats: accuracy, F1, per-class precision/recall, confusion matrix — v1.2
- Embedding color modes (GT class, predicted class, correct/incorrect) — v1.2
- Confusion matrix scaling to 43+ classes with threshold filtering — v1.2

### Active

(None — planning next milestone)

### Out of Scope

- Multi-user collaboration — personal tool, single-user auth only
- Video annotation support — image-only
- Training pipeline integration — DataVisor inspects data, doesn't train
- Mobile/tablet interface — desktop browser only
- Full annotation editor (polygons, segmentation) — bounding box only
- Multi-label classification — single-label per image only for now

## Constraints

- **Tech Stack**: FastAPI + DuckDB + Qdrant (backend), Next.js + Tailwind + deck.gl (frontend), Pydantic AI (agents) — established
- **Performance**: Must handle 100K+ images without UI lag; DuckDB for metadata queries, deck.gl for WebGL rendering, virtualized scrolling
- **Storage**: Supports both local filesystem and GCS bucket sources
- **GPU**: VLM inference (Moondream2) supports MPS/CUDA/CPU auto-detection; SigLIP embeddings likewise
- **Extensibility**: BasePlugin architecture exists; hooks system ready for expansion
- **Python**: 3.14+ (numba/umap-learn incompatible; using scikit-learn t-SNE)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| DuckDB over SQLite | Analytical queries on metadata at scale; columnar storage for filtering 100K+ rows | Good |
| Qdrant over FAISS | Payload filtering support; Rust-based performance; local deployment | Good |
| deck.gl for embedding viz | WebGL-powered; handles millions of points; lasso/interaction built-in | Good |
| Pydantic AI for agents | Type-safe agent definitions; native FastAPI/Pydantic integration | Good |
| Deterministic color hashing | Class names hash to consistent colors across sessions; no manual palette | Good |
| Source discriminator column | Clean GT/prediction separation in annotations table via source field | Good |
| Caddy over nginx | Auto-HTTPS, built-in basic_auth, simpler config | Good |
| react-konva for editing | Canvas-based editing in modal; SVG stays for grid overlays | Good |
| Gemini 2.0 Flash for agent | Fast, cheap, good structured output; replaced GPT-4o | Good |
| Pre-computed agent prompt | All data in prompt, no tool calls; avoids Pydantic AI request_limit issues | Good |
| t-SNE over UMAP | umap-learn blocked by Python 3.14 numba incompatibility | Revisit when numba supports 3.14 |
| Moondream2 via transformers | trust_remote_code with all_tied_weights_keys patch for transformers 5.x | Fragile — monitor updates |
| Sentinel bbox values (0.0) for classification | Avoids 30+ null guards; unified schema for detection and classification | Good |
| Separate classification evaluation service | ~50-line function vs modifying 560-line detection eval; clean separation | Good |
| Dataset-type routing at endpoint level | Keep classification/detection services separate; route in router layer | Good |
| Parser registry in IngestionService | Format-based dispatch to COCOParser or ClassificationJSONLParser | Good |
| Threshold slider for confusion matrix | Hide noisy off-diagonal cells at high cardinality (0-50%, default 1%) | Good |
| Client-side most-confused pairs | Derived from confusion matrix data; no new API endpoint needed | Good |
| Tableau 20 palette for embeddings | Stable categorical coloring for class-based scatter modes | Good |

---
*Last updated: 2026-02-19 after v1.2 milestone*
