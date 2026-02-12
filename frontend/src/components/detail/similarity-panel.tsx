/**
 * Panel showing visually similar images as a thumbnail grid with
 * cosine similarity scores.
 *
 * Rendered inside the SampleModal when the user clicks "Find Similar".
 * Each thumbnail is clickable, navigating the modal to that sample.
 */

import { thumbnailUrl } from "@/lib/api";
import type { SimilarResult } from "@/types/similarity";

interface SimilarityPanelProps {
  /** Dataset ID for building thumbnail URLs. */
  datasetId: string;
  /** Ranked similarity results to display. */
  results: SimilarResult[];
  /** Whether the query is currently loading. */
  isLoading: boolean;
  /** Callback when a similar sample thumbnail is clicked. */
  onSelectSample: (sampleId: string) => void;
}

export function SimilarityPanel({
  datasetId,
  results,
  isLoading,
  onSelectSample,
}: SimilarityPanelProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700"
          />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No similar images found. Generate embeddings first.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {results.map((result) => (
        <button
          key={result.sample_id}
          onClick={() => onSelectSample(result.sample_id)}
          className="group relative aspect-square overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          title={result.file_name ?? result.sample_id}
        >
          <img
            src={thumbnailUrl(datasetId, result.sample_id, "small")}
            alt={result.file_name ?? result.sample_id}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
            {(result.score * 100).toFixed(0)}%
          </span>
        </button>
      ))}
    </div>
  );
}
