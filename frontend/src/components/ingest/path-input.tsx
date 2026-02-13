"use client";

/**
 * Step 1 of the ingestion wizard: folder path input and scan trigger.
 *
 * Renders a text input for the folder path with a "Scan" button.
 * On success, stores the scan result and advances the wizard.
 */

import { useState } from "react";

import { useScanFolder } from "@/hooks/use-scan";
import { useIngestStore } from "@/stores/ingest-store";

export default function PathInput() {
  const [path, setPath] = useState("");
  const setScanResult = useIngestStore((s) => s.setScanResult);
  const scan = useScanFolder();

  const handleScan = () => {
    const trimmed = path.trim();
    if (!trimmed) return;

    scan.mutate(trimmed, {
      onSuccess: (result) => {
        setScanResult(result);
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleScan();
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Dataset Folder
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Enter the path to a folder containing a COCO-format dataset. DataVisor
        will scan for annotation files and image directories.
      </p>

      <div className="mt-4 flex gap-3">
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g., /data/datasets/coco2017"
          disabled={scan.isPending}
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
        />
        <button
          onClick={handleScan}
          disabled={scan.isPending || !path.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scan.isPending && (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
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
          )}
          {scan.isPending ? "Scanning..." : "Scan"}
        </button>
      </div>

      {scan.isError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">
            {scan.error instanceof Error
              ? scan.error.message
              : "Scan failed. Please check the path and try again."}
          </p>
        </div>
      )}
    </div>
  );
}
