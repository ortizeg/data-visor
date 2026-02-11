/**
 * Zustand store for filter state management.
 *
 * Drives TanStack Query's queryKey for automatic refetch-on-filter-change.
 * Each filter change triggers a new cache entry in useInfiniteQuery,
 * providing instant results for previously-visited filter combinations.
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

  /** Actions */
  setSearch: (search: string) => void;
  setCategory: (category: string | null) => void;
  setSplit: (split: string | null) => void;
  setTags: (tags: string[]) => void;
  setSortBy: (sortBy: string) => void;
  setSortDir: (sortDir: "asc" | "desc") => void;
  clearFilters: () => void;
  applyView: (filters: Partial<FilterState>) => void;
}

const DEFAULT_FILTERS = {
  search: "",
  category: null as string | null,
  split: null as string | null,
  tags: [] as string[],
  sortBy: "id",
  sortDir: "asc" as const,
};

export const useFilterStore = create<FilterState>((set) => ({
  ...DEFAULT_FILTERS,

  setSearch: (search) => set({ search }),
  setCategory: (category) => set({ category }),
  setSplit: (split) => set({ split }),
  setTags: (tags) => set({ tags }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortDir: (sortDir) => set({ sortDir }),
  clearFilters: () => set(DEFAULT_FILTERS),
  applyView: (filters) => set((state) => ({ ...state, ...filters })),
}));

// Atomic selectors (per TkDodo's Zustand best practices)
export const useSearch = () => useFilterStore((s) => s.search);
export const useCategory = () => useFilterStore((s) => s.category);
export const useSplit = () => useFilterStore((s) => s.split);
export const useTags = () => useFilterStore((s) => s.tags);
export const useSortBy = () => useFilterStore((s) => s.sortBy);
export const useSortDir = () => useFilterStore((s) => s.sortDir);
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
    return count;
  });
