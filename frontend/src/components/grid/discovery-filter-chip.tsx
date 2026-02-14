"use client";

/**
 * Visual indicator showing when a discovery filter (find-similar,
 * confusion cell, near-dupes) is active. Displays sample count
 * and an X button to clear.
 */

import { useSampleIdFilter, useFilterStore } from "@/stores/filter-store";

export function DiscoveryFilterChip() {
  const sampleIdFilter = useSampleIdFilter();

  if (sampleIdFilter === null) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
      Discovery filter: {sampleIdFilter.length} samples
      <button
        onClick={() => useFilterStore.getState().clearSampleIdFilter()}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-blue-100 dark:hover:bg-blue-800/50"
        aria-label="Clear discovery filter"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M1 1l6 6M7 1l-6 6" />
        </svg>
      </button>
    </span>
  );
}
