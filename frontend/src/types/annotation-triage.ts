/**
 * Types and constants for per-annotation triage.
 *
 * - AnnotationTriageResult: classification for a single annotation (auto or override)
 * - AnnotationTriageResponse: list wrapper from GET endpoint
 * - ANNOTATION_TRIAGE_COLORS: color mapping for triage labels
 * - TRIAGE_CYCLE: click-to-advance label cycle
 * - nextTriageLabel: helper to get next label in cycle
 */

export interface AnnotationTriageResult {
  annotation_id: string;
  auto_label: string; // "tp" | "fp" | "fn" | "label_error"
  label: string; // final label after override merge
  matched_id: string | null;
  iou: number | null;
  is_override: boolean;
}

export interface AnnotationTriageResponse {
  items: AnnotationTriageResult[];
}

/** Color mapping for annotation triage labels (matches research spec). */
export const ANNOTATION_TRIAGE_COLORS: Record<string, string> = {
  tp: "#22c55e", // green-500
  fp: "#ef4444", // red-500
  fn: "#f97316", // orange-500
  label_error: "#eab308", // yellow-500
  mistake: "#a855f7", // purple-500
};

/** Cycle order for click-to-advance triage labels. */
export const TRIAGE_CYCLE = ["tp", "fp", "fn", "mistake"] as const;

/** Get the next triage label in the cycle. */
export function nextTriageLabel(current: string): string {
  const idx = TRIAGE_CYCLE.indexOf(current as (typeof TRIAGE_CYCLE)[number]);
  return TRIAGE_CYCLE[(idx + 1) % TRIAGE_CYCLE.length];
}
