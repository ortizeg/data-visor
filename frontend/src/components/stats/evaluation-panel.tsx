"use client";

/**
 * Main evaluation panel with controls, metric cards, charts, and tables.
 *
 * Contains source dropdown, IoU/confidence sliders (debounced 300ms),
 * and renders MetricsCards, PRCurveChart, ConfusionMatrix, PerClassTable.
 *
 * Branches between detection and classification layouts based on datasetType.
 */

import { useState, useEffect, useMemo, useCallback } from "react";

import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useEvaluation } from "@/hooks/use-evaluation";
import { useFilteredEvaluation } from "@/hooks/use-filtered-evaluation";
import { fetchConfusionCellSamples } from "@/hooks/use-confusion-cell";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { MetricsCards } from "@/components/stats/metrics-cards";
import { PRCurveChart } from "@/components/stats/pr-curve-chart";
import { ConfusionMatrix } from "@/components/stats/confusion-matrix";
import { PerClassTable } from "@/components/stats/per-class-table";
import type { EvaluationResponse, ClassificationEvaluationResponse } from "@/types/evaluation";

interface EvaluationPanelProps {
  datasetId: string;
  split: string | null;
  excludedClasses: Set<string>;
  datasetType?: string;
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

/** Metric cards for classification: Accuracy, Macro F1, Weighted F1 */
function ClassificationMetricsCards({ data }: { data: ClassificationEvaluationResponse }) {
  const cards = [
    { label: "Accuracy", value: data.accuracy },
    { label: "Macro F1", value: data.macro_f1 },
    { label: "Weighted F1", value: data.weighted_f1 },
  ];
  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 bg-white dark:bg-zinc-900"
        >
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {(card.value * 100).toFixed(1)}%
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {card.label}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Color-coded F1 bar: green >= 0.8, yellow >= 0.5, red < 0.5 */
function F1Bar({ f1 }: { f1: number }) {
  const color = f1 >= 0.8 ? "bg-green-500" : f1 >= 0.5 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="w-16 h-2.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${f1 * 100}%` }} />
    </div>
  );
}

/** Top 10 most-confused (actual, predicted) pairs from confusion matrix */
function MostConfusedPairs({
  matrix,
  labels,
  onPairClick,
}: {
  matrix: number[][];
  labels: string[];
  onPairClick?: (actual: string, predicted: string) => void;
}) {
  const pairs = useMemo(() => {
    const result: { actual: string; predicted: string; count: number; pct: number }[] = [];
    for (let i = 0; i < matrix.length; i++) {
      const rowSum = matrix[i].reduce((a, b) => a + b, 0);
      for (let j = 0; j < matrix[i].length; j++) {
        if (i !== j && matrix[i][j] > 0) {
          result.push({
            actual: labels[i],
            predicted: labels[j],
            count: matrix[i][j],
            pct: rowSum > 0 ? matrix[i][j] / rowSum : 0,
          });
        }
      }
    }
    result.sort((a, b) => b.count - a.count);
    return result.slice(0, 10);
  }, [matrix, labels]);

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
        Most Confused Pairs
      </h3>
      {pairs.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
          No misclassifications found
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-700">
                <th className="text-left py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400 w-8">
                  #
                </th>
                <th className="text-left py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                  Actual
                </th>
                <th className="text-center py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400 w-8" />
                <th className="text-left py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                  Predicted
                </th>
                <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                  Count
                </th>
                <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                  Pct
                </th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, idx) => (
                <tr
                  key={`${p.actual}-${p.predicted}`}
                  className={`border-b border-zinc-100 dark:border-zinc-800${
                    onPairClick ? " cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800" : ""
                  }`}
                  onClick={onPairClick ? () => onPairClick(p.actual, p.predicted) : undefined}
                >
                  <td className="py-2 px-3 text-zinc-400 dark:text-zinc-500">
                    {idx + 1}
                  </td>
                  <td className="py-2 px-3 text-zinc-900 dark:text-zinc-100 font-medium">
                    {p.actual}
                  </td>
                  <td className="py-2 px-3 text-center text-zinc-400 dark:text-zinc-500">
                    {"\u2192"}
                  </td>
                  <td className="py-2 px-3 text-zinc-900 dark:text-zinc-100 font-medium">
                    {p.predicted}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                    {p.count.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                    {(p.pct * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Per-class table for classification: Class, Precision, Recall, F1, Support, Performance */
function ClassificationPerClassTable({ metrics }: { metrics: ClassificationEvaluationResponse["per_class_metrics"] }) {
  const sorted = useMemo(
    () => [...metrics].sort((a, b) => b.f1 - a.f1),
    [metrics],
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
          No per-class metrics available
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
        Per-Class Metrics
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="text-left py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                Class
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                Precision
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                Recall
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                F1
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                Support
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                Performance
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr
                key={m.class_name}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="py-2 px-3 text-zinc-900 dark:text-zinc-100 font-medium">
                  {m.class_name}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.precision.toFixed(3)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.recall.toFixed(3)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.f1.toFixed(3)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.support.toLocaleString()}
                </td>
                <td className="py-2 px-3 text-right">
                  <div className="flex justify-end">
                    <F1Bar f1={m.f1} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EvaluationPanel({ datasetId, split, excludedClasses, datasetType }: EvaluationPanelProps) {
  const isClassification = datasetType === "classification";
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

  const { data: rawData, isLoading } = useEvaluation(
    datasetId,
    source,
    debouncedIou,
    debouncedConf,
    split,
  );
  const data = useFilteredEvaluation(rawData, excludedClasses);

  const handleCellClick = useCallback(
    async (actualClass: string, predictedClass: string) => {
      try {
        const sampleIds = await fetchConfusionCellSamples(
          datasetId,
          actualClass,
          predictedClass,
          source,
          debouncedIou,
          debouncedConf,
          split,
        );
        useFilterStore.getState().setSampleIdFilter(sampleIds);
        useUIStore.getState().setActiveTab("grid");
      } catch (err) {
        console.error("Failed to fetch confusion cell samples:", err);
      }
    },
    [datasetId, source, debouncedIou, debouncedConf, split],
  );

  // Classification evaluation layout
  if (isClassification) {
    const classData = data as ClassificationEvaluationResponse | undefined;
    return (
      <div className="space-y-6">
        {/* Controls Bar -- no IoU slider for classification */}
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

        {/* Classification Metric Cards */}
        {isLoading || !classData ? (
          <div className="grid grid-cols-3 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <ClassificationMetricsCards data={classData} />
        )}

        {/* Confusion Matrix */}
        {isLoading || !classData ? (
          <SkeletonChart height="h-[350px]" />
        ) : (
          <ConfusionMatrix
            matrix={classData.confusion_matrix}
            labels={classData.confusion_matrix_labels}
            onCellClick={handleCellClick}
          />
        )}

        {/* Most Confused Pairs */}
        {isLoading || !classData ? (
          <SkeletonChart height="h-[200px]" />
        ) : (
          <MostConfusedPairs
            matrix={classData.confusion_matrix}
            labels={classData.confusion_matrix_labels}
            onPairClick={handleCellClick}
          />
        )}

        {/* Per-Class Table */}
        {isLoading || !classData ? (
          <SkeletonChart height="h-[200px]" />
        ) : (
          <ClassificationPerClassTable metrics={classData.per_class_metrics} />
        )}
      </div>
    );
  }

  // Detection evaluation layout (unchanged)
  const detData = data as EvaluationResponse | undefined;

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
      {isLoading || !detData ? (
        <div className="grid grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <MetricsCards metrics={detData.ap_metrics} />
      )}

      {/* Charts: PR Curve + Confusion Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isLoading || !detData ? (
          <>
            <SkeletonChart height="h-[350px]" />
            <SkeletonChart height="h-[350px]" />
          </>
        ) : (
          <>
            <PRCurveChart
              curves={detData.pr_curves}
              confThreshold={confThreshold}
            />
            <ConfusionMatrix
              matrix={detData.confusion_matrix}
              labels={detData.confusion_matrix_labels}
              onCellClick={handleCellClick}
            />
          </>
        )}
      </div>

      {/* Per-Class Table */}
      {isLoading || !detData ? (
        <SkeletonChart height="h-[200px]" />
      ) : (
        <PerClassTable metrics={detData.per_class_metrics} />
      )}
    </div>
  );
}
