/**
 * Types for the evaluation API response.
 *
 * Mirrors the backend models in app/models/evaluation.py.
 */

export interface PRPoint {
  recall: number;
  precision: number;
  confidence: number;
}

export interface PRCurve {
  class_name: string;
  points: PRPoint[];
  ap: number;
}

export interface APMetrics {
  map50: number;
  map75: number;
  map50_95: number;
}

export interface PerClassMetrics {
  class_name: string;
  ap50: number;
  ap75: number;
  ap50_95: number;
  precision: number;
  recall: number;
}

export interface EvaluationResponse {
  pr_curves: PRCurve[];
  ap_metrics: APMetrics;
  per_class_metrics: PerClassMetrics[];
  confusion_matrix: number[][];
  confusion_matrix_labels: string[];
  iou_threshold: number;
  conf_threshold: number;
}
