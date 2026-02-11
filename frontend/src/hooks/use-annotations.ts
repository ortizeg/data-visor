/**
 * Hook for batch-fetching annotations for multiple samples at once.
 *
 * Fetches annotations for the visible batch of samples in a single
 * request to avoid per-cell annotation request waterfalls.
 * Returns a Record<sampleId, Annotation[]>.
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { BatchAnnotationsResponse } from "@/types/annotation";

/**
 * Fetch annotations for multiple samples in a single batch request.
 *
 * @param datasetId - The dataset to query annotations from
 * @param sampleIds - Array of sample IDs to fetch annotations for
 * @returns Record mapping sample_id to its annotations array
 */
export function useAnnotationsBatch(datasetId: string, sampleIds: string[]) {
  // Sort IDs for cache key stability -- same set of IDs always hits same cache
  const sortedIds = [...sampleIds].sort();

  return useQuery({
    queryKey: ["annotations-batch", datasetId, ...sortedIds],
    queryFn: () =>
      apiFetch<BatchAnnotationsResponse>(
        `/samples/batch-annotations?dataset_id=${datasetId}&sample_ids=${sortedIds.join(",")}`,
      ),
    staleTime: Infinity, // annotations don't change during session
    enabled: sampleIds.length > 0,
    select: (data) => data.annotations,
  });
}
