/**
 * Zustand store for filter state management.
 *
 * Drives TanStack Query's queryKey for automatic refetch-on-filter-change.
 * Each filter change triggers a new cache entry in useInfiniteQuery,
 * providing instant results for previously-visited filter combinations.
 *
 * Selection state (selectedSampleIds, isSelecting) is UI-only and NOT
 * included in the TanStack Query key to avoid unnecessary refetches.
 */

import { create } from "zustand";

interface FilterState {
  /** Active filters applied to the grid */
  search: string;
  category: string | null;
  split: string | null;
  tags: string[];
  sortBy: string;
  sortDir: "asc" | "desc";

  /** Discovery filter: sample IDs from find-similar, confusion cell, near-dupes.
   *  null = no filter active. */
  sampleIdFilter: string[] | null;

  /** Selection state for bulk tagging (UI-only, not in query key) */
  selectedSampleIds: Set<string>;
  isSelecting: boolean;

  /** Actions */
  setSearch: (search: string) => void;
  setCategory: (category: string | null) => void;
  setSplit: (split: string | null) => void;
  setTags: (tags: string[]) => void;
  setSortBy: (sortBy: string) => void;
  setSortDir: (sortDir: "asc" | "desc") => void;
  setSampleIdFilter: (ids: string[] | null) => void;
  clearSampleIdFilter: () => void;
  clearFilters: () => void;
  applyView: (filters: Partial<FilterState>) => void;

  /** Selection actions */
  toggleSampleSelection: (id: string) => void;
  selectAllVisible: (ids: string[]) => void;
  clearSelection: () => void;
  setIsSelecting: (v: boolean) => void;
}

const DEFAULT_FILTERS = {
  search: "",
  category: null as string | null,
  split: null as string | null,
  tags: [] as string[],
  sortBy: "id",
  sortDir: "asc" as const,
  sampleIdFilter: null as string[] | null,
  selectedSampleIds: new Set<string>(),
  isSelecting: false,
};

export const useFilterStore = create<FilterState>((set) => ({
  ...DEFAULT_FILTERS,

  setSearch: (search) => set({ search }),
  setCategory: (category) => set({ category }),
  setSplit: (split) => set({ split }),
  setTags: (tags) => set({ tags }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortDir: (sortDir) => set({ sortDir }),
  setSampleIdFilter: (ids) => set({ sampleIdFilter: ids }),
  clearSampleIdFilter: () => set({ sampleIdFilter: null }),
  clearFilters: () =>
    set({
      ...DEFAULT_FILTERS,
      selectedSampleIds: new Set<string>(),
    }),
  applyView: (filters) => set((state) => ({ ...state, ...filters })),

  toggleSampleSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedSampleIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedSampleIds: next };
    }),
  selectAllVisible: (ids) =>
    set({ selectedSampleIds: new Set(ids) }),
  clearSelection: () =>
    set({ selectedSampleIds: new Set<string>() }),
  setIsSelecting: (v) =>
    set({
      isSelecting: v,
      ...(v ? {} : { selectedSampleIds: new Set<string>() }),
    }),
}));

// Atomic selectors (per TkDodo's Zustand best practices)
export const useSearch = () => useFilterStore((s) => s.search);
export const useCategory = () => useFilterStore((s) => s.category);
export const useSplit = () => useFilterStore((s) => s.split);
export const useTags = () => useFilterStore((s) => s.tags);
export const useSortBy = () => useFilterStore((s) => s.sortBy);
export const useSortDir = () => useFilterStore((s) => s.sortDir);
export const useSelectedSampleIds = () =>
  useFilterStore((s) => s.selectedSampleIds);
export const useIsSelecting = () =>
  useFilterStore((s) => s.isSelecting);
export const useSampleIdFilter = () =>
  useFilterStore((s) => s.sampleIdFilter);
export const useFilterActions = () =>
  useFilterStore((s) => ({
    setSearch: s.setSearch,
    setCategory: s.setCategory,
    setSplit: s.setSplit,
    setTags: s.setTags,
    setSortBy: s.setSortBy,
    setSortDir: s.setSortDir,
    clearFilters: s.clearFilters,
    applyView: s.applyView,
  }));

/** Count non-default filters for badge display */
export const useActiveFilterCount = () =>
  useFilterStore((s) => {
    let count = 0;
    if (s.search !== "") count++;
    if (s.category !== null) count++;
    if (s.split !== null) count++;
    if (s.tags.length > 0) count++;
    if (s.sortBy !== "id") count++;
    if (s.sortDir !== "asc") count++;
    if (s.sampleIdFilter !== null) count++;
    return count;
  });
