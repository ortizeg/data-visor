/**
 * Infinite query hook for paginated sample fetching with filter integration.
 *
 * Reads filter state from the Zustand filter store and lasso selection
 * from the embedding store. Both are included in the TanStack Query
 * queryKey so changes to either trigger automatic refetches.
 *
 * Architecture: Lasso selection (spatial) lives in embedding-store.
 * Metadata filters (category, split, tags) live in filter-store.
 * This hook is the single integration point that reads from both.
 */

import { useInfiniteQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { PAGE_SIZE } from "@/lib/constants";
import { useFilterStore } from "@/stores/filter-store";
import { useLassoSelectedIds } from "@/stores/embedding-store";
import type { PaginatedSamples } from "@/types/sample";

/** Maximum sample_ids to send (matches backend limit). */
const MAX_LASSO_IDS = 5000;

export function useSamples(datasetId: string) {
  // Read filter state -- each change creates a new query key
  const search = useFilterStore((s) => s.search);
  const category = useFilterStore((s) => s.category);
  const split = useFilterStore((s) => s.split);
  const tags = useFilterStore((s) => s.tags);
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortDir = useFilterStore((s) => s.sortDir);

  // Read lasso selection from embedding store (cross-filter)
  const lassoSelectedIds = useLassoSelectedIds();

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
    // Filter state + lasso selection in key = automatic refetch on change
    queryKey: ["samples", datasetId, filters, lassoSelectedIds],
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

      // Lasso cross-filter: pass selected sample IDs to backend
      if (lassoSelectedIds !== null && lassoSelectedIds.length > 0) {
        const ids =
          lassoSelectedIds.length > MAX_LASSO_IDS
            ? lassoSelectedIds.slice(0, MAX_LASSO_IDS)
            : lassoSelectedIds;
        params.set("sample_ids", ids.join(","));
      }

      return apiFetch<PaginatedSamples>(`/samples?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
  });
}
