/**
 * Virtualized image grid with infinite scroll.
 *
 * Only visible rows are rendered in the DOM (via @tanstack/react-virtual).
 * Columns are handled by CSS grid -- only rows are virtualized.
 * Scrolling near the bottom triggers fetchNextPage via useInfiniteQuery.
 * Column count is responsive via ResizeObserver on the scroll container.
 *
 * When selection mode is active, a floating action bar at the bottom
 * provides "Select All Visible" and "Clear Selection" controls.
 */

"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useAnnotationsBatch } from "@/hooks/use-annotations";
import { useSamples } from "@/hooks/use-samples";
import { useUIStore } from "@/stores/ui-store";
import { useFilterStore } from "@/stores/filter-store";
import { MIN_CELL_WIDTH, MIN_COLUMNS, MAX_COLUMNS } from "@/lib/constants";
import { GridCell } from "./grid-cell";

interface ImageGridProps {
  datasetId: string;
}

export function ImageGrid({ datasetId }: ImageGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const columnsPerRow = useUIStore((s) => s.columnsPerRow);
  const setColumnsPerRow = useUIStore((s) => s.setColumnsPerRow);

  const isSelecting = useFilterStore((s) => s.isSelecting);
  const selectedSampleIds = useFilterStore((s) => s.selectedSampleIds);
  const selectAllVisible = useFilterStore((s) => s.selectAllVisible);
  const clearSelection = useFilterStore((s) => s.clearSelection);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useSamples(datasetId);

  // Flatten all pages into a single array of samples
  const allSamples = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const totalCount = data?.pages[0]?.total ?? 0;
  const rowCount = Math.ceil(allSamples.length / columnsPerRow);
  // Add +1 row when there are more pages to load (triggers prefetch)
  const totalRows = hasNextPage ? rowCount + 1 : rowCount;

  // Compute estimated cell height: square cell + filename label (~24px)
  const estimateCellHeight = useCallback(() => {
    if (!parentRef.current) return 230;
    const containerWidth = parentRef.current.clientWidth;
    const gap = 8; // gap-2 = 8px
    const cellWidth =
      (containerWidth - gap * (columnsPerRow - 1)) / columnsPerRow;
    return cellWidth + 24; // square image + filename label
  }, [columnsPerRow]);

  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateCellHeight,
    overscan: 3,
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
  }, [
    rowVirtualizer.getVirtualItems(),
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    rowCount,
  ]);

  // Collect sample IDs from visible virtual rows for batch annotation fetch
  const visibleSampleIds = useMemo(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    const ids: string[] = [];
    for (const vRow of virtualItems) {
      for (let col = 0; col < columnsPerRow; col++) {
        const idx = vRow.index * columnsPerRow + col;
        const sample = allSamples[idx];
        if (sample) ids.push(sample.id);
      }
    }
    return ids;
  }, [rowVirtualizer.getVirtualItems(), allSamples, columnsPerRow]);

  // Batch-fetch annotations for all visible samples in a single request
  const { data: annotationMap } = useAnnotationsBatch(
    datasetId,
    visibleSampleIds,
  );

  // Responsive column count via ResizeObserver with 200ms debounce
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const entry = entries[0];
        if (!entry) return;
        const width = entry.contentRect.width;
        const cols = Math.floor(width / MIN_CELL_WIDTH);
        const clamped = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, cols));
        setColumnsPerRow(clamped);
      }, 200);
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [setColumnsPerRow]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-zinc-500 dark:text-zinc-400">Loading samples...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
        <p className="text-red-700 dark:text-red-300">
          Failed to load samples. Is the backend running?
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-sm text-zinc-500 dark:text-zinc-400">
        <span>
          Showing {allSamples.length.toLocaleString()} of{" "}
          {totalCount.toLocaleString()} samples
        </span>
        <span>{columnsPerRow} columns</span>
      </div>

      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columnsPerRow}, 1fr)`,
                gap: "8px",
                padding: "0 16px",
              }}
            >
              {Array.from({ length: columnsPerRow }).map((_, colIdx) => {
                const sampleIdx = virtualRow.index * columnsPerRow + colIdx;
                const sample = allSamples[sampleIdx];
                if (!sample) return <div key={colIdx} />;
                return (
                  <GridCell
                    key={sample.id}
                    sample={sample}
                    datasetId={datasetId}
                    annotations={annotationMap?.[sample.id] ?? []}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Loading more...
            </p>
          </div>
        )}
      </div>

      {/* Floating selection action bar */}
      {isSelecting && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">
            {selectedSampleIds.size} selected
          </span>
          <button
            onClick={() =>
              selectAllVisible(allSamples.map((s) => s.id))
            }
            className="rounded bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
          >
            Select All Visible
          </button>
          <button
            onClick={clearSelection}
            className="rounded bg-zinc-100 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
          >
            Clear Selection
          </button>
        </div>
      )}
    </div>
  );
}
