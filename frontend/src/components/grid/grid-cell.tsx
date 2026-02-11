"use client";

import { thumbnailUrl } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import type { Sample } from "@/types/sample";

interface GridCellProps {
  sample: Sample;
  datasetId: string;
}

/**
 * Single thumbnail cell in the image grid.
 *
 * Renders a clickable button with the sample's thumbnail image.
 * Uses the backend thumbnail URL directly (browser HTTP cache handles caching).
 * Clicking opens the detail modal (wired but modal not built yet).
 */
export function GridCell({ sample, datasetId }: GridCellProps) {
  const openDetailModal = useUIStore((s) => s.openDetailModal);

  return (
    <button
      onClick={() => openDetailModal(sample.id)}
      className="group relative flex flex-col overflow-hidden rounded bg-zinc-100 transition-shadow hover:ring-2 hover:ring-blue-500 dark:bg-zinc-800"
    >
      <div className="relative aspect-square overflow-hidden">
        <img
          src={thumbnailUrl(datasetId, sample.id)}
          alt={sample.file_name}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </div>
      <span className="truncate px-1.5 py-1 text-xs text-zinc-600 dark:text-zinc-400">
        {sample.file_name}
      </span>
    </button>
  );
}
