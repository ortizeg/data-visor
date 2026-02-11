# VisionLens

## What This Is

VisionLens is an open-source dataset introspection tool for computer vision — an alternative to Voxel51. It combines a high-performance visual browser with VLM-powered agentic workflows to automatically discover dataset blind spots (poor lighting, rare occlusions, label errors). Built as a personal tool for exploring 100K+ image datasets across multiple annotation formats.

## Core Value

A single tool that replaces scattered one-off scripts: load any CV dataset, visually browse with annotation overlays, compare ground truth against predictions, cluster via embeddings, and surface mistakes — all in one workflow.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Multi-format ingestion (COCO, YOLO, VOC) with extensible parser architecture
- [ ] DuckDB-backed metadata storage for fast analytical queries over 100K+ samples
- [ ] Virtualized infinite-scroll grid view with overlaid bounding box annotations
- [ ] Ground Truth vs Model Predictions comparison toggle (solid vs dashed lines)
- [ ] Deterministic class-to-color hashing (same class = same color across sessions)
- [ ] UMAP/t-SNE embedding generation from images
- [ ] deck.gl-powered 2D/3D embedding scatterplot with zoom, pan, and lasso selection
- [ ] Lasso-to-grid filtering (select cluster points → filter grid to those images)
- [ ] Hover thumbnails on embedding map points
- [ ] Qdrant vector storage for embedding similarity search
- [ ] Error categorization: Hard False Positives, Label Errors, False Negatives
- [ ] Pydantic AI agent that monitors error distribution and recommends actions
- [ ] Pattern detection (e.g., "90% of False Negatives occur in low-light images")
- [ ] Import pre-computed predictions (JSON) and run inference via loaded models
- [ ] Plugin/hook system: ingestion hooks, UI hooks, transformation hooks
- [ ] BasePlugin class for Python extensibility
- [ ] Local disk and GCS image source support
- [ ] Dynamic metadata filtering (sidebar filters on any metadata field)

### Out of Scope

- Multi-user collaboration / auth — personal tool, not a platform
- Video annotation support — image-only for v1
- Training pipeline integration — VisionLens inspects data, doesn't train models
- Mobile/tablet interface — desktop browser only
- Real-time streaming inference — batch-oriented analysis

## Context

- Replaces a collection of custom Python scripts used for dataset analysis
- Primary datasets are 100K+ images in COCO, YOLO, and VOC formats
- Images stored on local disk and Google Cloud Storage
- GPU available both locally (dev) and in the cloud (heavy lifting)
- Voxel51 is the closest existing tool but doesn't satisfy the agentic/VLM-driven blind spot discovery workflow
- Embedding generation is compute-intensive; should support both local GPU and cloud GPU paths
- Plugin system is v1 critical — the tool needs to be extensible from day one

## Constraints

- **Tech Stack**: FastAPI + DuckDB + Qdrant (backend), Next.js + Tailwind + deck.gl (frontend), Pydantic AI (agents) — already decided
- **Performance**: Must handle 100K+ images without UI lag; DuckDB for metadata queries, deck.gl for WebGL rendering, virtualized scrolling
- **Storage**: Must support both local filesystem and GCS bucket sources
- **GPU**: VLM inference (Moondream2 etc.) requires CUDA; must work with both local and cloud GPU
- **Extensibility**: Plugin architecture (BasePlugin, hooks) is a v1 requirement, not a future nice-to-have
- **Annotation Formats**: Must support COCO, YOLO, and Pascal VOC at minimum, with extensible parser design

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| DuckDB over SQLite | Analytical queries on metadata at scale; columnar storage for filtering 100K+ rows | — Pending |
| Qdrant over FAISS | Payload filtering support; Rust-based performance; local deployment | — Pending |
| deck.gl for embedding viz | WebGL-powered; handles millions of points; lasso/interaction built-in | — Pending |
| Pydantic AI for agents | Type-safe agent definitions; native FastAPI/Pydantic integration | — Pending |
| Deterministic color hashing | Class names hash to consistent colors across sessions; no manual palette | — Pending |
| Plugin hooks over monolith | Ingestion/UI/transformation hooks enable domain-specific extensions without forking | — Pending |

---
*Last updated: 2026-02-10 after initialization*
