/**
 * TanStack Query hook for fetching similarity search results.
 *
 * Accepts an `enabled` flag so the SampleModal can control when to fetch
 * (only after the user clicks "Find Similar").
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { SimilarityResponse } from "@/types/similarity";

export function useSimilarity(
  datasetId: string,
  sampleId: string | null,
  limit: number = 20,
  enabled: boolean = false,
) {
  return useQuery({
    queryKey: ["similarity", datasetId, sampleId, limit],
    queryFn: () =>
      apiFetch<SimilarityResponse>(
        `/datasets/${datasetId}/similarity/search?sample_id=${encodeURIComponent(sampleId!)}&limit=${limit}`,
      ),
    enabled: enabled && !!datasetId && !!sampleId,
    staleTime: 60_000, // 1 min -- same embeddings produce same results
  });
}
