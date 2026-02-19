"use client";

/**
 * Step 2 of the ingestion wizard: scan results confirmation.
 *
 * Displays detected splits with checkboxes, an editable dataset name,
 * format badge, warnings, and action buttons to go back or start import.
 */

import { useIngestStore } from "@/stores/ingest-store";

/** Format bytes into a human-readable string (KB/MB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Color map for common split names. */
function splitColor(name: string): string {
  switch (name.toLowerCase()) {
    case "train":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
    case "val":
    case "valid":
    case "validation":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
    case "test":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

export default function ScanResults() {
  const {
    scanResult,
    selectedSplits,
    datasetName,
    toggleSplit,
    setDatasetName,
    startImport,
    reset,
  } = useIngestStore();

  if (!scanResult) return null;

  const hasSelection = selectedSplits.size > 0;

  return (
    <div className="space-y-4">
      {/* Dataset info card */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <label
              htmlFor="dataset-name"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Dataset Name
            </label>
            <input
              id="dataset-name"
              type="text"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            />
          </div>
          <span className="ml-4 mt-6 inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            {scanResult.format === "classification_jsonl"
              ? "Classification JSONL"
              : scanResult.format.toUpperCase()}
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          {scanResult.root_path}
        </p>
      </div>

      {/* Warnings */}
      {scanResult.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
          <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Warnings
          </h3>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-700 dark:text-amber-300">
            {scanResult.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Splits list */}
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Detected Splits ({scanResult.splits.length})
          </h3>
        </div>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {scanResult.splits.map((split) => {
            const selected = selectedSplits.has(split.name);
            return (
              <li
                key={split.name}
                className="flex items-center gap-4 px-6 py-4"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleSplit(split.name)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${splitColor(split.name)}`}
                    >
                      {split.name}
                    </span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {split.image_count.toLocaleString()} images
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {formatBytes(split.annotation_file_size)} annotations
                    </span>
                  </div>
                  <p
                    className="mt-0.5 truncate text-xs text-zinc-400 dark:text-zinc-500"
                    title={split.image_dir}
                  >
                    {split.image_dir}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={reset}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Back
        </button>
        <button
          onClick={startImport}
          disabled={!hasSelection || !datasetName.trim()}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Import {selectedSplits.size > 0 ? `${selectedSplits.size} Split${selectedSplits.size > 1 ? "s" : ""}` : "Selected"}
        </button>
      </div>
    </div>
  );
}
