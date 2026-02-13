"use client";

/**
 * Main evaluation panel with controls, metric cards, charts, and tables.
 *
 * Contains source dropdown, IoU/confidence sliders (debounced 300ms),
 * and renders MetricsCards, PRCurveChart, ConfusionMatrix, PerClassTable.
 */

import { useState, useEffect, useMemo } from "react";

import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useEvaluation } from "@/hooks/use-evaluation";
import { MetricsCards } from "@/components/stats/metrics-cards";
import { PRCurveChart } from "@/components/stats/pr-curve-chart";
import { ConfusionMatrix } from "@/components/stats/confusion-matrix";
import { PerClassTable } from "@/components/stats/per-class-table";

interface EvaluationPanelProps {
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

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 bg-white dark:bg-zinc-900 animate-pulse">
      <div className="h-8 w-20 bg-zinc-200 dark:bg-zinc-700 rounded mb-2" />
      <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-700 rounded" />
    </div>
  );
}

function SkeletonChart({ height }: { height: string }) {
  return (
    <div
      className={`${height} bg-zinc-100 dark:bg-zinc-800 rounded-lg animate-pulse`}
    />
  );
}

export function EvaluationPanel({ datasetId, split }: EvaluationPanelProps) {
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

  const { data, isLoading } = useEvaluation(
    datasetId,
    source,
    debouncedIou,
    debouncedConf,
    split,
  );

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        {/* Source dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Source:
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-2 py-1 text-zinc-900 dark:text-zinc-100"
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
          <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400 w-10">
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
          <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400 w-10">
            {confThreshold.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Metric Cards */}
      {isLoading || !data ? (
        <div className="grid grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <MetricsCards metrics={data.ap_metrics} />
      )}

      {/* Charts: PR Curve + Confusion Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isLoading || !data ? (
          <>
            <SkeletonChart height="h-[350px]" />
            <SkeletonChart height="h-[350px]" />
          </>
        ) : (
          <>
            <PRCurveChart
              curves={data.pr_curves}
              confThreshold={confThreshold}
            />
            <ConfusionMatrix
              matrix={data.confusion_matrix}
              labels={data.confusion_matrix_labels}
            />
          </>
        )}
      </div>

      {/* Per-Class Table */}
      {isLoading || !data ? (
        <SkeletonChart height="h-[200px]" />
      ) : (
        <PerClassTable metrics={data.per_class_metrics} />
      )}
    </div>
  );
}
