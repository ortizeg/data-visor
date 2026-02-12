"use client";

/**
 * Statistics dashboard layout with sub-tabs for Overview, Evaluation,
 * Error Analysis, and Intelligence.
 *
 * Fetches dataset statistics and renders the selected sub-tab:
 * - Overview: annotation summary, class distribution, split breakdown
 * - Evaluation: PR curves, mAP, confusion matrix (only when predictions exist)
 * - Error Analysis: error categorization, per-class breakdown, error samples
 * - Intelligence: AI-powered error pattern analysis and recommendations
 */

import { useState } from "react";

import { useStatistics } from "@/hooks/use-statistics";
import { AnnotationSummary } from "@/components/stats/annotation-summary";
import { ClassDistribution } from "@/components/stats/class-distribution";
import { SplitBreakdown } from "@/components/stats/split-breakdown";
import { EvaluationPanel } from "@/components/stats/evaluation-panel";
import { ErrorAnalysisPanel } from "@/components/stats/error-analysis-panel";
import { IntelligencePanel } from "@/components/stats/intelligence-panel";

interface StatsDashboardProps {
  datasetId: string;
}

type SubTab = "overview" | "evaluation" | "error_analysis" | "intelligence";

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

export function StatsDashboard({ datasetId }: StatsDashboardProps) {
  const { data: stats, isLoading, error } = useStatistics(datasetId);
  const [activeTab, setActiveTab] = useState<SubTab>("overview");

  const hasPredictions = stats && stats.summary.pred_annotations > 0;

  if (error) {
    return (
      <div className="p-6 text-center text-red-500">
        Failed to load statistics: {error.message}
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      {/* Sub-tab navigation */}
      {(hasPredictions || isLoading) && (
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "overview"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab("evaluation")}
            disabled={!hasPredictions}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "evaluation"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Evaluation
          </button>
          <button
            onClick={() => setActiveTab("error_analysis")}
            disabled={!hasPredictions}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "error_analysis"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Error Analysis
          </button>
          <button
            onClick={() => setActiveTab("intelligence")}
            disabled={!hasPredictions}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "intelligence"
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Intelligence
          </button>
        </div>
      )}

      {activeTab === "overview" && (
        <>
          {/* Summary Stats */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
              Summary
            </h2>
            {isLoading || !stats ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : (
              <AnnotationSummary summary={stats.summary} />
            )}
          </section>

          {/* Class Distribution */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
              Class Distribution
            </h2>
            {isLoading || !stats ? (
              <SkeletonChart height="h-[300px]" />
            ) : (
              <ClassDistribution data={stats.class_distribution} />
            )}
          </section>

          {/* Split Breakdown */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
              Split Breakdown
            </h2>
            {isLoading || !stats ? (
              <SkeletonChart height="h-[250px]" />
            ) : (
              <SplitBreakdown data={stats.split_breakdown} />
            )}
          </section>
        </>
      )}

      {activeTab === "evaluation" && hasPredictions && (
        <EvaluationPanel datasetId={datasetId} />
      )}

      {activeTab === "error_analysis" && hasPredictions && (
        <ErrorAnalysisPanel datasetId={datasetId} />
      )}

      {activeTab === "intelligence" && hasPredictions && (
        <IntelligencePanel datasetId={datasetId} />
      )}
    </div>
  );
}
