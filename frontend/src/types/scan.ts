/**
 * TypeScript types matching backend scan/import models
 * from app/models/scan.py.
 */

export interface DetectedSplit {
  name: string;
  annotation_path: string;
  image_dir: string;
  image_count: number;
  annotation_file_size: number;
}

export interface ScanResult {
  root_path: string;
  dataset_name: string;
  format: string;
  splits: DetectedSplit[];
  warnings: string[];
}

export interface ImportSplit {
  name: string;
  annotation_path: string;
  image_dir: string;
}

export interface ImportRequest {
  dataset_name: string;
  splits: ImportSplit[];
}

export interface IngestProgress {
  stage: string;
  current: number;
  total: number | null;
  message: string;
  split: string | null;
}
