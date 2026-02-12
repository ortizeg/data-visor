# DataVisor

## What This Is

DataVisor is an open-source dataset introspection tool for computer vision — an alternative to Voxel51. It combines a high-performance visual browser with VLM-powered agentic workflows to automatically discover dataset blind spots (poor lighting, rare occlusions, label errors). Built as a personal tool for exploring 100K+ image datasets with COCO format annotations.

## Core Value

A single tool that replaces scattered one-off scripts: load any CV dataset, visually browse with annotation overlays, compare ground truth against predictions, cluster via embeddings, and surface mistakes — all in one workflow.

## Requirements

### Validated

- ✓ Multi-format ingestion (COCO) with streaming parser architecture — v1.0
- ✓ DuckDB-backed metadata storage for fast analytical queries over 100K+ samples — v1.0
- ✓ Virtualized infinite-scroll grid view with overlaid bounding box annotations — v1.0
- ✓ Ground Truth vs Model Predictions comparison toggle (solid vs dashed lines) — v1.0
- ✓ Deterministic class-to-color hashing (same class = same color across sessions) — v1.0
- ✓ t-SNE embedding generation from images (DINOv2-base) — v1.0
- ✓ deck.gl-powered 2D embedding scatterplot with zoom, pan, and lasso selection — v1.0
- ✓ Lasso-to-grid filtering (select cluster points → filter grid to those images) — v1.0
- ✓ Hover thumbnails on embedding map points — v1.0
- ✓ Qdrant vector storage for embedding similarity search — v1.0
- ✓ Error categorization: Hard False Positives, Label Errors, False Negatives — v1.0
- ✓ Pydantic AI agent that monitors error distribution and recommends actions — v1.0
- ✓ Pattern detection (e.g., "90% of False Negatives occur in low-light images") — v1.0
- ✓ Import pre-computed predictions (JSON) — v1.0
- ✓ BasePlugin class for Python extensibility — v1.0
- ✓ Local disk and GCS image source support — v1.0
- ✓ Dynamic metadata filtering (sidebar filters on any metadata field) — v1.0
- ✓ VLM auto-tagging (Moondream2) for scene attribute tags — v1.0
- ✓ Search by filename and sort by metadata — v1.0
- ✓ Save and load filter configurations (saved views) — v1.0
- ✓ Add/remove tags (individual + bulk) — v1.0
- ✓ Sample detail modal with full-resolution image — v1.0
- ✓ Dataset statistics dashboard (class distribution, annotation counts) — v1.0

### Active

- [ ] Interactive model evaluation dashboard (PR curves, confusion matrix, per-class AP)
- [ ] YOLO format parser (.txt annotation files)
- [ ] Pascal VOC format parser (XML annotation files)
- [ ] Run inference in-tool against loaded models
- [ ] Plugin ingestion/UI/transformation hooks

### Out of Scope

- Multi-user collaboration / auth — personal tool, not a platform
- Video annotation support — image-only for now
- Training pipeline integration — DataVisor inspects data, doesn't train models
- Mobile/tablet interface — desktop browser only
- Real-time streaming inference — batch-oriented analysis

## Context

Shipped v1.0 with 12,720 LOC (6,950 Python + 5,770 TypeScript) across 7 phases and 21 plans.
Tech stack: FastAPI + DuckDB + Qdrant (backend), Next.js + Tailwind + deck.gl + Recharts (frontend), Pydantic AI (agents), Moondream2 (VLM).
59 backend tests passing. TypeScript compiles with 0 errors.
Architecture: 3 Zustand stores, FastAPI DI, source discriminator for GT/prediction separation, 4 SSE progress streams, lazy model loading.

## Constraints

- **Tech Stack**: FastAPI + DuckDB + Qdrant (backend), Next.js + Tailwind + deck.gl (frontend), Pydantic AI (agents) — established
- **Performance**: Must handle 100K+ images without UI lag; DuckDB for metadata queries, deck.gl for WebGL rendering, virtualized scrolling
- **Storage**: Supports both local filesystem and GCS bucket sources
- **GPU**: VLM inference (Moondream2) supports MPS/CUDA/CPU auto-detection; DINOv2 embeddings likewise
- **Extensibility**: BasePlugin architecture exists; hooks system ready for expansion
- **Python**: 3.14+ (numba/umap-learn incompatible; using scikit-learn t-SNE)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| DuckDB over SQLite | Analytical queries on metadata at scale; columnar storage for filtering 100K+ rows | ✓ Good |
| Qdrant over FAISS | Payload filtering support; Rust-based performance; local deployment | ✓ Good |
| deck.gl for embedding viz | WebGL-powered; handles millions of points; lasso/interaction built-in | ✓ Good |
| Pydantic AI for agents | Type-safe agent definitions; native FastAPI/Pydantic integration | ✓ Good |
| Deterministic color hashing | Class names hash to consistent colors across sessions; no manual palette | ✓ Good |
| Plugin hooks over monolith | Ingestion/UI/transformation hooks enable domain-specific extensions without forking | ✓ Good |
| Source discriminator column | Clean GT/prediction separation in annotations table via source field | ✓ Good |
| Lazy model loading | VLM and Qdrant loaded on-demand, not at startup, to avoid memory pressure | ✓ Good |
| t-SNE over UMAP | umap-learn blocked by Python 3.14 numba incompatibility; t-SNE via scikit-learn | ⚠️ Revisit when numba supports 3.14 |
| Moondream2 via transformers | trust_remote_code with all_tied_weights_keys patch for transformers 5.x compat | ✓ Good (fragile — monitor updates) |

---
*Last updated: 2026-02-12 after v1.0 milestone*
