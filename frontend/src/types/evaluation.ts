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
  evaluation_type?: "detection";
  pr_curves: PRCurve[];
  ap_metrics: APMetrics;
  per_class_metrics: PerClassMetrics[];
  confusion_matrix: number[][];
  confusion_matrix_labels: string[];
  iou_threshold: number;
  conf_threshold: number;
}

export interface ClassificationPerClassMetrics {
  class_name: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface ClassificationEvaluationResponse {
  evaluation_type: "classification";
  accuracy: number;
  macro_f1: number;
  weighted_f1: number;
  per_class_metrics: ClassificationPerClassMetrics[];
  confusion_matrix: number[][];
  confusion_matrix_labels: string[];
  conf_threshold: number;
}

export type AnyEvaluationResponse = EvaluationResponse | ClassificationEvaluationResponse;
