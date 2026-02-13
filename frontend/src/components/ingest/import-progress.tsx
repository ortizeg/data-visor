"use client";

/**
 * Step 3 of the ingestion wizard: import progress streaming.
 *
 * Constructs an ImportRequest from the Zustand store, starts the SSE
 * import stream, and displays per-split progress with a log area.
 * On completion, shows a link to the dataset and an option to import another.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useIngestStore } from "@/stores/ingest-store";
import { useIngestProgress } from "@/hooks/use-ingest-progress";
import type { ImportRequest, IngestProgress } from "@/types/scan";

export default function ImportProgress() {
  const {
    scanResult,
    selectedSplits,
    datasetName,
    step,
    setDone,
    setError: setStoreError,
    reset,
  } = useIngestStore();

  const queryClient = useQueryClient();
  const [logs, setLogs] = useState<string[]>([]);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const { progress, isImporting, error, startImport } = useIngestProgress(
    () => {
      // On complete: invalidate datasets cache, mark done
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      setDone();
    },
  );

  // Start import on mount (once)
  useEffect(() => {
    if (startedRef.current || step !== "importing" || !scanResult) return;
    startedRef.current = true;

    const selectedSplitData = scanResult.splits.filter((s) =>
      selectedSplits.has(s.name),
    );

    const request: ImportRequest = {
      dataset_name: datasetName,
      splits: selectedSplitData.map((s) => ({
        name: s.name,
        annotation_path: s.annotation_path,
        image_dir: s.image_dir,
      })),
    };

    startImport(request);
  }, [step, scanResult, selectedSplits, datasetName, startImport]);

  // Append progress messages to log
  const prevProgressRef = useRef<IngestProgress | null>(null);
  useEffect(() => {
    if (!progress || progress === prevProgressRef.current) return;
    prevProgressRef.current = progress;

    setLogs((prev) => [...prev, progress.message]);

    // Extract dataset_id from the complete message if available
    if (progress.stage === "complete" && progress.message) {
      const match = progress.message.match(/dataset_id[=: ]+([a-f0-9-]+)/i);
      if (match) {
        setDatasetId(match[1]);
      }
    }
  }, [progress]);

  // Auto-scroll log area
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Propagate error to store
  useEffect(() => {
    if (error) setStoreError(error);
  }, [error, setStoreError]);

  const totalSplits = scanResult
    ? scanResult.splits.filter((s) => selectedSplits.has(s.name)).length
    : 0;

  // Compute progress bar percentage
  let percent = 0;
  if (progress) {
    if (progress.stage === "complete") {
      percent = 100;
    } else if (progress.total && progress.total > 0) {
      percent = Math.round((progress.current / progress.total) * 100);
    }
  }

  const isDone = step === "done";

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        {isDone ? (
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900">
              <svg
                className="h-6 w-6 text-emerald-600 dark:text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Import Complete
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Successfully imported {totalSplits} split
              {totalSplits !== 1 ? "s" : ""} into{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {datasetName}
              </span>
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              {datasetId && (
                <Link
                  href={`/datasets/${datasetId}`}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  View Dataset
                </Link>
              )}
              <button
                onClick={() => {
                  startedRef.current = false;
                  reset();
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Import Another
              </button>
            </div>
          </div>
        ) : error ? (
          <div>
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => {
                  startedRef.current = false;
                  reset();
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Importing...
              </h2>
              {progress?.split && (
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  Split: {progress.split}
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>
                  {progress?.stage
                    ? progress.stage.replace(/_/g, " ")
                    : "Starting..."}
                </span>
                <span>{percent}%</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            {isImporting && (
              <div className="mt-3 flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin text-blue-600"
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
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  Processing...
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Log area */}
      {logs.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Log
            </h3>
          </div>
          <div className="max-h-64 overflow-y-auto p-4">
            <div className="space-y-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">
              {logs.map((msg, i) => (
                <div key={i}>{msg}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
