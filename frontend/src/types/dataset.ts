/**
 * TypeScript types matching backend DatasetResponse and DatasetListResponse
 * models from app/models/dataset.py.
 */

export interface Dataset {
  id: string;
  name: string;
  format: string;
  source_path: string;
  image_dir: string;
  image_count: number;
  annotation_count: number;
  category_count: number;
  prediction_count: number;
  created_at: string;
}

export interface DatasetList {
  datasets: Dataset[];
}
