"use client";

/**
 * Worst-images ranking panel for the statistics dashboard.
 *
 * Shows samples ranked by composite error score (60% error count +
 * 40% confidence spread). Uses the same controls-bar pattern as
 * ErrorAnalysisPanel: source dropdown, IoU slider, confidence slider.
 * Clicking a row opens the detail modal for that sample.
 */

import { useState, useEffect, useMemo } from "react";

import { thumbnailUrl } from "@/lib/api";
import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useWorstImages } from "@/hooks/use-triage";
import { useUIStore } from "@/stores/ui-store";

interface WorstImagesPanelProps {
  datasetId: string;
  split: string | null;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function WorstImagesPanel({ datasetId, split }: WorstImagesPanelProps) {
  const { data: facets } = useFilterFacets(datasetId);

  // Available prediction sources (exclude ground_truth)
  const predSources = useMemo(
    () =>
      facets?.sources
        .filter((s) => s.name !== "ground_truth")
        .map((s) => s.name) ?? [],
    [facets],
  );

  const [source, setSource] = useState("prediction");
  const [iouThreshold, setIouThreshold] = useState(0.5);
  const [confThreshold, setConfThreshold] = useState(0.25);

  // Auto-select first available source
  useEffect(() => {
    if (predSources.length > 0 && !predSources.includes(source)) {
      setSource(predSources[0]);
    }
  }, [predSources, source]);

  const debouncedIou = useDebouncedValue(iouThreshold, 300);
  const debouncedConf = useDebouncedValue(confThreshold, 300);

  const { data, isLoading } = useWorstImages(
    datasetId,
    source,
    debouncedIou,
    debouncedConf,
    split,
    true,
  );

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        {/* Source dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Source:
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {predSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* IoU slider */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            IoU:
          </label>
          <input
            type="range"
            min={0.1}
            max={1.0}
            step={0.05}
            value={iouThreshold}
            onChange={(e) => setIouThreshold(parseFloat(e.target.value))}
            className="w-28 accent-blue-500"
          />
          <span className="w-10 font-mono text-sm text-zinc-600 dark:text-zinc-400">
            {iouThreshold.toFixed(2)}
          </span>
        </div>

        {/* Confidence slider */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Conf:
          </label>
          <input
            type="range"
            min={0.0}
            max={1.0}
            step={0.05}
            value={confThreshold}
            onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
            className="w-28 accent-blue-500"
          />
          <span className="w-10 font-mono text-sm text-zinc-600 dark:text-zinc-400">
            {confThreshold.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Header */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Samples ranked by composite error score (60% error count + 40%
        confidence spread)
      </p>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-4 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="h-16 w-16 rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-3 w-40 rounded bg-zinc-200 dark:bg-zinc-700" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && items.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          No error data available
        </p>
      )}

      {/* Ranked items list */}
      {!isLoading && items.length > 0 && (
        <div className="space-y-2">
          {items.map((score, idx) => (
            <button
              key={score.sample_id}
              onClick={() =>
                useUIStore.getState().openDetailModal(score.sample_id)
              }
              className="flex w-full items-center gap-4 rounded-lg border border-zinc-200 bg-white p-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              {/* Rank */}
              <span className="w-8 text-right text-sm font-bold text-zinc-500 dark:text-zinc-400">
                #{idx + 1}
              </span>

              {/* Thumbnail */}
              <img
                src={thumbnailUrl(datasetId, score.sample_id)}
                alt={`Sample ${score.sample_id}`}
                className="h-16 w-16 rounded object-cover"
                loading="lazy"
                decoding="async"
              />

              {/* Stats */}
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="truncate text-xs font-mono text-zinc-600 dark:text-zinc-400">
                  {score.sample_id}
                </span>
                <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    Errors:{" "}
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {score.error_count}
                    </span>
                  </span>
                  <span>
                    Conf spread:{" "}
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {score.confidence_spread.toFixed(2)}
                    </span>
                  </span>
                  <span>
                    Score:{" "}
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {score.score.toFixed(2)}
                    </span>
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
