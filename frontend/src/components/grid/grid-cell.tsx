"use client";

import { thumbnailUrl } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import type { Annotation } from "@/types/annotation";
import type { Sample } from "@/types/sample";
import { AnnotationOverlay } from "./annotation-overlay";

interface GridCellProps {
  sample: Sample;
  datasetId: string;
  /** Annotations for this sample (fetched at grid level, not per-cell). */
  annotations: Annotation[];
}

/**
 * Single thumbnail cell in the image grid.
 *
 * Renders a clickable button with the sample's thumbnail image
 * and an SVG annotation overlay showing bounding boxes with class labels.
 * Annotations are passed down from the grid (batch-fetched), not fetched per-cell.
 */
export function GridCell({ sample, datasetId, annotations }: GridCellProps) {
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
        {annotations.length > 0 && (
          <AnnotationOverlay
            annotations={annotations}
            imageWidth={sample.width}
            imageHeight={sample.height}
          />
        )}
      </div>
      <span className="truncate px-1.5 py-1 text-xs text-zinc-600 dark:text-zinc-400">
        {sample.file_name}
      </span>
    </button>
  );
}
