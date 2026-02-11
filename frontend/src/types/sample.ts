/**
 * TypeScript types matching backend SampleResponse and PaginatedSamples
 * models from app/models/sample.py.
 */

export interface Sample {
  id: string;
  dataset_id: string;
  file_name: string;
  width: number;
  height: number;
  thumbnail_path: string | null;
  split: string | null;
}

export interface PaginatedSamples {
  items: Sample[];
  total: number;
  offset: number;
  limit: number;
}
