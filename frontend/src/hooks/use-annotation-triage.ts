/**
 * TanStack Query hooks for per-annotation triage operations.
 *
 * - useAnnotationTriage: fetch per-annotation TP/FP/FN classifications
 * - useSetAnnotationTriage: persist a triage override
 * - useRemoveAnnotationTriage: remove a triage override
 *
 * Follows the same patterns as use-triage.ts (apiFetch, apiPatch, apiDelete).
 * Mutations invalidate ["annotation-triage"] and ["samples"] caches on success.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiFetch, apiPatch } from "@/lib/api";
import type {
  AnnotationTriageResponse,
  AnnotationTriageResult,
} from "@/types/annotation-triage";

// ---------------------------------------------------------------------------
// Query: fetch per-annotation triage classifications for a sample
// ---------------------------------------------------------------------------

/**
 * Fetch per-annotation triage results for a single sample.
 *
 * Returns a Record<annotation_id, AnnotationTriageResult> for O(1) lookup
 * by the overlay component.
 *
 * @param datasetId - Dataset the sample belongs to
 * @param sampleId  - Sample to fetch triage for (null disables query)
 * @param source    - Prediction source to match against GT
 * @param enabled   - Additional enable guard
 */
export function useAnnotationTriage(
  datasetId: string,
  sampleId: string | null,
  source: string,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ["annotation-triage", sampleId, datasetId, source],
    queryFn: () =>
      apiFetch<AnnotationTriageResponse>(
        `/samples/${sampleId}/annotation-triage?dataset_id=${encodeURIComponent(datasetId)}&source=${encodeURIComponent(source)}`,
      ),
    staleTime: 30_000, // 30s
    enabled: !!sampleId && enabled,
    select: (data): Record<string, AnnotationTriageResult> => {
      const map: Record<string, AnnotationTriageResult> = {};
      for (const item of data.items) {
        map[item.annotation_id] = item;
      }
      return map;
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: set / override annotation triage label
// ---------------------------------------------------------------------------

interface SetAnnotationTriageInput {
  annotation_id: string;
  dataset_id: string;
  sample_id: string;
  label: string;
}

/**
 * Persist a triage override for a specific annotation.
 *
 * Invalidates annotation-triage and samples caches on success
 * (samples because the sample-level triage:annotated tag changes).
 */
export function useSetAnnotationTriage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SetAnnotationTriageInput) =>
      apiPatch<{ annotation_id: string; label: string }>(
        "/samples/set-annotation-triage",
        body,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["annotation-triage"] });
      queryClient.invalidateQueries({ queryKey: ["samples"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: remove annotation triage override
// ---------------------------------------------------------------------------

/**
 * Remove a triage override for a specific annotation.
 *
 * Invalidates annotation-triage and samples caches on success.
 */
export function useRemoveAnnotationTriage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sampleId,
      annotationId,
      datasetId,
    }: {
      sampleId: string;
      annotationId: string;
      datasetId: string;
    }) =>
      apiDelete(
        `/samples/${encodeURIComponent(sampleId)}/annotation-triage/${encodeURIComponent(annotationId)}?dataset_id=${encodeURIComponent(datasetId)}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["annotation-triage"] });
      queryClient.invalidateQueries({ queryKey: ["samples"] });
    },
  });
}
