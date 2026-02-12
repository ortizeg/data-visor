# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-10)

**Core value:** A single tool that replaces scattered scripts: load any CV dataset, visually browse with annotation overlays, compare GT vs predictions, cluster via embeddings, and surface mistakes -- all in one workflow.
**Current focus:** Phase 7 complete. All 21 plans across 7 phases delivered.

## Current Position

Phase: 7 of 7 (Intelligence & Agents)
Plan: 3 of 3 in current phase
Status: Phase complete -- ALL PLANS DELIVERED
Last activity: 2026-02-12 -- Completed 07-02-PLAN.md

Progress: [█████████████████████] 21/21

## Performance Metrics

**Velocity:**
- Total plans completed: 21
- Average duration: 3.9 min
- Total execution time: 82 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Data Foundation | 4/4 | 14 min | 3.5 min |
| 2. Visual Grid | 3/3 | 15 min | 5.0 min |
| 3. Filtering & Search | 2/2 | 10 min | 5.0 min |
| 4. Predictions & Comparison | 3/3 | 9 min | 3.0 min |
| 5. Embeddings & Visualization | 4/4 | 16 min | 4.0 min |
| 6. Error Analysis & Similarity | 2/2 | 9 min | 4.5 min |
| 7. Intelligence & Agents | 3/3 | 9 min | 3.0 min |

**Recent Trend:**
- Last 5 plans: 06-02 (4 min), 07-01 (3 min), 07-02 (4 min), 07-03 (2 min)
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phases 4 (Predictions) and 5 (Embeddings) are independent and can execute in parallel
- [Roadmap]: Phase 7 (Intelligence) flagged for deeper research during planning (Pydantic AI tool design, VLM calibration)
- [Roadmap]: GRID-03 (GT vs Predictions toggle) assigned to Phase 4 rather than Phase 2 because it requires predictions to exist
- [01-01]: No PK/FK constraints on DuckDB tables for 3.8x faster bulk inserts
- [01-01]: Pydantic Settings with VISIONLENS_ env prefix and lru_cache singleton
- [01-01]: Single DuckDB connection via lifespan, cursor-per-request via DI
- [01-01]: pytest-asyncio with auto mode for async test support
- [01-02]: All plugin hooks use keyword-only arguments for forward compatibility
- [01-02]: Hook constants centralized in hooks.py to avoid magic strings
- [01-02]: Error isolation at both trigger_hook and discover_plugins levels
- [01-03]: Two-pass COCO parsing (categories, then images, then annotations) for clarity
- [01-03]: DataFrame column order explicitly matches DuckDB table order for bulk insert
- [01-03]: WebP method=4 for thumbnail generation (best speed/quality tradeoff)
- [01-04]: Sync generator for SSE (not async) -- FastAPI wraps in StreamingResponse
- [01-04]: Thumbnail generation capped at 500 during ingestion; rest on-demand
- [01-04]: Service composition via FastAPI DI (get_ingestion_service)
- [02-01]: Row-only virtualization with CSS grid columns (not dual virtualizer)
- [02-01]: Unoptimized Next.js images -- backend serves its own WebP thumbnails
- [02-01]: Simple Zustand create() pattern (not per-request) for fully client-rendered grid
- [02-01]: src/ directory structure for frontend (tsconfig @/* -> ./src/*)
- [02-02]: Batch annotations fetched at grid level from visible virtual rows, not per-cell
- [02-02]: SVG viewBox uses original image dimensions (not thumbnail) for correct coordinate mapping
- [02-02]: color-hash with saturation [0.6-0.8] and lightness [0.45-0.65] for vibrant readable colors
- [02-02]: Batch endpoint capped at 200 sample_ids per request
- [02-02]: paintOrder stroke with dark stroke behind colored text fill for readability
- [02-03]: Native <dialog> element for modal (focus trap, Escape, backdrop for free)
- [02-03]: SVG aspectMode prop: "slice" for object-cover thumbnails, "meet" for full-res modal
- [02-03]: Per-sample annotation endpoint for modal (batch not needed for single detail view)
- [03-01]: Individual Query() params (not Pydantic Query model) for filter endpoint
- [03-01]: Filter facets queryKey uses only datasetId to avoid N+1 refetches
- [03-01]: Sorted tags array in queryKey for structural stability
- [03-01]: Flex-1 layout for grid container instead of fixed calc() height
- [03-02]: Bulk tag/untag endpoints placed before /{sample_id}/annotations to avoid FastAPI path conflicts
- [03-02]: Selection state excluded from TanStack Query key (UI-only state)
- [03-02]: Exiting select mode auto-clears selection to prevent stale state
- [03-02]: Tag badges limited to 3 visible with +N more indicator
- [04-01]: Predictions stored in annotations table with source='prediction' discriminator (not separate table)
- [04-01]: Re-import deletes only source='prediction' rows, preserving ground truth
- [04-01]: PredictionParser follows same ijson streaming + DataFrame batching pattern as COCOParser
- [04-02]: Default overlayMode is "ground_truth" since predictions may not exist
- [04-02]: Annotation staleTime reduced from Infinity to 5 min (predictions can change after import)
- [04-02]: "Both" mode omits source param (returns all annotations in one request)
- [04-03]: Recharts for charting (lightweight, React-native, composable API, works with React 19)
- [04-03]: Server-side aggregation via DuckDB GROUP BY (not client-side)
- [04-03]: activeTab state in Zustand (ephemeral session state, not URL params)
- [04-03]: OverlayToggle hidden when Statistics tab active (only relevant to grid view)
- [05-01]: umap-learn skipped due to numba/llvmlite Python 3.14 incompatibility; scikit-learn installed as fallback
- [05-01]: EmbeddingService uses StorageBackend directly (not ImageService) for raw image access
- [05-01]: In-memory dict for progress tracking (ephemeral, per-process)
- [05-01]: MPS/CUDA/CPU auto-detection for model device placement
- [05-01]: EventSourceResponse async generator pattern for proper SSE (replaces sync StreamingResponse used in ingestion)
- [05-02]: scikit-learn t-SNE used for dimensionality reduction (umap-learn blocked by Python 3.14)
- [05-02]: t-SNE perplexity clamped to min(30, n_samples-1) for small dataset safety
- [05-02]: PCA initialization for t-SNE (more stable than random init)
- [05-02]: Cosine metric for t-SNE matching DINOv2 embedding space semantics
- [05-03]: OrthographicView (not MapView) for abstract 2D embedding scatter plot
- [05-03]: MutationObserver to detect deck.gl canvas for WebGL context loss listener
- [05-03]: useEffect for terminal-status monitoring (not inline setState during render)
- [05-03]: staleTime: Infinity for coordinates (stable until re-reduction)
- [05-04]: Lasso selection in embedding-store, NOT filter-store -- spatial vs metadata separation
- [05-04]: useSamples is single integration point reading both filter-store and embedding-store
- [05-04]: sample_ids cap at 5000 (vs 200 for batch-annotations) for large cluster selection
- [05-04]: DeckGLRef forwarded via prop for viewport.project() coordinate mapping
- [05-04]: Cross-filter pattern: separate domain stores combined at query hook level
- [06-01]: Import _load_detections and _compute_iou_matrix from evaluation.py directly (shared internal helpers)
- [06-01]: Error samples capped at 50 per type to avoid large payloads
- [06-01]: Label Error marks GT as matched (prevents same GT from also being FN)
- [06-01]: Per-class error counts keyed by predicted class for TP/Hard FP/Label Error, GT class for FN
- [06-02]: Qdrant local disk mode (no Docker) via QdrantClient(path=) for zero-infra similarity search
- [06-02]: Lazy collection sync: Qdrant collection created on first similarity query, not at startup
- [06-02]: Sequential integer IDs for Qdrant points with sample_id in payload (Qdrant requires int/UUID IDs)
- [06-02]: useSimilarity hook uses enabled flag for on-demand fetching (no auto-fetch on mount)
- [06-02]: Empty results return 200 with empty list, not 404 (user sees "no similar images found")
- [07-01]: Lazy agent creation via _get_agent() to defer model resolution until first call
- [07-01]: Error samples passed through AnalysisDeps dataclass (in-memory, not materialized to DuckDB table)
- [07-01]: Confidence distribution computed in-memory from error samples (not DuckDB query)
- [07-01]: Agent endpoint returns 503 with clear message when API key is missing
- [07-03]: useMutation (not useQuery) for agent analysis -- on-demand, long-running (10-30s)
- [07-03]: Purple accent color for Intelligence tab to distinguish from blue evaluation tabs
- [07-03]: 503 error shows actionable configuration instructions (OPENAI_API_KEY, VISIONLENS_AGENT_MODEL)
- [07-02]: VLM model loaded on-demand (not at startup) to avoid memory pressure with DINOv2
- [07-02]: Encode-once optimization: encode_image() called once, query() per tag dimension
- [07-02]: 5 tag dimensions with controlled vocabulary; invalid VLM responses silently discarded
- [07-02]: Tags merged via list_distinct(list_concat(...)) to preserve user-applied tags
- [07-02]: AutoTagButton invalidates both samples and filter-facets caches on completion

### Pending Todos

None.

### Blockers/Concerns

None -- all 21 plans complete.

## Session Continuity

Last session: 2026-02-12
Stopped at: Completed 07-02-PLAN.md (Phase 7, plan 2/3 -- final plan)
Resume file: None
