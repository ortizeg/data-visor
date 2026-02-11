/**
 * TypeScript types matching backend AnnotationResponse
 * and BatchAnnotationsResponse models from app/models/annotation.py.
 */

export interface Annotation {
  id: string;
  dataset_id: string;
  sample_id: string;
  category_name: string;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  area: number;
  is_crowd: boolean;
  source: string;
  confidence: number | null;
}

/**
 * Response from the batch annotations endpoint.
 * Maps sample_id to its list of annotations.
 */
export interface BatchAnnotationsResponse {
  annotations: Record<string, Annotation[]>;
}
