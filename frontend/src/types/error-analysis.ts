/**
 * Types for the error analysis API response.
 *
 * Mirrors the backend models in app/models/error_analysis.py.
 */

export interface ErrorSample {
  sample_id: string;
  error_type: string;
  category_name: string;
  confidence: number | null;
}

export interface PerClassErrors {
  class_name: string;
  tp: number;
  hard_fp: number;
  label_error: number;
  fn: number;
}

export interface ErrorSummary {
  true_positives: number;
  hard_false_positives: number;
  label_errors: number;
  false_negatives: number;
}

export interface ErrorAnalysisResponse {
  summary: ErrorSummary;
  per_class: PerClassErrors[];
  samples_by_type: Record<string, ErrorSample[]>;
}
