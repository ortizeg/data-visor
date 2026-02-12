/**
 * TypeScript types matching backend VLM Pydantic models
 * from app/services/vlm_service.py.
 *
 * These types mirror the JSON shapes returned by the VLM auto-tag API
 * (POST /auto-tag response, SSE progress events).
 */

/** Progress update from SSE stream during auto-tagging. */
export interface TaggingProgress {
  status: "idle" | "running" | "complete" | "error";
  processed: number;
  total: number;
  message: string;
}
