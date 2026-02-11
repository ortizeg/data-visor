/**
 * Sort controls for selecting sort field and direction.
 *
 * Reads sortBy and sortDir from the filter store and dispatches
 * setSortBy and setSortDir actions. Renders a compact row with
 * a dropdown and a direction toggle button.
 */

"use client";

import { useFilterStore } from "@/stores/filter-store";

const SORT_OPTIONS = [
  { value: "id", label: "ID" },
  { value: "file_name", label: "Filename" },
  { value: "width", label: "Width" },
  { value: "height", label: "Height" },
] as const;

export function SortControls() {
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortDir = useFilterStore((s) => s.sortDir);
  const setSortBy = useFilterStore((s) => s.setSortBy);
  const setSortDir = useFilterStore((s) => s.setSortDir);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Sort by
      </label>
      <div className="flex gap-2">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
          className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          title={sortDir === "asc" ? "Ascending" : "Descending"}
        >
          {sortDir === "asc" ? "\u2191 ASC" : "\u2193 DESC"}
        </button>
      </div>
    </div>
  );
}
