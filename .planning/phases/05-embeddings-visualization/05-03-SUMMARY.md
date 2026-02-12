---
phase: 05-embeddings-visualization
plan: 03
subsystem: ui
tags: [deck.gl, scatter-plot, orthographic-view, webgl, embeddings, visualization, react]

# Dependency graph
requires:
  - phase: 05-02
    provides: "t-SNE reduction endpoints, GET /coordinates returning 2D scatter data"
provides:
  - "deck.gl 2D scatter plot with OrthographicView and ScatterplotLayer"
  - "Hover thumbnail tooltip showing image at cursor position"
  - "EmbeddingPanel managing generate/reduce/visualize workflow with SSE progress"
  - "Embeddings tab integrated into dataset page tab system"
  - "TanStack Query hooks for embedding status, coordinates, generate, reduce"
  - "SSE EventSource hook for real-time progress consumption"
affects: ["05-04"]

# Tech tracking
tech-stack:
  added: ["@deck.gl/core@9.2.6", "@deck.gl/layers@9.2.6", "@deck.gl/react@9.2.6", "robust-point-in-polygon@1.0.3"]
  patterns:
    - "deck.gl OrthographicView for non-geographic 2D scatter plots"
    - "useMemo for layer creation to avoid GPU buffer rebuild on re-render"
    - "MutationObserver + key remount for WebGL context loss recovery"
    - "EventSource hook with terminal-status close to prevent auto-reconnect"

key-files:
  created:
    - "frontend/src/types/embedding.ts"
    - "frontend/src/hooks/use-embeddings.ts"
    - "frontend/src/hooks/use-embedding-progress.ts"
    - "frontend/src/components/embedding/embedding-scatter.tsx"
    - "frontend/src/components/embedding/hover-thumbnail.tsx"
    - "frontend/src/components/embedding/embedding-panel.tsx"
  modified:
    - "frontend/package.json"
    - "frontend/src/stores/ui-store.ts"
    - "frontend/src/app/datasets/[datasetId]/page.tsx"

key-decisions:
  - "OrthographicView (not MapView) for abstract 2D embedding data"
  - "MutationObserver to find deck.gl canvas for WebGL context loss listener"
  - "useEffect for terminal-status monitoring (not inline setState during render)"
  - "Named 'progress' event listener + generic onmessage fallback for SSE"
  - "staleTime: Infinity for coordinates (stable until re-reduction)"

patterns-established:
  - "deck.gl scatter plot pattern: OrthographicView + ScatterplotLayer + useMemo layers"
  - "SSE progress hook pattern: EventSource with auto-close on complete/error"
  - "Three-state panel pattern: empty state -> intermediate state -> visualization"
  - "Tab system extension: add to DatasetTab union, TAB_OPTIONS array, and conditional render"

# Metrics
duration: 4min
completed: 2026-02-12
---

# Phase 5 Plan 03: Scatter Plot Visualization Summary

**deck.gl 2D scatter plot with OrthographicView, hover thumbnails, embedding workflow panel, and Embeddings tab integration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-12T02:24:17Z
- **Completed:** 2026-02-12T02:28:57Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- deck.gl scatter plot rendering 2D embedding coordinates with zoom, pan, hover highlighting
- Hover thumbnail tooltip showing image preview at cursor position
- EmbeddingPanel managing full workflow: generate embeddings -> run reduction -> visualize scatter
- SSE progress feedback during generation (with processed/total progress bar) and reduction (spinner)
- "Embeddings" tab added as third tab on dataset page alongside Grid and Statistics
- WebGL context loss recovery via MutationObserver canvas detection and React key remount

## Task Commits

Each task was committed atomically:

1. **Task 1: Install deps, create types and data hooks** - `54ed83b` (feat)
2. **Task 2: Scatter plot, hover thumbnail, panel, tab integration** - `ca1a331` (feat)

## Files Created/Modified

- `frontend/src/types/embedding.ts` - EmbeddingPoint, EmbeddingStatus, EmbeddingProgress TypeScript types
- `frontend/src/hooks/use-embedding-progress.ts` - EventSource SSE hook with auto-close on terminal status
- `frontend/src/hooks/use-embeddings.ts` - TanStack Query hooks: useEmbeddingStatus, useEmbeddingCoordinates, useGenerateEmbeddings, useReduceEmbeddings
- `frontend/src/components/embedding/embedding-scatter.tsx` - deck.gl DeckGL with OrthographicView and ScatterplotLayer
- `frontend/src/components/embedding/hover-thumbnail.tsx` - Tooltip showing image thumbnail on point hover
- `frontend/src/components/embedding/embedding-panel.tsx` - Container with scatter plot, empty state, generate/reduce buttons, progress
- `frontend/package.json` - Added @deck.gl/core, @deck.gl/layers, @deck.gl/react, robust-point-in-polygon
- `frontend/src/stores/ui-store.ts` - Extended DatasetTab type with "embeddings"
- `frontend/src/app/datasets/[datasetId]/page.tsx` - Added Embeddings tab and EmbeddingPanel render

## Decisions Made

- **OrthographicView over MapView:** Embedding coordinates are non-geographic abstract 2D data. MapView adds unnecessary tile-loading overhead and expects lat/lng. OrthographicView is the correct choice per deck.gl docs.
- **MutationObserver for canvas detection:** deck.gl creates the canvas element internally. Used MutationObserver to detect when the canvas appears in the DOM, then attach the webglcontextlost listener.
- **useEffect for state transitions:** Terminal status monitoring (complete/error -> stop generating/reducing) moved to useEffect to avoid calling setState during render.
- **Dual event listeners on SSE:** Backend sends named "progress" events (event: progress), but fallback onmessage handler added for compatibility.
- **staleTime: Infinity for coordinates:** 2D coordinates don't change until a new reduction runs. Query invalidated explicitly by useReduceEmbeddings mutation on success.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed setState during render in EmbeddingPanel**
- **Found during:** Task 2 (EmbeddingPanel implementation)
- **Issue:** Terminal status monitoring (isGenerating/isReducing -> false on complete/error) was implemented as inline conditionals during render, which is a React anti-pattern causing "Cannot update a component while rendering" warnings
- **Fix:** Moved state transitions into useEffect hooks with appropriate dependencies
- **Files modified:** frontend/src/components/embedding/embedding-panel.tsx
- **Verification:** TypeScript compiles, build succeeds, no render-time setState
- **Committed in:** ca1a331 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for correct React lifecycle. No scope creep.

## Issues Encountered

None -- deck.gl v9 types resolved cleanly, all imports worked as expected.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Scatter plot renders all 2D coordinates from GET /coordinates endpoint
- Hover thumbnails use existing thumbnailUrl helper
- Panel handles full embedding workflow lifecycle
- robust-point-in-polygon installed for Plan 04's lasso selection overlay
- No blockers for Plan 04 (lasso selection + cross-filtering)

---
*Phase: 05-embeddings-visualization*
*Completed: 2026-02-12*
