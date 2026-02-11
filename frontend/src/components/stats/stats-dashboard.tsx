"use client";

/**
 * Statistics dashboard layout with charts and summary cards.
 *
 * Fetches dataset statistics and renders annotation summary,
 * class distribution, and split breakdown sections.
 */

import { useStatistics } from "@/hooks/use-statistics";
import { AnnotationSummary } from "@/components/stats/annotation-summary";
import { ClassDistribution } from "@/components/stats/class-distribution";
import { SplitBreakdown } from "@/components/stats/split-breakdown";

interface StatsDashboardProps {
  datasetId: string;
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

export function StatsDashboard({ datasetId }: StatsDashboardProps) {
  const { data: stats, isLoading, error } = useStatistics(datasetId);

  if (error) {
    return (
      <div className="p-6 text-center text-red-500">
        Failed to load statistics: {error.message}
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
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
    </div>
  );
}
