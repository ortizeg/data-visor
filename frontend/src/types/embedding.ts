/**
 * TypeScript types matching backend embedding Pydantic models
 * from app/models/embedding.py.
 *
 * These types mirror the JSON shapes returned by the embeddings API
 * (GET /status, GET /coordinates, SSE progress events).
 */

/** A single 2D point for the scatter-plot visualization. */
export interface EmbeddingPoint {
  sampleId: string;
  x: number;
  y: number;
  fileName: string;
  thumbnailPath: string | null;
  gtLabel?: string | null;
  predLabel?: string | null;
}

/** Current embedding status for a dataset (GET /status). */
export interface EmbeddingStatus {
  dataset_id: string;
  has_embeddings: boolean;
  embedding_count: number;
  model_name: string | null;
  has_reduction: boolean;
}

/** Progress update from SSE streams (generation or reduction). */
export interface EmbeddingProgress {
  status: "idle" | "running" | "fitting" | "complete" | "error";
  processed?: number;
  total?: number;
  message: string;
}
