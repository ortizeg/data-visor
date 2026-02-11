"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { DatasetList } from "@/types/dataset";

export default function Home() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<DatasetList>("/datasets"),
  });

  return (
    <div className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          VisionLens
        </h1>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          Select a dataset to browse
        </p>
      </header>

      <main className="mx-auto max-w-4xl">
        {isLoading && (
          <p className="text-zinc-500 dark:text-zinc-400">
            Loading datasets...
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
            <p className="text-red-700 dark:text-red-300">
              Failed to load datasets. Is the backend running at localhost:8000?
            </p>
          </div>
        )}

        {data && data.datasets.length === 0 && (
          <p className="text-zinc-500 dark:text-zinc-400">
            No datasets found. Ingest a dataset via the API first.
          </p>
        )}

        {data && data.datasets.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.datasets.map((dataset) => (
              <Link
                key={dataset.id}
                href={`/datasets/${dataset.id}`}
                className="group rounded-lg border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h2 className="text-lg font-semibold text-zinc-900 group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400">
                  {dataset.name}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {dataset.format.toUpperCase()}
                </p>
                <div className="mt-3 flex gap-4 text-sm text-zinc-600 dark:text-zinc-300">
                  <span>
                    <strong>{dataset.image_count.toLocaleString()}</strong>{" "}
                    images
                  </span>
                  <span>
                    <strong>{dataset.annotation_count.toLocaleString()}</strong>{" "}
                    annotations
                  </span>
                  <span>
                    <strong>{dataset.category_count}</strong> classes
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
