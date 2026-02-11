/**
 * Infinite query hook for paginated sample fetching with filter integration.
 *
 * Reads filter state from the Zustand filter store and includes it in
 * the TanStack Query queryKey. When any filter changes, TanStack Query
 * automatically creates a new cache entry and refetches.
 */

import { useInfiniteQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { PAGE_SIZE } from "@/lib/constants";
import { useFilterStore } from "@/stores/filter-store";
import type { PaginatedSamples } from "@/types/sample";

export function useSamples(datasetId: string) {
  // Read filter state -- each change creates a new query key
  const search = useFilterStore((s) => s.search);
  const category = useFilterStore((s) => s.category);
  const split = useFilterStore((s) => s.split);
  const tags = useFilterStore((s) => s.tags);
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortDir = useFilterStore((s) => s.sortDir);

  // Sort tags for structural stability in query key
  const filters = {
    search,
    category,
    split,
    tags: [...tags].sort(),
    sortBy,
    sortDir,
  };

  return useInfiniteQuery({
    // Filter state in key = automatic refetch on change
    queryKey: ["samples", datasetId, filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        dataset_id: datasetId,
        offset: String(pageParam),
        limit: String(PAGE_SIZE),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      if (split) params.set("split", split);
      if (tags.length > 0) params.set("tags", tags.join(","));

      return apiFetch<PaginatedSamples>(`/samples?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
  });
}
