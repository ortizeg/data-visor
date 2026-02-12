/**
 * Types for the AI agent analysis API.
 *
 * Mirrors the backend models in app/models/agent.py.
 */

export interface PatternInsight {
  pattern: string;
  evidence: string;
  severity: "high" | "medium" | "low";
  affected_classes: string[];
}

export interface Recommendation {
  action: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  category:
    | "data_collection"
    | "augmentation"
    | "labeling"
    | "architecture"
    | "hyperparameter";
}

export interface AnalysisReport {
  patterns: PatternInsight[];
  recommendations: Recommendation[];
  summary: string;
}

export interface AnalysisRequest {
  source?: string;
  iou_threshold?: number;
  conf_threshold?: number;
}
