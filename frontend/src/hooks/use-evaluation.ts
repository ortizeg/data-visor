/**
 * TanStack Query hook for fetching evaluation metrics.
 *
 * Returns PR curves, mAP, confusion matrix, and per-class metrics
 * for a given prediction source at specified IoU and confidence thresholds.
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { EvaluationResponse } from "@/types/evaluation";

export function useEvaluation(
  datasetId: string,
  source: string,
  iouThreshold: number,
  confThreshold: number,
) {
  return useQuery({
    queryKey: ["evaluation", datasetId, source, iouThreshold, confThreshold],
    queryFn: () =>
      apiFetch<EvaluationResponse>(
        `/datasets/${datasetId}/evaluation?source=${encodeURIComponent(source)}&iou_threshold=${iouThreshold}&conf_threshold=${confThreshold}`,
      ),
    staleTime: 10 * 60 * 1000, // 10 min -- each (source, iou, conf) combo cached
  });
}
