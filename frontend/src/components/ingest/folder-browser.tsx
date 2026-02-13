"use client";

/**
 * Modal file/folder browser for navigating the server's file system.
 *
 * Shows directories and JSON files. Clicking a folder navigates into it.
 * "Select" picks the current directory as the dataset path.
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { apiPost } from "@/lib/api";

interface BrowseEntry {
  name: string;
  type: "directory" | "file";
  size: number | null;
}

interface BrowseResponse {
  path: string;
  entries: BrowseEntry[];
}

interface FolderBrowserProps {
  /** Initial path to browse. */
  initialPath: string;
  /** Whether the browser is for a GCS path. */
  isGcs: boolean;
  /** Called when user selects a directory. */
  onSelect: (path: string) => void;
  /** Called when user closes the modal. */
  onClose: () => void;
}

export default function FolderBrowser({
  initialPath,
  isGcs,
  onSelect,
  onClose,
}: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(
    initialPath || (isGcs ? "" : "/"),
  );

  const browse = useMutation({
    mutationFn: (path: string) =>
      apiPost<BrowseResponse>("/ingestion/browse", { path }),
  });

  const navigateTo = useCallback(
    (path: string) => {
      setCurrentPath(path);
      browse.mutate(path);
    },
    [browse],
  );

  // Browse on mount
  useEffect(() => {
    if (currentPath) {
      browse.mutate(currentPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goUp = () => {
    if (isGcs) {
      // gs://bucket/path/to/dir -> gs://bucket/path/to
      const parts = currentPath.replace("gs://", "").split("/");
      if (parts.length <= 1) return; // at bucket root
      parts.pop();
      navigateTo("gs://" + parts.join("/"));
    } else {
      const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
      if (parent !== currentPath) {
        navigateTo(parent);
      }
    }
  };

  const enterDir = (name: string) => {
    const sep = currentPath.endsWith("/") ? "" : "/";
    navigateTo(`${currentPath}${sep}${name}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Browse Folders
          </h3>
          <button
            onClick={onClose}
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

        {/* Current path */}
        <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {browse.data?.path || currentPath}
          </p>
        </div>

        {/* Entries */}
        <div className="flex-1 overflow-y-auto">
          {browse.isPending && (
            <div className="flex items-center justify-center py-8">
              <svg
                className="h-5 w-5 animate-spin text-blue-600"
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
            </div>
          )}

          {browse.isError && (
            <div className="px-4 py-4">
              <p className="text-sm text-red-600 dark:text-red-400">
                {browse.error instanceof Error
                  ? browse.error.message
                  : "Failed to browse directory"}
              </p>
            </div>
          )}

          {browse.data && (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {/* Parent directory */}
              <li>
                <button
                  onClick={goUp}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4 text-zinc-400"
                  >
                    <path
                      fillRule="evenodd"
                      d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                      clipRule="evenodd"
                    />
                  </svg>
                  ..
                </button>
              </li>
              {browse.data.entries.map((entry) => (
                <li key={entry.name}>
                  <button
                    onClick={() =>
                      entry.type === "directory" ? enterDir(entry.name) : undefined
                    }
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                      entry.type === "directory"
                        ? "text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                        : "cursor-default text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {entry.type === "directory" ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-4 w-4 text-blue-500"
                      >
                        <path d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-4 w-4 text-zinc-400"
                      >
                        <path d="M3 3.5A1.5 1.5 0 014.5 2h6.879a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0117 7.622V16.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-13z" />
                      </svg>
                    )}
                    <span className="flex-1 truncate">{entry.name}</span>
                    {entry.size != null && (
                      <span className="text-xs text-zinc-400">
                        {formatSize(entry.size)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {browse.data.entries.length === 0 && (
                <li className="px-4 py-4 text-center text-sm text-zinc-400">
                  Empty directory
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(browse.data?.path || currentPath)}
            disabled={browse.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Select This Folder
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
