/**
 * Filter sidebar with category and split filter dropdowns.
 *
 * Reads filter facets from the backend and current filter state from
 * the Zustand store. Changes to filters automatically trigger a
 * TanStack Query refetch via the queryKey in useSamples.
 */

"use client";

import { FilterSelect } from "./filter-select";
import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useFilterStore } from "@/stores/filter-store";

interface FilterSidebarProps {
  datasetId: string;
}

export function FilterSidebar({ datasetId }: FilterSidebarProps) {
  const { data: facets } = useFilterFacets(datasetId);

  const category = useFilterStore((s) => s.category);
  const split = useFilterStore((s) => s.split);
  const setCategory = useFilterStore((s) => s.setCategory);
  const setSplit = useFilterStore((s) => s.setSplit);
  const clearFilters = useFilterStore((s) => s.clearFilters);

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Filters
        </h2>
        <button
          onClick={clearFilters}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Clear all
        </button>
      </div>

      <FilterSelect
        label="Category"
        options={facets?.categories ?? []}
        value={category}
        onChange={setCategory}
      />

      <FilterSelect
        label="Split"
        options={facets?.splits ?? []}
        value={split}
        onChange={setSplit}
      />
    </aside>
  );
}
