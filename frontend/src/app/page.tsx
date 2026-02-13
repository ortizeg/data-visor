"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, apiDelete } from "@/lib/api";
import type { DatasetList } from "@/types/dataset";

export default function Home() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => apiFetch<DatasetList>("/datasets"),
  });

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault(); // prevent Link navigation
    e.stopPropagation();
    if (!window.confirm(`Delete dataset "${name}"? This cannot be undone.`)) return;
    try {
      await apiDelete(`/datasets/${id}`);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete dataset");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            DataVisor
          </h1>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">
            Select a dataset to browse
          </p>
        </div>
        <Link
          href="/ingest"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Import Dataset
        </Link>
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
            No datasets found.{" "}
            <Link
              href="/ingest"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Import a dataset
            </Link>{" "}
            to get started.
          </p>
        )}

        {data && data.datasets.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.datasets.map((dataset) => (
              <Link
                key={dataset.id}
                href={`/datasets/${dataset.id}`}
                className="group relative rounded-lg border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <button
                  onClick={(e) => handleDelete(e, dataset.id, dataset.name)}
                  className="absolute right-3 top-3 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950 dark:hover:text-red-400"
                  title="Delete dataset"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                  </svg>
                </button>
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
