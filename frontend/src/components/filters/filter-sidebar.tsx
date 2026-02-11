/**
 * Filter sidebar with collapsible filter sections, search, sort controls,
 * saved views, and bulk tagging actions.
 *
 * Uses FiftyOne/Voxel51-style collapsible sections with inline checkbox
 * items and counts instead of dropdown <select> menus.
 */

"use client";

import { useState } from "react";
import { FilterSection } from "./filter-section";
import { SearchInput } from "./search-input";
import { SortControls } from "./sort-controls";
import { SavedViewPicker } from "./saved-view-picker";
import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useBulkTag, useBulkUntag } from "@/hooks/use-tags";
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
  const isSelecting = useFilterStore((s) => s.isSelecting);
  const setIsSelecting = useFilterStore((s) => s.setIsSelecting);
  const selectedSampleIds = useFilterStore((s) => s.selectedSampleIds);
  const clearSelection = useFilterStore((s) => s.clearSelection);

  const bulkTag = useBulkTag();
  const bulkUntag = useBulkUntag();
  const [tagInput, setTagInput] = useState("");

  function handleAddTag() {
    const tag = tagInput.trim();
    if (!tag || selectedSampleIds.size === 0) return;
    bulkTag.mutate(
      {
        dataset_id: datasetId,
        sample_ids: Array.from(selectedSampleIds),
        tag,
      },
      {
        onSuccess: () => {
          setTagInput("");
          clearSelection();
        },
      },
    );
  }

  function handleRemoveTag() {
    const tag = tagInput.trim();
    if (!tag || selectedSampleIds.size === 0) return;
    bulkUntag.mutate(
      {
        dataset_id: datasetId,
        sample_ids: Array.from(selectedSampleIds),
        tag,
      },
      {
        onSuccess: () => {
          setTagInput("");
          clearSelection();
        },
      },
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
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

      {/* Select mode toggle */}
      <div className="px-4 pb-2">
        <button
          onClick={() => setIsSelecting(!isSelecting)}
          className={`w-full rounded-md border px-3 py-1.5 text-sm ${
            isSelecting
              ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300"
              : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }`}
        >
          {isSelecting ? "Exit select mode" : "Select mode"}
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pb-2">
        <SearchInput />
      </div>

      {/* Collapsible filter sections */}
      <div className="flex-1 overflow-y-auto px-3">
        <FilterSection
          title="Category"
          items={facets?.categories ?? []}
          selected={category}
          onSelect={setCategory}
        />

        <FilterSection
          title="Split"
          items={facets?.splits ?? []}
          selected={split}
          onSelect={setSplit}
        />
      </div>

      {/* Bottom controls */}
      <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <SortControls />

        {/* Bulk tag section (visible when selecting) */}
        {isSelecting && (
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {selectedSampleIds.size} sample
              {selectedSampleIds.size !== 1 ? "s" : ""} selected
            </p>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Tag name..."
              className="mb-2 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAddTag}
                disabled={
                  !tagInput.trim() ||
                  selectedSampleIds.size === 0 ||
                  bulkTag.isPending
                }
                className="flex-1 rounded-md bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Add Tag
              </button>
              <button
                onClick={handleRemoveTag}
                disabled={
                  !tagInput.trim() ||
                  selectedSampleIds.size === 0 ||
                  bulkUntag.isPending
                }
                className="flex-1 rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
              >
                Remove Tag
              </button>
            </div>
          </div>
        )}

        <SavedViewPicker datasetId={datasetId} />
      </div>
    </aside>
  );
}
