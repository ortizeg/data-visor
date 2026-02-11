/**
 * TanStack Query hooks for saved view CRUD operations.
 *
 * - useSavedViews: fetches saved views for a dataset
 * - useCreateView: creates a new saved view
 * - useDeleteView: deletes a saved view
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiPost, apiDelete, apiFetch } from "@/lib/api";
import type { SavedView, SavedViewList } from "@/types/view";

export function useSavedViews(datasetId: string) {
  return useQuery({
    queryKey: ["saved-views", datasetId],
    queryFn: () =>
      apiFetch<SavedViewList>(
        `/views?dataset_id=${encodeURIComponent(datasetId)}`,
      ),
    staleTime: 60_000, // 1 minute
  });
}

export function useCreateView(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      dataset_id: string;
      name: string;
      filters: Record<string, unknown>;
    }) => apiPost<SavedView>("/views", body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["saved-views", datasetId],
      });
    },
  });
}

export function useDeleteView(datasetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) => apiDelete(`/views/${viewId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["saved-views", datasetId],
      });
    },
  });
}
