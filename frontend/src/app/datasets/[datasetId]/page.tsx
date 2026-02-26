"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { useSamples } from "@/hooks/use-samples";
import { ImageGrid } from "@/components/grid/image-grid";
import { SampleModal } from "@/components/detail/sample-modal";
import { FilterSidebar } from "@/components/filters/filter-sidebar";
import { StatsDashboard } from "@/components/stats/stats-dashboard";
import { EmbeddingPanel } from "@/components/embedding/embedding-panel";
import { AutoTagButton } from "@/components/toolbar/auto-tag-button";
import { ShortcutHelpOverlay } from "@/components/toolbar/shortcut-help-overlay";
import { PredictionImportDialog } from "@/components/detail/prediction-import-dialog";
import { DiscoveryFilterChip } from "@/components/grid/discovery-filter-chip";
import { useUIStore, type DatasetTab } from "@/stores/ui-store";
import type { Dataset } from "@/types/dataset";

const TAB_OPTIONS: { value: DatasetTab; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "statistics", label: "Statistics" },
  { value: "embeddings", label: "Embeddings" },
];

export default function DatasetPage({
  params,
}: {
  params: Promise<{ datasetId: string }>;
}) {
  const { datasetId } = use(params);

  const [showPredImport, setShowPredImport] = useState(false);
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const { data: dataset } = useQuery({
    queryKey: ["dataset", datasetId],
    queryFn: () => apiFetch<Dataset>(`/datasets/${datasetId}`),
  });

  // Access the same samples query cache that ImageGrid uses
  const { data: samplesData } = useSamples(datasetId);
  const allSamples = useMemo(
    () => samplesData?.pages.flatMap((p) => p.items) ?? [],
    [samplesData],
  );

  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          &larr; Datasets
        </Link>
        {dataset && (
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {dataset.name}
            </h1>
            <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {dataset.format.toUpperCase()}
            </span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {dataset.image_count.toLocaleString()} images
            </span>

            {/* Tab switcher: Grid / Statistics / Embeddings */}
            <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden dark:border-zinc-700">
              {TAB_OPTIONS.map((opt) => {
                const isActive = activeTab === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setActiveTab(opt.value)}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <DiscoveryFilterChip />
            <AutoTagButton datasetId={datasetId} />

            <button
              onClick={() => setShowPredImport(true)}
              className="rounded px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-zinc-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
            >
              Import Predictions
            </button>
          </div>
        )}
      </header>

      {activeTab === "grid" && (
        <div className="flex flex-1 overflow-hidden">
          <FilterSidebar datasetId={datasetId} />
          <div className="flex-1 overflow-hidden">
            <ImageGrid datasetId={datasetId} datasetType={dataset?.dataset_type} />
          </div>
        </div>
      )}
      {activeTab === "statistics" && (
        <StatsDashboard datasetId={datasetId} datasetType={dataset?.dataset_type} />
      )}
      {activeTab === "embeddings" && (
        <EmbeddingPanel datasetId={datasetId} datasetType={dataset?.dataset_type} />
      )}
      <SampleModal datasetId={datasetId} samples={allSamples} datasetType={dataset?.dataset_type} />
      <PredictionImportDialog
        datasetId={datasetId}
        open={showPredImport}
        onClose={() => setShowPredImport(false)}
      />
      <ShortcutHelpOverlay />
    </div>
  );
}
