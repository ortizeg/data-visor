/**
 * Types and constants for error triage operations.
 *
 * - TriageScore: per-sample composite error score from worst-images endpoint
 * - WorstImagesResponse: ranked list wrapper
 * - TRIAGE_OPTIONS: UI-facing tag definitions with color classes
 * - TriageTag: union type of valid triage tag strings
 */

export interface TriageScore {
  sample_id: string;
  error_count: number;
  confidence_spread: number;
  score: number;
}

export interface WorstImagesResponse {
  items: TriageScore[];
}

export const TRIAGE_OPTIONS = [
  { tag: "triage:tp", label: "TP", colorClass: "bg-green-500 hover:bg-green-600", textClass: "text-green-600 dark:text-green-400" },
  { tag: "triage:fp", label: "FP", colorClass: "bg-red-500 hover:bg-red-600", textClass: "text-red-600 dark:text-red-400" },
  { tag: "triage:fn", label: "FN", colorClass: "bg-orange-500 hover:bg-orange-600", textClass: "text-orange-600 dark:text-orange-400" },
  { tag: "triage:mistake", label: "Mistake", colorClass: "bg-amber-500 hover:bg-amber-600", textClass: "text-amber-600 dark:text-amber-400" },
] as const;

export type TriageTag = (typeof TRIAGE_OPTIONS)[number]["tag"];
