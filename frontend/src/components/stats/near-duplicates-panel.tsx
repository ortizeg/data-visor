"use client";

/**
 * Near-duplicate detection panel for the statistics dashboard.
 *
 * Allows users to:
 * 1. Set a similarity threshold via slider
 * 2. Trigger detection (runs async with SSE progress)
 * 3. Browse resulting duplicate groups
 * 4. Click a group to filter the grid to those samples
 */

import { useCallback, useState } from "react";

import {
  triggerDetection,
  useNearDuplicateProgress,
  useNearDuplicateResults,
} from "@/hooks/use-near-duplicates";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";

interface NearDuplicatesPanelProps {
  datasetId: string;
}

export function NearDuplicatesPanel({ datasetId }: NearDuplicatesPanelProps) {
  const [threshold, setThreshold] = useState(0.95);
  const [isDetecting, setIsDetecting] = useState(false);
  const [resultsReady, setResultsReady] = useState(false);

  const { progress, isRunning } = useNearDuplicateProgress(
    datasetId,
    isDetecting,
  );
  const { data: results } = useNearDuplicateResults(datasetId, resultsReady);

  // When progress reaches complete, switch from detecting to results mode
  if (isDetecting && progress.status === "complete") {
    setIsDetecting(false);
    setResultsReady(true);
  }

  const handleDetect = useCallback(async () => {
    try {
      await triggerDetection(datasetId, threshold);
      setIsDetecting(true);
      setResultsReady(false);
    } catch {
      // 409 means already running -- just enable the progress listener
      setIsDetecting(true);
    }
  }, [datasetId, threshold]);

  const handleGroupClick = useCallback((sampleIds: string[]) => {
    useFilterStore.getState().setSampleIdFilter(sampleIds);
    useUIStore.getState().setActiveTab("grid");
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Near Duplicates
        </h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Find visually similar or duplicated images using embedding similarity.
          Duplicates inflate metrics and cause data leakage across splits.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="whitespace-nowrap">
            Threshold: {threshold.toFixed(2)}
          </span>
          <input
            type="range"
            min={0.8}
            max={0.99}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-32 accent-blue-500"
            disabled={isRunning}
          />
        </label>
        <button
          onClick={handleDetect}
          disabled={isRunning}
          className="px-4 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? "Detecting..." : "Detect Duplicates"}
        </button>
      </div>

      {/* Progress bar */}
      {isDetecting && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>{progress.message}</span>
            <span>{Math.round(progress.progress * 100)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress.progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Results */}
      {resultsReady && results && (
        <div className="space-y-3">
          {results.total_groups > 0 ? (
            <>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {results.total_groups}
                </span>{" "}
                duplicate group{results.total_groups !== 1 ? "s" : ""} found (
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {results.total_duplicates}
                </span>{" "}
                images)
              </p>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {results.groups.map((group, i) => (
                  <button
                    key={i}
                    onClick={() => handleGroupClick(group.sample_ids)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Group {i + 1}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {group.size} images
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500 truncate">
                      {group.sample_ids.slice(0, 3).join(", ")}
                      {group.sample_ids.length > 3 && "..."}
                    </p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No near-duplicates found at threshold {results.threshold.toFixed(2)}.
              Try lowering the threshold.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
