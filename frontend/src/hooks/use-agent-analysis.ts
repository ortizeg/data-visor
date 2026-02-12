/**
 * TanStack Query mutation hook for triggering AI agent error analysis.
 *
 * Uses useMutation (not useQuery) because analysis is on-demand and
 * long-running (10-30s). The user explicitly triggers it via a button.
 *
 * POST /datasets/{datasetId}/analyze with JSON body for source, IoU,
 * and confidence thresholds.
 */

import { useMutation } from "@tanstack/react-query";

import { apiPost } from "@/lib/api";
import type { AnalysisReport, AnalysisRequest } from "@/types/agent";

interface UseAgentAnalysisParams {
  datasetId: string;
  source?: string;
  iouThreshold?: number;
  confThreshold?: number;
}

export function useAgentAnalysis() {
  return useMutation({
    mutationFn: ({
      datasetId,
      source = "prediction",
      iouThreshold = 0.5,
      confThreshold = 0.25,
    }: UseAgentAnalysisParams) =>
      apiPost<AnalysisReport>(`/datasets/${datasetId}/analyze`, {
        source,
        iou_threshold: iouThreshold,
        conf_threshold: confThreshold,
      } satisfies AnalysisRequest),
  });
}
