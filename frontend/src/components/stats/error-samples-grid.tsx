"use client";

/**
 * Compact thumbnail grid for a specific error type.
 *
 * Renders a section with heading, count badge, and clickable
 * thumbnail images that open the SampleModal on click.
 */

import { thumbnailUrl } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import type { ErrorSample } from "@/types/error-analysis";

interface ErrorSamplesGridProps {
  title: string;
  errorType: string;
  samples: ErrorSample[];
  datasetId: string;
  color: string;
}

export function ErrorSamplesGrid({
  title,
  errorType,
  samples,
  datasetId,
  color,
}: ErrorSamplesGridProps) {
  const openDetailModal = useUIStore((s) => s.openDetailModal);

  if (samples.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
          {title}
          <span
            className="text-xs px-1.5 py-0.5 rounded-full text-white"
            style={{ backgroundColor: color }}
          >
            0
          </span>
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 py-4 text-center">
          No {errorType.replace(/_/g, " ")} detections
        </p>
      </div>
    );
  }

  // Deduplicate by sample_id to show unique images
  const seen = new Set<string>();
  const uniqueSamples = samples.filter((s) => {
    if (seen.has(s.sample_id)) return false;
    seen.add(s.sample_id);
    return true;
  });

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
        {title}
        <span
          className="text-xs px-1.5 py-0.5 rounded-full text-white"
          style={{ backgroundColor: color }}
        >
          {samples.length}
        </span>
      </h3>
      <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 gap-2">
        {uniqueSamples.map((sample) => (
          <button
            key={`${sample.sample_id}-${sample.category_name}`}
            onClick={() => openDetailModal(sample.sample_id)}
            className="relative group aspect-square rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-400 transition-colors cursor-pointer"
          >
            <img
              src={thumbnailUrl(datasetId, sample.sample_id, "small")}
              alt={sample.category_name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">
              {sample.category_name}
              {sample.confidence != null && (
                <span className="ml-1 opacity-75">
                  {(sample.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
