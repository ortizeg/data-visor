"use client";

/**
 * Intelligence panel for AI-powered error analysis.
 *
 * Allows users to trigger on-demand analysis via Pydantic AI agent,
 * then displays structured results: summary, detected patterns with
 * severity badges, and prioritized recommendations with category badges.
 */

import { useState, useEffect, useMemo, useCallback } from "react";

import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useAgentAnalysis } from "@/hooks/use-agent-analysis";
import { useUIStore } from "@/stores/ui-store";
import { useDeletePredictions } from "@/hooks/use-delete-predictions";
import type { AnalysisReport } from "@/types/agent";
import type { PatternInsight, Recommendation } from "@/types/agent";

/** Module-level cache so results survive tab switches (component unmount). */
const resultCache = new Map<string, AnalysisReport>();

interface IntelligencePanelProps {
  datasetId: string;
}

/* ---------- Severity / priority badge colors ---------- */

const SEVERITY_STYLES: Record<
  PatternInsight["severity"],
  { bg: string; text: string }
> = {
  high: {
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-700 dark:text-red-300",
  },
  medium: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
  },
  low: {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-700 dark:text-blue-300",
  },
};

const PRIORITY_STYLES: Record<
  Recommendation["priority"],
  { bg: string; text: string }
> = {
  high: {
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-700 dark:text-red-300",
  },
  medium: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
  },
  low: {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-700 dark:text-blue-300",
  },
};

const CATEGORY_LABELS: Record<Recommendation["category"], string> = {
  data_collection: "Data Collection",
  augmentation: "Augmentation",
  labeling: "Labeling",
  architecture: "Architecture",
  hyperparameter: "Hyperparameter",
};

/* ---------- Helper: debounce ---------- */

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ---------- Sub-components ---------- */

function PatternCard({ insight }: { insight: PatternInsight }) {
  const sev = SEVERITY_STYLES[insight.severity];
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {insight.pattern}
        </p>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${sev.bg} ${sev.text}`}
        >
          {insight.severity}
        </span>
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        {insight.evidence}
      </p>
      {insight.affected_classes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {insight.affected_classes.map((cls) => (
            <span
              key={cls}
              className="px-1.5 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
            >
              {cls}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const pri = PRIORITY_STYLES[rec.priority];
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {rec.action}
        </p>
        <div className="flex shrink-0 gap-1.5">
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${pri.bg} ${pri.text}`}
          >
            {rec.priority}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
            {CATEGORY_LABELS[rec.category]}
          </span>
        </div>
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        {rec.rationale}
      </p>
    </div>
  );
}

/* ---------- Spinner ---------- */

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-purple-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/* ---------- Main component ---------- */

export function IntelligencePanel({ datasetId }: IntelligencePanelProps) {
  const { data: facets } = useFilterFacets(datasetId);
  const mutation = useAgentAnalysis();

  // Restore cached result on mount
  const [cachedResult, setCachedResult] = useState<AnalysisReport | null>(
    () => resultCache.get(datasetId) ?? null,
  );

  // Cache new results when mutation succeeds
  useEffect(() => {
    if (mutation.data) {
      resultCache.set(datasetId, mutation.data);
      setCachedResult(mutation.data);
    }
  }, [mutation.data, datasetId]);

  // The report to display: fresh mutation data or cached
  const report = mutation.data ?? cachedResult;

  // Available prediction sources (exclude ground_truth)
  const predSources = useMemo(
    () =>
      facets?.sources
        .filter((s) => s.name !== "ground_truth")
        .map((s) => s.name) ?? [],
    [facets],
  );

  const source = useUIStore((s) => s.statsSource);
  const setSource = useUIStore((s) => s.setStatsSource);
  const deleteMutation = useDeletePredictions(datasetId);
  const [iouThreshold, setIouThreshold] = useState(0.5);
  const [confThreshold, setConfThreshold] = useState(0.25);

  // Auto-select first available source
  useEffect(() => {
    if (predSources.length > 0 && (!source || !predSources.includes(source))) {
      setSource(predSources[0]);
    }
  }, [predSources, source, setSource]);

  const effectiveSource = source ?? "prediction";

  const handleDeleteSource = useCallback(() => {
    if (!source || source === "ground_truth") return;
    if (!window.confirm(`Delete all predictions for "${source}"?`)) return;
    deleteMutation.mutate(source, {
      onSuccess: () => {
        const remaining = predSources.filter((s) => s !== source);
        setSource(remaining.length > 0 ? remaining[0] : null);
      },
    });
  }, [source, predSources, deleteMutation, setSource]);

  const debouncedIou = useDebouncedValue(iouThreshold, 300);
  const debouncedConf = useDebouncedValue(confThreshold, 300);

  const handleAnalyze = () => {
    mutation.mutate({
      datasetId,
      source: effectiveSource,
      iouThreshold: debouncedIou,
      confThreshold: debouncedConf,
    });
  };

  const is503 =
    mutation.error?.message?.includes("503") ?? false;

  return (
    <div className="space-y-6">
      {/* Header + Controls */}
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        {/* Source dropdown + delete */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Source:
          </label>
          <select
            value={effectiveSource}
            onChange={(e) => setSource(e.target.value)}
            className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm px-2 py-1 text-zinc-900 dark:text-zinc-100"
          >
            {predSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={handleDeleteSource}
            disabled={deleteMutation.isPending || !source}
            title="Delete this prediction run"
            className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
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
            className="w-28 accent-purple-500"
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
            className="w-28 accent-purple-500"
          />
          <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400 w-10">
            {confThreshold.toFixed(2)}
          </span>
        </div>

        {/* Analyze button */}
        <button
          onClick={handleAnalyze}
          disabled={mutation.isPending || predSources.length === 0}
          className="ml-auto flex items-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          {mutation.isPending ? (
            <>
              <Spinner />
              Analyzing...
            </>
          ) : (
            "Analyze"
          )}
        </button>
      </div>

      {/* Loading state */}
      {mutation.isPending && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Spinner />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Running AI analysis... This may take 10-30 seconds.
          </p>
        </div>
      )}

      {/* Error state */}
      {mutation.isError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-6">
          {is503 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                AI Agent Not Configured
              </p>
              <p className="text-xs text-red-600 dark:text-red-400">
                The AI analysis agent requires an LLM API key. Set{" "}
                <code className="px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/60 font-mono">
                  GEMINI_API_KEY
                </code>{" "}
                in your{" "}
                <code className="px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/60 font-mono">
                  .env
                </code>{" "}
                file. Override the model with{" "}
                <code className="px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/60 font-mono">
                  DATAVISOR_AGENT_MODEL
                </code>{" "}
                (defaults to google-gla:gemini-2.0-flash).
              </p>
            </div>
          ) : (
            <p className="text-sm text-red-700 dark:text-red-300">
              Analysis failed: {mutation.error.message}
            </p>
          )}
        </div>
      )}

      {/* Results (from fresh mutation or cache) */}
      {report && !mutation.isPending && (
        <>
          {/* Summary card */}
          <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 p-4">
            <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-1">
              Summary
            </h3>
            <p className="text-sm text-purple-600 dark:text-purple-400">
              {report.summary}
            </p>
          </div>

          {/* Patterns section */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
              Detected Patterns ({report.patterns.length})
            </h2>
            {report.patterns.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4 text-center">
                No error patterns detected.
              </p>
            ) : (
              <div className="space-y-3">
                {report.patterns.map((p, i) => (
                  <PatternCard key={i} insight={p} />
                ))}
              </div>
            )}
          </section>

          {/* Recommendations section */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
              Recommendations ({report.recommendations.length})
            </h2>
            {report.recommendations.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4 text-center">
                No recommendations generated.
              </p>
            ) : (
              <div className="space-y-3">
                {report.recommendations.map((r, i) => (
                  <RecommendationCard key={i} rec={r} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Empty state before first run (only if no cached result) */}
      {mutation.isIdle && !report && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-purple-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            AI Error Analysis
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm">
            Click &quot;Analyze&quot; to run AI-powered pattern detection on your
            prediction errors. The agent will identify error patterns and suggest
            corrective actions.
          </p>
        </div>
      )}
    </div>
  );
}
