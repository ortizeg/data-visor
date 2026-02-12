# DataVisor Frontend

Next.js frontend for DataVisor -- a unified CV dataset introspection tool.

## Setup

```bash
# Install dependencies
npm install

# Start development server (http://localhost:3000)
npm run dev

# Production build
npm run build
npm start

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

## Prerequisites

The backend API must be running at `http://localhost:8000`. See the [root README](../README.md) for backend setup.

## Tech Stack

| Library | Purpose |
|---------|---------|
| Next.js 16 | App Router, React Server Components |
| React 19 | UI rendering |
| Tailwind CSS 4 | Styling |
| Zustand | State management (3 stores: ui, filter, embedding) |
| TanStack Query | Data fetching + caching |
| TanStack Virtual | Virtualized infinite-scroll grid |
| deck.gl | WebGL embedding scatter plot |
| Recharts | Statistics charts |
| color-hash | Deterministic class-to-color mapping |

## Directory Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── page.tsx            # Dataset list (home)
│   ├── layout.tsx          # Root layout + providers
│   └── datasets/
│       └── [datasetId]/
│           └── page.tsx    # Dataset browser (grid/stats/embeddings)
├── components/
│   ├── filters/            # Sidebar filter controls
│   ├── grid/               # Image grid + annotation overlays
│   ├── stats/              # Statistics dashboard + sub-tabs
│   ├── toolbar/            # Top toolbar controls
│   ├── embeddings/         # deck.gl scatter plot + lasso
│   ├── modal/              # Sample detail modal
│   └── providers/          # TanStack Query provider
├── stores/
│   ├── ui-store.ts         # Tab state, overlay mode
│   ├── filter-store.ts     # Metadata filters, search, sort
│   └── embedding-store.ts  # Lasso selection, scatter state
├── hooks/
│   ├── use-samples.ts      # Main data hook (combines filters + lasso)
│   ├── use-annotations.ts  # Annotation fetching
│   ├── use-filter-facets.ts# Filter option counts
│   └── ...
├── lib/
│   ├── api.ts              # Typed fetch wrapper
│   └── color-hash.ts       # Deterministic class coloring
└── types/                  # TypeScript type definitions
```

## State Management

Three Zustand stores compose at the hook level:

- **ui-store** -- Active tab, overlay mode, modal state
- **filter-store** -- Category, split, tag, search, sort, saved views
- **embedding-store** -- Lasso-selected sample IDs from scatter plot

`useSamples()` reads from both filter-store and embedding-store to produce the unified query key for TanStack Query.

## API Communication

All API calls go through `lib/api.ts` which provides a typed `apiFetch<T>()` wrapper pointing at `http://localhost:8000`. TanStack Query handles caching, refetching, and stale time.

## Key Patterns

- **Virtualized grid**: TanStack Virtual renders only visible rows; columns via CSS grid
- **Batch annotations**: Grid fetches annotations for all visible sample IDs in one request
- **SVG overlays**: Bounding boxes rendered as SVG with `viewBox` matching original image dimensions
- **Cross-filtering**: Lasso selection in embedding scatter updates embedding-store, which `useSamples()` reads to add `sample_ids` filter param
- **Debounced sliders**: IoU/confidence sliders debounce 300ms before triggering TanStack Query refetch
