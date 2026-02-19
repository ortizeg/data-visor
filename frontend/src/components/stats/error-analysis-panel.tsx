"use client";

/**
 * Error Analysis panel with controls, summary cards, stacked bar chart,
 * and error sample grids.
 *
 * For detection: classifies predictions into True Positive, Hard False Positive,
 * Label Error, and False Negative categories using IoU matching.
 *
 * For classification: shows Correct, Misclassified, and Missing Prediction categories.
 */

import { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useErrorAnalysis } from "@/hooks/use-error-analysis";
import { ErrorSamplesGrid } from "@/components/stats/error-samples-grid";

interface ErrorAnalysisPanelProps {
  datasetId: string;
  split: string | null;
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

/** Color palette for detection error categories */
const DETECTION_COLORS = {
  tp: "#22c55e", // green-500
  hard_fp: "#ef4444", // red-500
  label_error: "#f59e0b", // amber-500
  fn: "#f97316", // orange-500
} as const;

/** Color palette for classification error categories */
const CLASSIFICATION_COLORS = {
  correct: "#22c55e", // green-500
  misclassified: "#ef4444", // red-500
  missing: "#f97316", // orange-500
} as const;

export function ErrorAnalysisPanel({ datasetId, split, datasetType }: ErrorAnalysisPanelProps) {
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

  const { data, isLoading } = useErrorAnalysis(
    datasetId,
    source,
    debouncedIou,
    debouncedConf,
    split,
  );

  // Classification layout
  if (isClassification) {
    // Map detection error fields to classification categories:
    // true_positives = correct, label_errors = misclassified, false_negatives = missing prediction
    const correctCount = data?.summary.true_positives ?? 0;
    const misclassifiedCount = data?.summary.label_errors ?? 0;
    const missingCount = data?.summary.false_negatives ?? 0;
    const total = correctCount + misclassifiedCount + missingCount;
    const pct = (count: number) =>
      total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";

    // Remap per_class data for classification bar chart
    const classChartData = data?.per_class.map((c) => ({
      class_name: c.class_name,
      correct: c.tp,
      misclassified: c.label_error,
      missing: c.fn,
    })) ?? [];

    const chartHeight = data
      ? Math.max(300, data.per_class.length * 40)
      : 300;

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

        {/* Summary Cards */}
        {isLoading || !data ? (
          <div className="grid grid-cols-3 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4">
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                {correctCount.toLocaleString()}
              </p>
              <p className="text-sm text-green-600 dark:text-green-500">
                Correct
              </p>
              <p className="text-xs text-green-500 dark:text-green-600 mt-1">
                {pct(correctCount)}%
              </p>
            </div>

            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
              <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                {misclassifiedCount.toLocaleString()}
              </p>
              <p className="text-sm text-red-600 dark:text-red-500">
                Misclassified
              </p>
              <p className="text-xs text-red-500 dark:text-red-600 mt-1">
                {pct(misclassifiedCount)}%
              </p>
            </div>

            <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 p-4">
              <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">
                {missingCount.toLocaleString()}
              </p>
              <p className="text-sm text-orange-600 dark:text-orange-500">
                Missing Prediction
              </p>
              <p className="text-xs text-orange-500 dark:text-orange-600 mt-1">
                {pct(missingCount)}%
              </p>
            </div>
          </div>
        )}

        {/* Per-class Error Distribution Stacked Bar Chart */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
            Per-Class Error Distribution
          </h2>
          {isLoading || !data ? (
            <SkeletonChart height="h-[350px]" />
          ) : classChartData.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">
              No error data available
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart
                layout="vertical"
                data={classChartData}
                margin={{ left: 20, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis
                  type="category"
                  dataKey="class_name"
                  width={140}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="correct"
                  name="Correct"
                  stackId="errors"
                  fill={CLASSIFICATION_COLORS.correct}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="misclassified"
                  name="Misclassified"
                  stackId="errors"
                  fill={CLASSIFICATION_COLORS.misclassified}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="missing"
                  name="Missing Prediction"
                  stackId="errors"
                  fill={CLASSIFICATION_COLORS.missing}
                  radius={[0, 2, 2, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Error Samples Grids */}
        {!isLoading && data && (
          <section className="space-y-6">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Error Samples
            </h2>
            <ErrorSamplesGrid
              title="Misclassified"
              errorType="label_error"
              samples={data.samples_by_type.misclassified ?? data.samples_by_type.label_error ?? []}
              datasetId={datasetId}
              color={CLASSIFICATION_COLORS.misclassified}
            />
            <ErrorSamplesGrid
              title="Missing Prediction"
              errorType="missing_prediction"
              samples={data.samples_by_type.missing_prediction ?? []}
              datasetId={datasetId}
              color={CLASSIFICATION_COLORS.missing}
            />
          </section>
        )}
      </div>
    );
  }

  // Detection layout (unchanged from original)
  const total = data
    ? data.summary.true_positives +
      data.summary.hard_false_positives +
      data.summary.label_errors +
      data.summary.false_negatives
    : 0;

  const pct = (count: number) =>
    total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";

  // Chart height based on number of classes
  const chartHeight = data
    ? Math.max(300, data.per_class.length * 40)
    : 300;

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

      {/* Summary Cards */}
      {isLoading || !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4">
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">
              {data.summary.true_positives.toLocaleString()}
            </p>
            <p className="text-sm text-green-600 dark:text-green-500">
              True Positives
            </p>
            <p className="text-xs text-green-500 dark:text-green-600 mt-1">
              {pct(data.summary.true_positives)}%
            </p>
          </div>

          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">
              {data.summary.hard_false_positives.toLocaleString()}
            </p>
            <p className="text-sm text-red-600 dark:text-red-500">
              Hard False Positives
            </p>
            <p className="text-xs text-red-500 dark:text-red-600 mt-1">
              {pct(data.summary.hard_false_positives)}%
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
              {data.summary.label_errors.toLocaleString()}
            </p>
            <p className="text-sm text-amber-600 dark:text-amber-500">
              Label Errors
            </p>
            <p className="text-xs text-amber-500 dark:text-amber-600 mt-1">
              {pct(data.summary.label_errors)}%
            </p>
          </div>

          <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 p-4">
            <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">
              {data.summary.false_negatives.toLocaleString()}
            </p>
            <p className="text-sm text-orange-600 dark:text-orange-500">
              False Negatives
            </p>
            <p className="text-xs text-orange-500 dark:text-orange-600 mt-1">
              {pct(data.summary.false_negatives)}%
            </p>
          </div>
        </div>
      )}

      {/* Per-class Error Distribution Stacked Bar Chart */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
          Per-Class Error Distribution
        </h2>
        {isLoading || !data ? (
          <SkeletonChart height="h-[350px]" />
        ) : data.per_class.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">
            No error data available
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              layout="vertical"
              data={data.per_class}
              margin={{ left: 20, right: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis
                type="category"
                dataKey="class_name"
                width={140}
                tick={{ fontSize: 12 }}
              />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="tp"
                name="True Positive"
                stackId="errors"
                fill={DETECTION_COLORS.tp}
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="hard_fp"
                name="Hard False Positive"
                stackId="errors"
                fill={DETECTION_COLORS.hard_fp}
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="label_error"
                name="Label Error"
                stackId="errors"
                fill={DETECTION_COLORS.label_error}
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="fn"
                name="False Negative"
                stackId="errors"
                fill={DETECTION_COLORS.fn}
                radius={[0, 2, 2, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Error Samples Grids */}
      {!isLoading && data && (
        <section className="space-y-6">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Error Samples
          </h2>
          <ErrorSamplesGrid
            title="Hard False Positives"
            errorType="hard_fp"
            samples={data.samples_by_type.hard_fp ?? []}
            datasetId={datasetId}
            color={DETECTION_COLORS.hard_fp}
          />
          <ErrorSamplesGrid
            title="Label Errors"
            errorType="label_error"
            samples={data.samples_by_type.label_error ?? []}
            datasetId={datasetId}
            color={DETECTION_COLORS.label_error}
          />
          <ErrorSamplesGrid
            title="False Negatives"
            errorType="false_negative"
            samples={data.samples_by_type.false_negative ?? []}
            datasetId={datasetId}
            color={DETECTION_COLORS.fn}
          />
        </section>
      )}
    </div>
  );
}
