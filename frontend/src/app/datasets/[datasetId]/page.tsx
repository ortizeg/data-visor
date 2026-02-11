"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { ImageGrid } from "@/components/grid/image-grid";
import type { Dataset } from "@/types/dataset";

export default function DatasetPage({
  params,
}: {
  params: Promise<{ datasetId: string }>;
}) {
  const { datasetId } = use(params);

  const { data: dataset } = useQuery({
    queryKey: ["dataset", datasetId],
    queryFn: () => apiFetch<Dataset>(`/datasets/${datasetId}`),
  });

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
          </div>
        )}
      </header>

      <ImageGrid datasetId={datasetId} />
    </div>
  );
}
