/**
 * Saved view picker for loading, saving, and deleting filter views.
 *
 * Renders a dropdown showing saved views with a "Save current..." option.
 * When a view is selected, its filters are applied to the filter store.
 * Users can delete views via a small "x" button in the dropdown.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import {
  useSavedViews,
  useCreateView,
  useDeleteView,
} from "@/hooks/use-saved-views";
import { useFilterStore } from "@/stores/filter-store";

interface SavedViewPickerProps {
  datasetId: string;
}

export function SavedViewPicker({ datasetId }: SavedViewPickerProps) {
  const { data } = useSavedViews(datasetId);
  const createView = useCreateView(datasetId);
  const deleteView = useDeleteView(datasetId);
  const applyView = useFilterStore((s) => s.applyView);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const views = data?.views ?? [];

  function handleSaveCurrent() {
    const name = window.prompt("Enter a name for this view:");
    if (!name?.trim()) return;

    const state = useFilterStore.getState();
    const filters: Record<string, unknown> = {
      search: state.search,
      category: state.category,
      split: state.split,
      tags: state.tags,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
    };

    createView.mutate({
      dataset_id: datasetId,
      name: name.trim(),
      filters,
    });
    setOpen(false);
  }

  function handleSelect(filters: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyView(filters as any);
    setOpen(false);
  }

  function handleDelete(e: React.MouseEvent, viewId: string) {
    e.stopPropagation();
    deleteView.mutate(viewId);
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Saved Views
      </label>
      <button
        onClick={() => setOpen(!open)}
        className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-left text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
      >
        {views.length > 0
          ? `${views.length} saved view${views.length !== 1 ? "s" : ""}`
          : "No saved views"}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          <ul className="max-h-48 overflow-auto py-1">
            {views.map((view) => (
              <li
                key={view.id}
                className="flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                onClick={() => handleSelect(view.filters)}
              >
                <span className="truncate">{view.name}</span>
                <button
                  onClick={(e) => handleDelete(e, view.id)}
                  className="ml-2 shrink-0 text-zinc-400 hover:text-red-500"
                  title="Delete view"
                >
                  x
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-zinc-200 dark:border-zinc-700">
            <button
              onClick={handleSaveCurrent}
              className="w-full px-3 py-1.5 text-left text-sm text-blue-600 hover:bg-zinc-100 dark:text-blue-400 dark:hover:bg-zinc-700"
            >
              Save current...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
