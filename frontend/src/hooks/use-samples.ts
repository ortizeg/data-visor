/**
 * Infinite query hook for paginated sample fetching.
 *
 * Uses TanStack Query's useInfiniteQuery to fetch pages of samples
 * on demand. Each page contains PAGE_SIZE samples. The next page
 * offset is derived from the last page's offset + limit.
 */

import { useInfiniteQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { PAGE_SIZE } from "@/lib/constants";
import type { PaginatedSamples } from "@/types/sample";

export function useSamples(datasetId: string) {
  return useInfiniteQuery({
    queryKey: ["samples", datasetId],
    queryFn: ({ pageParam }) =>
      apiFetch<PaginatedSamples>(
        `/samples?dataset_id=${datasetId}&offset=${pageParam}&limit=${PAGE_SIZE}`,
      ),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
  });
}
