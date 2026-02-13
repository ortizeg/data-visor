/**
 * Single thumbnail cell in the image grid.
 *
 * Renders a clickable button with the sample's thumbnail image
 * and an SVG annotation overlay showing bounding boxes with class labels.
 * Annotations are passed down from the grid (batch-fetched), not fetched per-cell.
 *
 * When selection mode is active, shows a checkbox overlay and toggles
 * selection instead of opening the detail modal. Tag badges are displayed
 * below the filename for tagged samples.
 */

"use client";

import { thumbnailUrl } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import { useFilterStore } from "@/stores/filter-store";
import type { Annotation } from "@/types/annotation";
import type { Sample } from "@/types/sample";
import { AnnotationOverlay } from "./annotation-overlay";

/** Color map for triage tag badges; non-triage tags use default blue. */
function triageTagStyle(tag: string): string {
  switch (tag) {
    case "triage:tp":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "triage:fp":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "triage:fn":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "triage:mistake":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
    default:
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
  }
}

interface GridCellProps {
  sample: Sample;
  datasetId: string;
  /** Annotations for this sample (fetched at grid level, not per-cell). */
  annotations: Annotation[];
}

export function GridCell({ sample, datasetId, annotations }: GridCellProps) {
  const openDetailModal = useUIStore((s) => s.openDetailModal);
  const isSelecting = useFilterStore((s) => s.isSelecting);
  const selectedSampleIds = useFilterStore((s) => s.selectedSampleIds);
  const toggleSampleSelection = useFilterStore(
    (s) => s.toggleSampleSelection,
  );

  const isHighlightMode = useUIStore((s) => s.isHighlightMode);

  const isSelected = selectedSampleIds.has(sample.id);
  const tags = sample.tags ?? [];
  const hasTriageTag = tags.some((t) => t.startsWith("triage:"));
  const visibleTags = tags.slice(0, 3);
  const extraTagCount = tags.length - 3;

  function handleClick() {
    if (isSelecting) {
      toggleSampleSelection(sample.id);
    } else {
      openDetailModal(sample.id);
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`group relative flex flex-col overflow-hidden rounded bg-zinc-100 transition-shadow hover:ring-2 hover:ring-blue-500 dark:bg-zinc-800 ${
        isSelected
          ? "ring-2 ring-blue-500"
          : ""
      } ${isHighlightMode && !hasTriageTag ? "opacity-20" : ""}`}
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
            aspectMode="slice"
          />
        )}
        {/* Selection checkbox overlay */}
        {isSelecting && (
          <div className="absolute left-1.5 top-1.5 z-10">
            <div
              className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
                isSelected
                  ? "border-blue-500 bg-blue-500"
                  : "border-white bg-white/70 dark:border-zinc-300 dark:bg-zinc-800/70"
              }`}
            >
              {isSelected && (
                <svg
                  viewBox="0 0 16 16"
                  className="h-3 w-3 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path d="M3 8l3 3 7-7" />
                </svg>
              )}
            </div>
          </div>
        )}
      </div>
      <span className="truncate px-1.5 py-1 text-xs text-zinc-600 dark:text-zinc-400">
        {sample.file_name}
      </span>
      {/* Tag badges */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1.5 pb-1">
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className={`rounded px-1 py-0.5 text-[10px] ${triageTagStyle(tag)}`}
            >
              {tag.startsWith("triage:") ? tag.slice(7).toUpperCase() : tag}
            </span>
          ))}
          {extraTagCount > 0 && (
            <span className="rounded bg-zinc-200 px-1 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">
              +{extraTagCount} more
            </span>
          )}
        </div>
      )}
    </button>
  );
}
