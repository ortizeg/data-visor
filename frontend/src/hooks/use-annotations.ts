/**
 * Hooks for fetching annotations.
 *
 * - useAnnotationsBatch: Batch-fetch for the grid (multiple samples, one request)
 * - useAnnotations: Single-sample fetch for the detail modal
 *
 * Both hooks read activeSources from the UI store and pass a sources query
 * parameter to the backend so only the relevant annotations are fetched.
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import { useUIStore } from "@/stores/ui-store";
import type { Annotation, BatchAnnotationsResponse } from "@/types/annotation";

/**
 * Fetch annotations for multiple samples in a single batch request.
 *
 * @param datasetId - The dataset to query annotations from
 * @param sampleIds - Array of sample IDs to fetch annotations for
 * @returns Record mapping sample_id to its annotations array
 */
export function useAnnotationsBatch(datasetId: string, sampleIds: string[]) {
  const activeSources = useUIStore((s) => s.activeSources);

  // Sort IDs for cache key stability -- same set of IDs always hits same cache
  const sortedIds = [...sampleIds].sort();

  const sourcesQuery =
    activeSources === null ? "" : `&sources=${activeSources.join(",")}`;

  return useQuery({
    queryKey: ["annotations-batch", datasetId, activeSources, ...sortedIds],
    queryFn: () =>
      apiFetch<BatchAnnotationsResponse>(
        `/samples/batch-annotations?dataset_id=${datasetId}&sample_ids=${sortedIds.join(",")}${sourcesQuery}`,
      ),
    staleTime: 5 * 60 * 1000, // 5 min -- annotations can change after prediction import
    enabled: sampleIds.length > 0,
    select: (data) => data.annotations,
  });
}

/**
 * Fetch annotations for a single sample.
 *
 * Used by the detail modal to load annotation data for the selected sample.
 * Uses the per-sample endpoint (fine for a single detail view).
 *
 * @param datasetId - The dataset the sample belongs to
 * @param sampleId - The sample to fetch annotations for (null disables the query)
 */
export function useAnnotations(
  datasetId: string,
  sampleId: string | null,
) {
  const activeSources = useUIStore((s) => s.activeSources);

  const sourcesQuery =
    activeSources === null ? "" : `&sources=${activeSources.join(",")}`;

  return useQuery({
    queryKey: ["annotations", sampleId, datasetId, activeSources],
    queryFn: () =>
      apiFetch<Annotation[]>(
        `/samples/${sampleId}/annotations?dataset_id=${datasetId}${sourcesQuery}`,
      ),
    staleTime: 5 * 60 * 1000, // 5 min -- annotations can change after prediction import
    enabled: !!sampleId,
  });
}
