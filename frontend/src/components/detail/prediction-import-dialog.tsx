"use client";

import { useState } from "react";

import FolderBrowser from "@/components/ingest/folder-browser";
import { useImportPredictions } from "@/hooks/use-import-predictions";
import type { PredictionImportRequest } from "@/types/prediction";

type Format = PredictionImportRequest["format"];

interface PredictionImportDialogProps {
  datasetId: string;
  open: boolean;
  onClose: () => void;
}

const FORMAT_OPTIONS: { value: Format; label: string }[] = [
  { value: "detection_annotation", label: "Detection Annotation" },
  { value: "coco", label: "COCO Results" },
];

export function PredictionImportDialog({
  datasetId,
  open,
  onClose,
}: PredictionImportDialogProps) {
  const [path, setPath] = useState("");
  const [format, setFormat] = useState<Format>("detection_annotation");
  const [runName, setRunName] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);

  const mutation = useImportPredictions(datasetId);

  if (!open) return null;

  const handleImport = () => {
    mutation.mutate({
      prediction_path: path,
      format,
      ...(runName.trim() ? { run_name: runName.trim() } : {}),
    });
  };

  const handleClose = () => {
    mutation.reset();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Import Predictions
          </h3>
          <button
            onClick={handleClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-4 py-4">
          {/* Path input */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Prediction Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/predictions"
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <button
                onClick={() => setShowBrowser(true)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Browse
              </button>
            </div>
          </div>

          {/* Format selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Format
            </label>
            <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              {FORMAT_OPTIONS.map((opt) => {
                const isActive = format === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormat(opt.value)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
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
          </div>

          {/* Run name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Run Name
              <span className="ml-1 font-normal text-zinc-400 dark:text-zinc-500">
                (optional)
              </span>
            </label>
            <input
              type="text"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="Auto-detect from files"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Leave blank to derive from file metadata
            </p>
          </div>

          {/* Result / Error display */}
          {mutation.isSuccess && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-900/20">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Imported {mutation.data.prediction_count.toLocaleString()} predictions
                {" "}as &ldquo;{mutation.data.run_name}&rdquo;
              </p>
              {mutation.data.skipped_count > 0 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  {mutation.data.skipped_count.toLocaleString()} skipped (no matching sample)
                </p>
              )}
            </div>
          )}

          {mutation.isError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 dark:bg-red-900/20">
              <p className="text-sm text-red-600 dark:text-red-400">
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Import failed"}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <button
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {mutation.isSuccess ? "Close" : "Cancel"}
          </button>
          {!mutation.isSuccess && (
            <button
              onClick={handleImport}
              disabled={!path.trim() || mutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {mutation.isPending && (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              )}
              {mutation.isPending ? "Importing..." : "Import"}
            </button>
          )}
        </div>
      </div>

      {/* Folder browser sub-modal */}
      {showBrowser && (
        <FolderBrowser
          initialPath={path || "/"}
          isGcs={false}
          onSelect={(selected) => {
            setPath(selected);
            setShowBrowser(false);
          }}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </div>
  );
}
