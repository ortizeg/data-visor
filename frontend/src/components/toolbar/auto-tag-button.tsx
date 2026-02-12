"use client";

/**
 * Auto-tag button that triggers VLM auto-tagging for a dataset.
 *
 * Workflow:
 * 1. User clicks "Auto-Tag" button
 * 2. POST /datasets/{id}/auto-tag triggers background Moondream2 tagging
 * 3. SSE progress stream shows processed/total count
 * 4. On completion, samples query cache is invalidated to show new tags
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiPost } from "@/lib/api";
import { useVLMProgress } from "@/hooks/use-vlm-progress";

interface AutoTagButtonProps {
  datasetId: string;
}

export function AutoTagButton({ datasetId }: AutoTagButtonProps) {
  const queryClient = useQueryClient();
  const [isTagging, setIsTagging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = useVLMProgress(datasetId, isTagging);

  const handleAutoTag = async () => {
    setError(null);
    try {
      await apiPost(`/datasets/${datasetId}/auto-tag`, {});
      setIsTagging(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start auto-tagging");
    }
  };

  // Stop monitoring and invalidate caches when tagging reaches terminal status
  useEffect(() => {
    if (!isTagging) return;

    if (progress.status === "complete") {
      setIsTagging(false);
      // Invalidate samples query to show new tags
      queryClient.invalidateQueries({ queryKey: ["samples", datasetId] });
      // Invalidate filter facets to show new tag options
      queryClient.invalidateQueries({ queryKey: ["filter-facets", datasetId] });
    }

    if (progress.status === "error") {
      setIsTagging(false);
      setError(progress.message || "Auto-tagging failed");
    }
  }, [isTagging, progress.status, progress.message, datasetId, queryClient]);

  // --- Tagging in progress: show progress indicator ---
  if (isTagging) {
    const total = progress.total ?? 0;
    const processed = progress.processed ?? 0;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 animate-spin rounded-full border border-amber-400 border-t-transparent" />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Tagging {processed}/{total}
          </span>
        </div>
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <div
            className="h-full rounded-full bg-amber-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleAutoTag}
        className="rounded px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-amber-50 hover:text-amber-700 dark:text-zinc-400 dark:hover:bg-amber-900/30 dark:hover:text-amber-300"
      >
        Auto-Tag
      </button>
      {error && (
        <span className="text-xs text-red-500 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
