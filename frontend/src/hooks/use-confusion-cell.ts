/**
 * Imperative fetch for confusion matrix cell samples.
 *
 * Not a React hook -- this is a plain async function called from
 * event handlers when a user clicks a confusion matrix cell.
 */

import { apiFetch } from "@/lib/api";

export interface ConfusionCellSamplesResponse {
  actual_class: string;
  predicted_class: string;
  sample_ids: string[];
  count: number;
}

/**
 * Fetch sample IDs that contributed to a specific confusion matrix cell.
 *
 * @param datasetId - The dataset to query
 * @param actualClass - The ground-truth class (row label), or "background" for FPs
 * @param predictedClass - The predicted class (column label), or "background" for FNs
 * @param source - Prediction source (e.g. "prediction")
 * @param iouThreshold - IoU threshold used for matching
 * @param confThreshold - Confidence threshold used for filtering predictions
 * @param split - Optional dataset split filter
 * @returns Array of sample IDs matching the cell
 */
export async function fetchConfusionCellSamples(
  datasetId: string,
  actualClass: string,
  predictedClass: string,
  source: string,
  iouThreshold: number,
  confThreshold: number,
  split: string | null,
): Promise<string[]> {
  const params = new URLSearchParams({
    actual_class: actualClass,
    predicted_class: predictedClass,
    source,
    iou_threshold: iouThreshold.toString(),
    conf_threshold: confThreshold.toString(),
  });
  if (split) {
    params.set("split", split);
  }

  const data = await apiFetch<ConfusionCellSamplesResponse>(
    `/datasets/${datasetId}/confusion-cell-samples?${params.toString()}`,
  );
  return data.sample_ids;
}
