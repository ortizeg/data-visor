export interface PredictionImportRequest {
  prediction_path: string;
  format: "coco" | "detection_annotation";
  run_name?: string;
}

export interface PredictionImportResponse {
  dataset_id: string;
  run_name: string;
  prediction_count: number;
  skipped_count: number;
  message: string;
}
