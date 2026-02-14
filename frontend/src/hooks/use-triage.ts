/**
 * TanStack Query hooks for triage operations.
 *
 * - useSetTriageTag: atomically set a triage tag on a sample
 * - useRemoveTriageTag: remove all triage tags from a sample
 * - useWorstImages: fetch ranked samples by composite error score
 *
 * Mutations invalidate ["samples"] and ["filter-facets"] on success
 * so the grid and filter dropdowns refresh with updated tags.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiDelete, apiFetch, apiPatch } from "@/lib/api";
import type { WorstImagesResponse } from "@/types/triage";

// -- Mutations --

interface SetTriageTagInput {
  dataset_id: string;
  sample_id: string;
  tag: string;
}

interface SetTriageTagResponse {
  sample_id: string;
  tag: string;
}

export function useSetTriageTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SetTriageTagInput) =>
      apiPatch<SetTriageTagResponse>("/samples/set-triage-tag", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["samples"] });
      queryClient.invalidateQueries({ queryKey: ["filter-facets"] });
    },
  });
}

interface RemoveTriageTagInput {
  dataset_id: string;
  sample_id: string;
}

export function useRemoveTriageTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ dataset_id, sample_id }: RemoveTriageTagInput) =>
      apiDelete(
        `/samples/${encodeURIComponent(sample_id)}/triage-tag?dataset_id=${encodeURIComponent(dataset_id)}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["samples"] });
      queryClient.invalidateQueries({ queryKey: ["filter-facets"] });
    },
  });
}

// -- Query --

export function useWorstImages(
  datasetId: string,
  source: string,
  iouThreshold: number,
  confThreshold: number,
  split: string | null = null,
  enabled: boolean = true,
) {
  const splitParam = split
    ? `&split=${encodeURIComponent(split)}`
    : "";

  return useQuery({
    queryKey: [
      "worst-images",
      datasetId,
      source,
      iouThreshold,
      confThreshold,
      split,
    ],
    queryFn: () =>
      apiFetch<WorstImagesResponse>(
        `/datasets/${datasetId}/worst-images?source=${encodeURIComponent(source)}&iou_threshold=${iouThreshold}&conf_threshold=${confThreshold}${splitParam}`,
      ),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: !!datasetId && enabled,
  });
}
