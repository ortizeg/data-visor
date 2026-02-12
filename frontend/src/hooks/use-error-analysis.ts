/**
 * TanStack Query hook for fetching error analysis data.
 *
 * Returns per-detection error categorization (TP, Hard FP, Label Error, FN)
 * for a given prediction source at specified IoU and confidence thresholds.
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { ErrorAnalysisResponse } from "@/types/error-analysis";

export function useErrorAnalysis(
  datasetId: string,
  source: string,
  iouThreshold: number,
  confThreshold: number,
) {
  return useQuery({
    queryKey: [
      "error-analysis",
      datasetId,
      source,
      iouThreshold,
      confThreshold,
    ],
    queryFn: () =>
      apiFetch<ErrorAnalysisResponse>(
        `/datasets/${datasetId}/error-analysis?source=${encodeURIComponent(source)}&iou_threshold=${iouThreshold}&conf_threshold=${confThreshold}`,
      ),
    staleTime: 30_000, // 30s -- results depend on thresholds
    enabled: !!datasetId,
  });
}
