/**
 * Types for the similarity search API response.
 *
 * Mirrors the backend models in app/models/similarity.py.
 */

export interface SimilarResult {
  sample_id: string;
  score: number;
  file_name: string | null;
  thumbnail_path: string | null;
}

export interface SimilarityResponse {
  results: SimilarResult[];
  query_sample_id: string;
}
