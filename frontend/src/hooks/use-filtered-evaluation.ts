/**
 * Derives a class-filtered EvaluationResponse from raw server data.
 *
 * Filters PR curves, per-class metrics, and confusion matrix by excluded
 * classes, then recomputes aggregate mAP and a synthetic "all" PR curve
 * from the included subset.
 *
 * Results are cached in a Map keyed by the serialized excluded-class set,
 * so revisiting the same filter combination is O(1).
 */

import { useRef, useMemo } from "react";

import type {
  EvaluationResponse,
  APMetrics,
  PRCurve,
} from "@/types/evaluation";

/** Stable cache key from a Set of excluded class names. */
function cacheKey(excluded: Set<string>): string {
  if (excluded.size === 0) return "";
  return [...excluded].sort().join("\0");
}

/** Average per-class AP values into aggregate mAP metrics. */
function recomputeMapMetrics(
  perClass: EvaluationResponse["per_class_metrics"],
): APMetrics {
  if (perClass.length === 0) {
    return { map50: 0, map75: 0, map50_95: 0 };
  }
  const n = perClass.length;
  return {
    map50: perClass.reduce((s, m) => s + m.ap50, 0) / n,
    map75: perClass.reduce((s, m) => s + m.ap75, 0) / n,
    map50_95: perClass.reduce((s, m) => s + m.ap50_95, 0) / n,
  };
}

/**
 * Synthesize an "all" PR curve by averaging precision across included
 * per-class curves at each of the 101 recall grid points (COCO convention).
 */
function synthesizeAllCurve(perClassCurves: PRCurve[]): PRCurve {
  if (perClassCurves.length === 0) {
    return { class_name: "all", points: [], ap: 0 };
  }

  const GRID = 101;
  const points: PRCurve["points"] = [];

  for (let i = 0; i < GRID; i++) {
    const recall = i / (GRID - 1);
    let precisionSum = 0;
    let confSum = 0;
    let count = 0;

    for (const curve of perClassCurves) {
      if (curve.points.length === 0) continue;

      // Find max precision at recall >= grid point (monotonic envelope)
      let maxP = 0;
      let bestConf = 0;
      for (const pt of curve.points) {
        if (pt.recall >= recall && pt.precision > maxP) {
          maxP = pt.precision;
          bestConf = pt.confidence;
        }
      }
      precisionSum += maxP;
      confSum += bestConf;
      count++;
    }

    if (count > 0) {
      points.push({
        recall,
        precision: precisionSum / count,
        confidence: confSum / count,
      });
    }
  }

  // AP = mean precision across recall grid (COCO 101-point interpolation)
  const ap =
    points.length > 0
      ? points.reduce((s, p) => s + p.precision, 0) / points.length
      : 0;

  return { class_name: "all", points, ap };
}

/**
 * Filter an EvaluationResponse by excluding certain classes.
 *
 * Removes excluded classes from PR curves, per-class metrics, and confusion
 * matrix, then recomputes the "all" PR curve and mAP from the remaining set.
 */
function filterEvaluation(
  data: EvaluationResponse,
  excluded: Set<string>,
): EvaluationResponse {
  // Filter per-class data
  const filteredPerClass = data.per_class_metrics.filter(
    (m) => !excluded.has(m.class_name),
  );
  const filteredCurves = data.pr_curves.filter(
    (c) => c.class_name !== "all" && !excluded.has(c.class_name),
  );

  // Recompute aggregate metrics from filtered subset
  const apMetrics = recomputeMapMetrics(filteredPerClass);
  const allCurve = synthesizeAllCurve(filteredCurves);

  // Filter confusion matrix: keep only included class indices
  const includedIndices: number[] = [];
  const includedLabels: string[] = [];
  for (let i = 0; i < data.confusion_matrix_labels.length; i++) {
    if (!excluded.has(data.confusion_matrix_labels[i])) {
      includedIndices.push(i);
      includedLabels.push(data.confusion_matrix_labels[i]);
    }
  }
  const filteredMatrix = includedIndices.map((ri) =>
    includedIndices.map((ci) => data.confusion_matrix[ri][ci]),
  );

  return {
    ...data,
    pr_curves: [allCurve, ...filteredCurves],
    ap_metrics: apMetrics,
    per_class_metrics: filteredPerClass,
    confusion_matrix: filteredMatrix,
    confusion_matrix_labels: includedLabels,
  };
}

/**
 * Hook that returns a class-filtered EvaluationResponse with cross-combination
 * caching. When `excludedClasses` is empty, returns the original data as-is.
 *
 * The cache is keyed by the serialized excluded set and scoped to the
 * lifetime of the raw `data` reference (cache resets when server data changes).
 */
export function useFilteredEvaluation(
  data: EvaluationResponse | undefined,
  excludedClasses: Set<string>,
): EvaluationResponse | undefined {
  const cacheRef = useRef<{
    sourceData: EvaluationResponse | undefined;
    results: Map<string, EvaluationResponse>;
  }>({ sourceData: undefined, results: new Map() });

  return useMemo(() => {
    if (!data) return undefined;
    if (excludedClasses.size === 0) return data;

    // Reset cache when upstream data changes
    if (cacheRef.current.sourceData !== data) {
      cacheRef.current = { sourceData: data, results: new Map() };
    }

    const key = cacheKey(excludedClasses);
    const cached = cacheRef.current.results.get(key);
    if (cached) return cached;

    const result = filterEvaluation(data, excludedClasses);
    cacheRef.current.results.set(key, result);
    return result;
  }, [data, excludedClasses]);
}
