/**
 * TanStack Query hooks for embedding data fetching and mutations.
 *
 * Provides the data layer for the embedding visualization:
 * - useEmbeddingStatus: Check whether embeddings/reduction exist
 * - useEmbeddingCoordinates: Fetch 2D scatter-plot coordinates
 * - useGenerateEmbeddings: Trigger background embedding generation
 * - useReduceEmbeddings: Trigger background UMAP reduction
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, apiPost } from "@/lib/api";
import type { EmbeddingPoint, EmbeddingStatus } from "@/types/embedding";

/**
 * Fetch the current embedding status for a dataset.
 *
 * Reports whether embeddings exist, their count, model used,
 * and whether 2D reduction coordinates are populated.
 */
export function useEmbeddingStatus(datasetId: string) {
  return useQuery({
    queryKey: ["embedding-status", datasetId],
    queryFn: () =>
      apiFetch<EmbeddingStatus>(
        `/datasets/${datasetId}/embeddings/status`,
      ),
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Fetch 2D scatter-plot coordinates for all embedded samples.
 *
 * Only fetches when `enabled` is true (i.e. has_reduction === true).
 * Coordinates are stable (staleTime: Infinity) until a new reduction runs.
 */
export function useEmbeddingCoordinates(
  datasetId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["embedding-coordinates", datasetId],
    queryFn: () =>
      apiFetch<EmbeddingPoint[]>(
        `/datasets/${datasetId}/embeddings/coordinates`,
      ),
    enabled,
    staleTime: Infinity,
  });
}

/**
 * Trigger background embedding generation for a dataset.
 *
 * On success, invalidates the embedding status query to refresh
 * has_embeddings / embedding_count.
 */
export function useGenerateEmbeddings(datasetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiPost<{ status: string; message: string }>(
        `/datasets/${datasetId}/embeddings/generate`,
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["embedding-status", datasetId],
      });
    },
  });
}

/**
 * Trigger background UMAP dimensionality reduction for a dataset.
 *
 * On success, invalidates both the status and coordinates queries
 * so the scatter plot refetches fresh 2D coordinates.
 */
export function useReduceEmbeddings(datasetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiPost<{ status: string; message: string }>(
        `/datasets/${datasetId}/embeddings/reduce`,
        {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["embedding-status", datasetId],
      });
      queryClient.invalidateQueries({
        queryKey: ["embedding-coordinates", datasetId],
      });
    },
  });
}
