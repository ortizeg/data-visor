/**
 * Debounced search input for filtering samples by filename.
 *
 * Uses local state for immediate input feedback, syncing to the Zustand
 * filter store after a 300ms debounce. The store search value also syncs
 * back to local state for external changes (e.g., loading a saved view).
 */

"use client";

import { useState, useEffect } from "react";
import { useFilterStore } from "@/stores/filter-store";

const DEBOUNCE_MS = 300;

export function SearchInput() {
  const setSearch = useFilterStore((s) => s.setSearch);
  const storeSearch = useFilterStore((s) => s.search);

  // Local state for immediate input feedback
  const [localValue, setLocalValue] = useState(storeSearch);

  // Debounce: update store after user stops typing
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(localValue);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localValue, setSearch]);

  // Sync when store changes externally (e.g., loading a saved view)
  useEffect(() => {
    setLocalValue(storeSearch);
  }, [storeSearch]);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Search
      </label>
      <input
        type="search"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        placeholder="Search by filename..."
        className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
    </div>
  );
}
