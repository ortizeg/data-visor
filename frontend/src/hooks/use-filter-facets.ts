/**
 * Hook for fetching distinct filter values (facets) for a dataset.
 *
 * Returns categories, splits, and tags that can be used to populate
 * filter dropdown options. Uses a 5-minute staleTime since facets
 * are per-dataset and rarely change mid-session.
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { FilterFacets } from "@/types/filter";

export function useFilterFacets(datasetId: string) {
  return useQuery({
    queryKey: ["filter-facets", datasetId],
    queryFn: () =>
      apiFetch<FilterFacets>(
        `/samples/filter-facets?dataset_id=${datasetId}`,
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
