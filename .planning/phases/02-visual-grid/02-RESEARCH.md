# Phase 2: Visual Grid - Research

**Researched:** 2026-02-10
**Domain:** Virtualized image grid, annotation overlays, Next.js frontend scaffolding
**Confidence:** HIGH

## Summary

Phase 2 builds the Next.js frontend application that displays a virtualized grid of 100K+ image thumbnails with bounding box annotation overlays. The backend API from Phase 1 is already complete, providing paginated samples, annotations, and WebP thumbnail serving.

The standard approach combines Next.js 16 (App Router, Turbopack, Tailwind CSS) with TanStack Virtual for grid virtualization, TanStack Query for data fetching with infinite scroll, and SVG overlays for lightweight bounding box rendering on thumbnails. The roadmap proposed react-konva for annotation overlays, but research shows that **SVG overlays are significantly more appropriate** for this use case: we are displaying static bounding boxes on small thumbnails (not interactive annotation editing), and creating a canvas instance per visible thumbnail (40-80 simultaneously) introduces unnecessary memory overhead and complexity. SVG elements are lightweight DOM nodes that scale perfectly with the image container, require no additional dependencies, and render crisply at any size.

For the detail modal (full-resolution view with all annotations), a simple dialog/modal component with SVG overlay is sufficient. The `color-hash` library provides deterministic string-to-color hashing using SHA256 in HSL color space, satisfying the requirement that each class name always maps to the same color across sessions.

**Primary recommendation:** Use TanStack Virtual (dual row+column virtualizers) with TanStack Query's `useInfiniteQuery` for paginated data fetching, SVG-based annotation overlays (not react-konva), and Zustand for cross-component UI state.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.x | React framework (App Router) | Latest stable. Turbopack default bundler, React 19.2, TypeScript-first. Locked stack choice. |
| @tanstack/react-virtual | 3.13.x | Virtualized grid rendering | Headless, framework-agnostic. Dual row+column virtualizers for grid layout. ~10-15kb, 60FPS. |
| @tanstack/react-query | 5.90.x | Server state / data fetching | `useInfiniteQuery` for paginated API calls. Automatic cache management, background refetching, stale-while-revalidate. |
| zustand | 5.0.x | Client UI state management | Lightweight (1kb), no providers needed for simple stores. Per-request store pattern for Next.js App Router. Cross-component state (selected sample, modal open, etc). |
| color-hash | 2.0.2 | Deterministic class-to-color mapping | SHA256-based hash, HSL output. Same string always produces same color. Zero dependencies. |
| Tailwind CSS | 4.x | Styling | Included by default in Next.js 16 create-next-app. Utility-first, no runtime overhead. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-query-devtools | 5.90.x | Query debugging | Dev-only. Inspect cache state, queries, mutations. |
| clsx | latest | Conditional class names | When building dynamic Tailwind class strings. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SVG overlays | react-konva (Canvas) | react-konva is better for interactive annotation editing tools. For static display of bounding boxes on thumbnails, SVG is lighter (no canvas per thumbnail), scales automatically with container, and needs no extra dependencies. Use react-konva only if Phase 4 requires interactive annotation manipulation. |
| SVG overlays | CSS div overlays | CSS divs with borders work but can't easily render diagonal lines or complex shapes. SVG provides `<rect>` with `<text>` labels, scales with viewBox, and handles coordinate transforms cleanly. |
| TanStack Virtual | react-window / react-virtuoso | TanStack Virtual is headless (no opinionated markup), supports grid via dual virtualizers, and is actively maintained by the TanStack ecosystem (pairs with TanStack Query). react-window is simpler but less flexible for custom grid layouts. |
| Zustand | Jotai / Redux Toolkit | Zustand is the simplest for cross-component UI state. Jotai is atom-based (more granular but more boilerplate). Redux is overkill for this phase's state needs. |
| color-hash | Hand-rolled hash | color-hash uses BKDRHash + HSL space with configurable saturation/lightness ranges. Hand-rolling risks poor color distribution and edge cases. |

**Installation:**
```bash
npx create-next-app@latest frontend --app --typescript --tailwind --eslint --turbopack --import-alias "@/*"
cd frontend
npm install @tanstack/react-query @tanstack/react-virtual zustand color-hash
npm install -D @tanstack/react-query-devtools @types/color-hash
```

## Architecture Patterns

### Recommended Project Structure
```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with QueryProvider
│   │   ├── page.tsx                # Home page (dataset selector or redirect)
│   │   └── datasets/
│   │       └── [datasetId]/
│   │           └── page.tsx        # Grid view for a dataset
│   ├── components/
│   │   ├── providers/
│   │   │   └── query-provider.tsx  # TanStack Query client provider ('use client')
│   │   ├── grid/
│   │   │   ├── image-grid.tsx      # Virtualized grid container
│   │   │   ├── grid-cell.tsx       # Single thumbnail cell with annotations
│   │   │   └── annotation-overlay.tsx  # SVG bounding box overlay
│   │   ├── detail/
│   │   │   ├── sample-modal.tsx    # Full-resolution detail modal
│   │   │   └── annotation-list.tsx # Annotation metadata table
│   │   └── ui/                     # Shared UI primitives
│   ├── hooks/
│   │   ├── use-samples.ts          # useInfiniteQuery for paginated samples
│   │   ├── use-annotations.ts      # useQuery for sample annotations
│   │   └── use-dataset.ts          # useQuery for dataset details
│   ├── lib/
│   │   ├── api.ts                  # Fetch wrapper for backend API
│   │   ├── color-hash.ts           # Configured color-hash instance
│   │   └── constants.ts            # API base URL, grid config constants
│   ├── stores/
│   │   └── ui-store.ts             # Zustand store for UI state
│   └── types/
│       ├── sample.ts               # Sample, PaginatedSamples types
│       ├── annotation.ts           # Annotation, BBox types
│       └── dataset.ts              # Dataset types
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

### Pattern 1: Virtualized Grid with Infinite Scroll
**What:** Combine TanStack Virtual's dual virtualizers (rows + columns) with TanStack Query's `useInfiniteQuery` to create a scrollable grid that fetches pages of samples on demand.
**When to use:** Always -- this is the core rendering pattern for the 100K+ image grid.
**Example:**
```typescript
// Source: TanStack Virtual docs + TanStack Query infinite scroll example
'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useEffect, useCallback } from 'react';

const COLUMNS = 6; // adjustable based on viewport
const CELL_SIZE = 256; // thumbnail size in px
const PAGE_SIZE = 50; // matches API limit

function ImageGrid({ datasetId }: { datasetId: string }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['samples', datasetId],
    queryFn: ({ pageParam = 0 }) =>
      fetchSamples(datasetId, pageParam, PAGE_SIZE),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
  });

  const allSamples = data?.pages.flatMap((page) => page.items) ?? [];
  const rowCount = Math.ceil(allSamples.length / COLUMNS);
  const totalRows = hasNextPage ? rowCount + 1 : rowCount;

  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CELL_SIZE,
    overscan: 3, // pre-render 3 rows above/below viewport
  });

  // Fetch next page when scrolling near the end
  useEffect(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;

    if (
      lastItem.index >= rowCount - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage();
    }
  }, [rowVirtualizer.getVirtualItems(), hasNextPage, isFetchingNextPage]);

  return (
    <div
      ref={parentRef}
      style={{ height: '100vh', overflow: 'auto' }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
              display: 'grid',
              gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
              gap: '4px',
            }}
          >
            {Array.from({ length: COLUMNS }).map((_, colIdx) => {
              const sampleIdx = virtualRow.index * COLUMNS + colIdx;
              const sample = allSamples[sampleIdx];
              if (!sample) return <div key={colIdx} />;
              return (
                <GridCell
                  key={sample.id}
                  sample={sample}
                  datasetId={datasetId}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Pattern 2: SVG Annotation Overlay
**What:** Render bounding boxes as an SVG layer absolutely positioned over the thumbnail image.
**When to use:** For every grid cell that has annotations.
**Example:**
```typescript
// Source: Standard SVG overlay pattern for image annotations
interface Annotation {
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  category_name: string;
}

interface AnnotationOverlayProps {
  annotations: Annotation[];
  imageWidth: number;    // original image dimensions
  imageHeight: number;
  getColor: (className: string) => string;
}

function AnnotationOverlay({
  annotations,
  imageWidth,
  imageHeight,
  getColor,
}: AnnotationOverlayProps) {
  return (
    <svg
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      className="absolute inset-0 w-full h-full pointer-events-none"
      preserveAspectRatio="xMidYMid meet"
    >
      {annotations.map((ann, i) => {
        const color = getColor(ann.category_name);
        return (
          <g key={i}>
            <rect
              x={ann.bbox_x}
              y={ann.bbox_y}
              width={ann.bbox_w}
              height={ann.bbox_h}
              fill="none"
              stroke={color}
              strokeWidth={Math.max(imageWidth * 0.003, 2)}
            />
            <text
              x={ann.bbox_x}
              y={ann.bbox_y - 4}
              fill={color}
              fontSize={Math.max(imageWidth * 0.015, 10)}
              fontWeight="bold"
            >
              {ann.category_name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
```

### Pattern 3: Deterministic Color Hashing
**What:** Use `color-hash` library to generate consistent HSL colors from class name strings.
**When to use:** Whenever rendering annotation colors for category names.
**Example:**
```typescript
// Source: color-hash npm docs (https://github.com/zenozeng/color-hash)
import ColorHash from 'color-hash';

// Create a single instance -- reuse across the app
const colorHash = new ColorHash({
  saturation: [0.6, 0.7, 0.8],   // vibrant but not neon
  lightness: [0.45, 0.55, 0.65], // readable on both light/dark backgrounds
});

export function getClassColor(className: string): string {
  return colorHash.hex(className);
  // e.g., "person" -> "#a34f2d" (always the same)
  // e.g., "car"    -> "#2d7fa3" (always the same)
}
```

### Pattern 4: Zustand UI Store (Next.js App Router)
**What:** Client-side UI state for modal, selected sample, and grid configuration.
**When to use:** For state shared across components (modal open/close, selected sample for detail view).
**Example:**
```typescript
// Source: Zustand docs - Next.js guide (https://zustand.docs.pmnd.rs/guides/nextjs)
import { create } from 'zustand';

interface UIState {
  // Detail modal
  selectedSampleId: string | null;
  isDetailModalOpen: boolean;
  openDetailModal: (sampleId: string) => void;
  closeDetailModal: () => void;

  // Grid config
  columnsPerRow: number;
  setColumnsPerRow: (cols: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSampleId: null,
  isDetailModalOpen: false,
  openDetailModal: (sampleId) =>
    set({ selectedSampleId: sampleId, isDetailModalOpen: true }),
  closeDetailModal: () =>
    set({ selectedSampleId: null, isDetailModalOpen: false }),

  columnsPerRow: 6,
  setColumnsPerRow: (cols) => set({ columnsPerRow: cols }),
}));
```

### Anti-Patterns to Avoid
- **One canvas per thumbnail:** Creating a react-konva Stage/Layer for each grid cell means 40-80+ canvas elements. Each Konva layer creates TWO canvas elements (scene + hit graph). Use SVG overlays instead.
- **Fetching all samples at once:** Never load 100K+ sample records into memory. Use `useInfiniteQuery` with paginated API.
- **Storing fetched data in Zustand:** Server data (samples, annotations) belongs in TanStack Query cache, not Zustand. Zustand is for UI state only (modal open, selected item, grid columns).
- **Object URLs without cleanup:** If using `URL.createObjectURL` for blob caching, always revoke when entries are evicted. Better approach: rely on browser HTTP cache for thumbnails (the backend already serves WebP with proper content types) and use `<img src={thumbnailUrl}>` directly.
- **Responsive columns without debounce:** Recalculating column count on every pixel of resize is expensive. Debounce or use CSS container queries.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Virtualized scrolling | Custom intersection observer + DOM recycling | @tanstack/react-virtual | Scroll physics, overscan, dynamic sizing, and measurement caching are subtle. Library handles edge cases around rapid scrolling, resize, and remounting. |
| Infinite scroll pagination | Custom scroll event + offset tracking | @tanstack/react-query useInfiniteQuery | Page merging, background refetch, stale data handling, error retry, and cache invalidation are complex. Library handles all of this. |
| Deterministic string-to-color | Custom hash function + HSL conversion | color-hash library | Needs uniform distribution across hue space, configurable saturation/lightness ranges, and collision avoidance. Library uses BKDRHash with proven distribution. |
| Image loading states | Custom loading/error/success tracking per image | Browser `<img>` with onLoad/onError + CSS transitions | Browser handles image decoding, caching, and progressive rendering natively. Add skeleton placeholders via CSS. |
| Modal overlay | Custom portal + focus trap + escape handling | HTML `<dialog>` element or headless UI library | Native `<dialog>` handles focus trapping, backdrop, escape key, and accessibility. Available in all modern browsers. |

**Key insight:** The main complexity in this phase is orchestrating the interaction between virtualization, pagination, and annotation data. Each individual piece has a mature library. The challenge is wiring them together correctly.

## Common Pitfalls

### Pitfall 1: Annotation Data Fetching Strategy
**What goes wrong:** Fetching annotations for every visible thumbnail creates a waterfall of API calls (40-80 requests per scroll position).
**Why it happens:** The current API serves annotations per-sample (`GET /samples/{id}/annotations`), so naively fetching them for each visible cell creates too many requests.
**How to avoid:** Two approaches (implement approach A first, add B if needed):
  - **(A) Batch on backend:** Add a bulk endpoint like `GET /annotations?dataset_id=X&sample_ids=id1,id2,id3` that returns annotations for multiple samples in one call. Fetch annotations for the visible batch of samples in a single request.
  - **(B) Eager include:** Modify `GET /samples` to optionally include annotations inline (`?include_annotations=true`), so each page response includes both sample metadata and annotations.
**Warning signs:** Network tab showing 50+ annotation requests per scroll event.

### Pitfall 2: SVG Coordinate Scaling
**What goes wrong:** Bounding boxes render at wrong positions or sizes because SVG viewBox doesn't match the annotation coordinate space.
**Why it happens:** Annotations store coordinates in original image pixel space (e.g., x=100, y=200 on a 1920x1080 image), but thumbnails are 256px. If the SVG viewBox doesn't match the original image dimensions, boxes will be misaligned.
**How to avoid:** Set SVG `viewBox="0 0 {originalWidth} {originalHeight}"` and let `preserveAspectRatio="xMidYMid meet"` handle scaling. The SVG coordinate system will match the annotation coordinate system automatically.
**Warning signs:** Boxes appearing in the wrong location or scaled incorrectly, especially for images with non-square aspect ratios.

### Pitfall 3: Memory Pressure from Image Elements
**What goes wrong:** Browser runs out of memory or becomes sluggish when scrolling through thousands of images.
**Why it happens:** Even with virtualization, if old `<img>` elements retain references to decoded bitmaps in memory, scrolling through 100K images accumulates memory.
**How to avoid:**
  - Rely on browser's native image cache (HTTP caching). The backend already serves WebP thumbnails with proper content types. Set appropriate `Cache-Control` headers on the backend.
  - Use `loading="lazy"` on `<img>` tags as a secondary defense (virtualization is primary).
  - Do NOT create blob URLs (`URL.createObjectURL`) for thumbnails -- this bypasses the browser's image cache and creates manual memory management burden.
  - Let the virtualizer unmount off-screen images; the browser will release their decoded bitmap memory.
**Warning signs:** Memory usage in Chrome DevTools climbing steadily without plateauing during scroll.

### Pitfall 4: TanStack Query Stale Time Configuration
**What goes wrong:** Every scroll that re-renders visible items triggers refetching of already-loaded pages, causing flickering and unnecessary network calls.
**Why it happens:** Default `staleTime` is 0 in TanStack Query, meaning data is considered stale immediately.
**How to avoid:** Set `staleTime: 5 * 60 * 1000` (5 minutes) for sample data, since dataset contents don't change during a browsing session. Set `gcTime` (garbage collection time) to 30 minutes to keep pages in cache during long sessions.
**Warning signs:** Network tab showing repeated requests for the same page of samples.

### Pitfall 5: Next.js App Router Client Component Boundary
**What goes wrong:** Components using hooks (`useVirtualizer`, `useInfiniteQuery`, `useRef`) fail because they're treated as Server Components.
**Why it happens:** In Next.js App Router, all components are Server Components by default. Hooks require Client Components.
**How to avoid:** Add `'use client'` directive at the top of any component using React hooks or browser APIs. Structure the app so that the page layout is a Server Component that renders a Client Component for the interactive grid.
**Warning signs:** Build error "useRef only works in Client Components."

### Pitfall 6: Grid Column Count vs Virtualizer Count Mismatch
**What goes wrong:** Grid shows blank spaces, duplicate items, or skips items because the virtualizer row count doesn't match the actual number of rows needed.
**Why it happens:** When total items change (new page loaded), the row count must be recalculated: `Math.ceil(totalItems / columns)`. If columns change (responsive), both the virtualizer count and item indexing must update atomically.
**How to avoid:** Derive row count as: `const rowCount = Math.ceil(allSamples.length / columns)`. Item index within a row: `rowIndex * columns + colIndex`. Always recompute both when either `allSamples` or `columns` changes.
**Warning signs:** Empty cells in the last row, or items appearing in wrong grid positions after page load.

## Code Examples

Verified patterns from official sources:

### TanStack Query Provider for Next.js App Router
```typescript
// Source: TanStack Query Next.js example (https://tanstack.com/query/v5/docs/framework/react/examples/nextjs)
// src/components/providers/query-provider.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, type ReactNode } from 'react';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,  // 5 minutes
            gcTime: 30 * 60 * 1000,     // 30 minutes
            refetchOnWindowFocus: false, // dataset doesn't change during session
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

### API Fetch Wrapper
```typescript
// src/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function thumbnailUrl(datasetId: string, sampleId: string, size = 'medium'): string {
  return `${API_BASE}/images/${datasetId}/${sampleId}?size=${size}`;
}

export function fullImageUrl(datasetId: string, sampleId: string): string {
  return `${API_BASE}/images/${datasetId}/${sampleId}?size=original`;
}
```

### Samples Infinite Query Hook
```typescript
// src/hooks/use-samples.ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { PaginatedSamples } from '@/types/sample';

const PAGE_SIZE = 50;

export function useSamples(datasetId: string) {
  return useInfiniteQuery({
    queryKey: ['samples', datasetId],
    queryFn: ({ pageParam = 0 }) =>
      apiFetch<PaginatedSamples>(
        `/samples?dataset_id=${datasetId}&offset=${pageParam}&limit=${PAGE_SIZE}`
      ),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
  });
}
```

### Grid Cell with SVG Overlay
```typescript
// src/components/grid/grid-cell.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { thumbnailUrl, apiFetch } from '@/lib/api';
import { getClassColor } from '@/lib/color-hash';
import { useUIStore } from '@/stores/ui-store';
import { AnnotationOverlay } from './annotation-overlay';
import type { Sample } from '@/types/sample';
import type { Annotation } from '@/types/annotation';

interface GridCellProps {
  sample: Sample;
  datasetId: string;
}

export function GridCell({ sample, datasetId }: GridCellProps) {
  const openDetailModal = useUIStore((s) => s.openDetailModal);

  const { data: annotations } = useQuery({
    queryKey: ['annotations', sample.id, datasetId],
    queryFn: () =>
      apiFetch<Annotation[]>(
        `/samples/${sample.id}/annotations?dataset_id=${datasetId}`
      ),
    staleTime: Infinity, // annotations don't change during session
  });

  return (
    <button
      onClick={() => openDetailModal(sample.id)}
      className="relative aspect-square overflow-hidden rounded bg-gray-100 cursor-pointer hover:ring-2 hover:ring-blue-500 transition-shadow"
    >
      <img
        src={thumbnailUrl(datasetId, sample.id)}
        alt={sample.file_name}
        className="w-full h-full object-cover"
        loading="lazy"
        decoding="async"
      />
      {annotations && annotations.length > 0 && (
        <AnnotationOverlay
          annotations={annotations}
          imageWidth={sample.width}
          imageHeight={sample.height}
          getColor={getClassColor}
        />
      )}
    </button>
  );
}
```

### Detail Modal with Full-Resolution Image
```typescript
// src/components/detail/sample-modal.tsx
'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fullImageUrl, apiFetch } from '@/lib/api';
import { getClassColor } from '@/lib/color-hash';
import { useUIStore } from '@/stores/ui-store';
import { AnnotationOverlay } from '@/components/grid/annotation-overlay';
import type { Sample } from '@/types/sample';
import type { Annotation } from '@/types/annotation';

export function SampleModal({ datasetId }: { datasetId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { selectedSampleId, isDetailModalOpen, closeDetailModal } =
    useUIStore();

  const { data: sample } = useQuery({
    queryKey: ['sample-detail', selectedSampleId],
    queryFn: () =>
      apiFetch<Sample>(
        `/samples?dataset_id=${datasetId}&limit=1&offset=0`
        // Note: may need a GET /samples/{id} endpoint
      ),
    enabled: !!selectedSampleId,
  });

  const { data: annotations } = useQuery({
    queryKey: ['annotations', selectedSampleId, datasetId],
    queryFn: () =>
      apiFetch<Annotation[]>(
        `/samples/${selectedSampleId}/annotations?dataset_id=${datasetId}`
      ),
    enabled: !!selectedSampleId,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (isDetailModalOpen) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [isDetailModalOpen]);

  return (
    <dialog
      ref={dialogRef}
      onClose={closeDetailModal}
      className="backdrop:bg-black/50 bg-white rounded-lg shadow-xl max-w-5xl w-full p-0"
    >
      {selectedSampleId && sample && (
        <div className="flex flex-col">
          {/* Full-res image with annotations */}
          <div className="relative">
            <img
              src={fullImageUrl(datasetId, selectedSampleId)}
              alt={sample.file_name}
              className="w-full h-auto"
            />
            {annotations && (
              <AnnotationOverlay
                annotations={annotations}
                imageWidth={sample.width}
                imageHeight={sample.height}
                getColor={getClassColor}
              />
            )}
          </div>
          {/* Metadata panel */}
          <div className="p-4">
            <h2 className="text-lg font-semibold">{sample.file_name}</h2>
            <p className="text-sm text-gray-500">
              {sample.width} x {sample.height}
            </p>
            {/* Annotation list table would go here */}
          </div>
        </div>
      )}
    </dialog>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-window / react-virtualized | @tanstack/react-virtual 3.x | 2023+ | Headless, smaller bundle, supports grid via dual virtualizers. react-window still works but is less actively maintained. |
| React Query v4 | TanStack Query v5 | 2023 | Renamed from react-query. `gcTime` replaces `cacheTime`. `useInfiniteQuery` uses `initialPageParam`. |
| Next.js Pages Router | Next.js App Router (default since Next.js 13.4) | 2023+ | Server Components by default, `'use client'` directive, new data fetching patterns. Next.js 16 makes Turbopack default. |
| Custom fetch + useEffect | TanStack Query | 2020+ | Eliminates custom loading/error/caching state management. |
| canvas annotation overlays | SVG overlays for static display | Ongoing | Canvas still preferred for interactive editing. SVG preferred for static visualization in grids. |
| middleware.ts | proxy.ts (Next.js 16) | Oct 2025 | Renamed for clarity. middleware.ts deprecated. |
| Zustand global store | Zustand per-request store (Next.js) | 2024+ | Prevents state sharing across SSR requests. Use `createStore` + Context pattern for SSR safety. |

**Deprecated/outdated:**
- `cacheTime` in TanStack Query: renamed to `gcTime` in v5
- `useInfiniteQuery` without `initialPageParam`: required in v5
- `middleware.ts` in Next.js 16: renamed to `proxy.ts`
- `experimental.ppr` and `experimental.dynamicIO` flags removed in Next.js 16

## Open Questions

Things that couldn't be fully resolved:

1. **Batch annotation fetching endpoint**
   - What we know: Current API serves annotations per-sample. Grid shows 40-80 thumbnails simultaneously, creating many requests.
   - What's unclear: Whether to add a batch endpoint to Phase 1 API or handle via the `include_annotations` query parameter approach.
   - Recommendation: Add a bulk `GET /annotations?dataset_id=X&sample_ids=id1,id2,...` endpoint as the first task of Phase 2 (backend modification), or prefetch annotations for the current page of samples in a single batch query. Alternatively, modify `GET /samples` to accept `include_annotations=true` that inlines annotation data.

2. **Grid column responsiveness approach**
   - What we know: Grid should adapt columns to viewport width. TanStack Virtual needs to know column count to compute row count.
   - What's unclear: Whether to use CSS container queries, a ResizeObserver, or a window resize listener with debounce.
   - Recommendation: Use a ResizeObserver on the grid container with 200ms debounce. Compute columns as `Math.floor(containerWidth / minCellWidth)` clamped between 3 and 10.

3. **Backend Cache-Control headers for thumbnails**
   - What we know: Backend serves WebP thumbnails. Browser image caching depends on Cache-Control headers.
   - What's unclear: Whether Phase 1 backend sets Cache-Control headers on image responses.
   - Recommendation: Verify during implementation. If missing, add `Cache-Control: public, max-age=86400` to image responses in the images router.

4. **Zustand store pattern for Next.js App Router**
   - What we know: Zustand docs recommend per-request stores with Context provider for SSR safety.
   - What's unclear: For a predominantly client-side app (the grid is entirely client-rendered), whether the simpler global `create()` pattern is sufficient.
   - Recommendation: Since the grid page is a `'use client'` component tree with no meaningful SSR state, use the simpler `create()` pattern (global store). Only switch to per-request pattern if SSR state hydration becomes necessary.

## Sources

### Primary (HIGH confidence)
- npm registry: @tanstack/react-virtual 3.13.18, @tanstack/react-query 5.90.20, zustand 5.0.11, color-hash 2.0.2, konva 10.2.0, react-konva 19.2.2, Next.js 16.1.6
- Next.js 16 blog post (https://nextjs.org/blog/next-16) - features, defaults, breaking changes
- Zustand Next.js guide (https://zustand.docs.pmnd.rs/guides/nextjs) - per-request store pattern
- Konva performance tips (https://konvajs.org/docs/performance/All_Performance_Tips.html) - canvas overhead analysis
- TanStack Virtual grid pattern (https://adamcollier.co.uk/posts/using-tanstack-virtual-and-window-virtualisation-for-a-grid-of-items) - dual virtualizer approach
- color-hash GitHub (https://github.com/zenozeng/color-hash) - SHA256 + HSL hashing

### Secondary (MEDIUM confidence)
- TanStack Virtual + TanStack Query infinite scroll integration pattern - verified across official examples and multiple community sources
- SVG vs Canvas for annotation display - architectural reasoning from Konva docs (each layer = 2 canvas elements) and SVG scaling docs
- Next.js 16 create-next-app defaults (TypeScript, Tailwind, Turbopack, App Router) - from official blog

### Tertiary (LOW confidence)
- Specific performance numbers for SVG vs Canvas at thumbnail grid scale (40-80 visible elements) - no benchmarks found, recommendation based on architectural analysis of DOM weight
- TanStack Query blob URL disposal pattern - single GitHub discussion, pattern not in official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all library versions verified via npm registry, Next.js features verified via official blog
- Architecture: HIGH - patterns verified via official docs and examples for TanStack Virtual, TanStack Query, and Zustand
- Pitfalls: HIGH - annotation coordinate scaling and memory management are well-documented concerns; batch fetching is based on analysis of current API design
- SVG vs react-konva decision: MEDIUM - architectural reasoning is sound (each Konva layer = 2 canvases, 40-80 visible cells), but no direct benchmark comparison found. SVG is clearly lighter for static display.

**Research date:** 2026-02-10
**Valid until:** 2026-03-12 (30 days - ecosystem is stable, libraries are mature)
