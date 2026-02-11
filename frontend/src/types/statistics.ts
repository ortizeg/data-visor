/**
 * Types for the dataset statistics API response.
 *
 * Mirrors the backend models in app/models/statistics.py.
 */

export interface ClassDistribution {
  category_name: string;
  gt_count: number;
  pred_count: number;
}

export interface SplitBreakdown {
  split_name: string;
  count: number;
}

export interface SummaryStats {
  total_images: number;
  gt_annotations: number;
  pred_annotations: number;
  total_categories: number;
}

export interface DatasetStatistics {
  class_distribution: ClassDistribution[];
  split_breakdown: SplitBreakdown[];
  summary: SummaryStats;
}
