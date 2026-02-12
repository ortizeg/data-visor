"use client";

/**
 * Precision-Recall curve chart using Recharts.
 *
 * Shows a bold "all" line and thin per-class lines.
 * A red dot marks the operating point closest to the current confidence threshold.
 * Custom tooltip displays precision, recall, and confidence values.
 */

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";

import type { PRCurve } from "@/types/evaluation";
import { getClassColor } from "@/lib/color-hash";

interface PRCurveChartProps {
  curves: PRCurve[];
  confThreshold: number;
}

interface ChartPoint {
  recall: number;
  confidence: number;
  [className: string]: number;
}

/** Raw PR point lookup: for a given confidence, find each class's actual P/R. */
function findPointAtConf(
  curves: PRCurve[],
  confidence: number,
): Record<string, { precision: number; recall: number }> {
  const result: Record<string, { precision: number; recall: number }> = {};
  for (const curve of curves) {
    if (curve.points.length === 0) continue;
    let closest = curve.points[0];
    let minDist = Math.abs(closest.confidence - confidence);
    for (const pt of curve.points) {
      const dist = Math.abs(pt.confidence - confidence);
      if (dist < minDist) {
        minDist = dist;
        closest = pt;
      }
    }
    result[curve.class_name] = {
      precision: closest.precision,
      recall: closest.recall,
    };
  }
  return result;
}

export function PRCurveChart({ curves, confThreshold }: PRCurveChartProps) {
  // Merge all curves onto a 101-point recall grid with interpolation
  const { chartData, classNames } = useMemo(() => {
    const recallGrid = Array.from({ length: 101 }, (_, i) => i / 100);
    const names: string[] = [];

    // Use the "all" curve (or first curve) to map recall → confidence
    const refCurve = curves.find((c) => c.class_name === "all") ?? curves[0];

    const data: ChartPoint[] = recallGrid.map((r) => ({
      recall: r,
      confidence: 0,
    }));

    for (const curve of curves) {
      names.push(curve.class_name);
      const pts = curve.points;
      if (pts.length === 0) {
        for (const d of data) d[curve.class_name] = 0;
        continue;
      }

      // Interpolate: for each recall grid point, find the max precision
      // where recall >= grid point (COCO-style monotonic envelope)
      for (const d of data) {
        const r = d.recall;
        let maxP = 0;
        for (const pt of pts) {
          if (pt.recall >= r && pt.precision > maxP) {
            maxP = pt.precision;
          }
        }
        d[curve.class_name] = maxP;
      }
    }

    // Map each recall grid point to nearest confidence from reference curve
    if (refCurve && refCurve.points.length > 0) {
      for (const d of data) {
        let closest = refCurve.points[0];
        let minDist = Math.abs(closest.recall - d.recall);
        for (const pt of refCurve.points) {
          const dist = Math.abs(pt.recall - d.recall);
          if (dist < minDist) {
            minDist = dist;
            closest = pt;
          }
        }
        d.confidence = closest.confidence;
      }
    }

    return { chartData: data, classNames: names };
  }, [curves]);

  // Find operating point for the "all" curve
  const operatingPoint = useMemo(() => {
    const allCurve = curves.find((c) => c.class_name === "all");
    if (!allCurve || allCurve.points.length === 0) return null;

    let closest = allCurve.points[0];
    let minDist = Math.abs(closest.confidence - confThreshold);
    for (const pt of allCurve.points) {
      const dist = Math.abs(pt.confidence - confThreshold);
      if (dist < minDist) {
        minDist = dist;
        closest = pt;
      }
    }
    return closest;
  }, [curves, confThreshold]);

  if (curves.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
          No PR curve data available
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
        Precision-Recall Curve
      </h3>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="recall"
            type="number"
            domain={[0, 1]}
            label={{ value: "Recall", position: "insideBottom", offset: -2, fontSize: 12 }}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type="number"
            domain={[0, 1]}
            label={{ value: "Precision", angle: -90, position: "insideLeft", fontSize: 12 }}
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]?.payload as ChartPoint | undefined;
              if (!point) return null;
              const conf = point.confidence;

              // Look up each class's actual P/R from raw curve at this confidence
              const rawPoints = findPointAtConf(curves, conf);

              // Build entries with real per-class P/R and sort
              const entries = payload
                .map((entry) => {
                  const name = entry.name ?? "";
                  const raw = rawPoints[name];
                  return {
                    name,
                    color: entry.color,
                    precision: raw?.precision ?? 0,
                    recall: raw?.recall ?? 0,
                  };
                })
                .sort((a, b) => {
                  if (a.name === "all") return -1;
                  if (b.name === "all") return 1;
                  return b.precision - a.precision;
                });

              return (
                <div
                  style={{
                    backgroundColor: "rgba(24,24,27,0.95)",
                    border: "1px solid #3f3f46",
                    borderRadius: 6,
                    fontSize: 12,
                    padding: "8px 10px",
                  }}
                >
                  <div className="text-zinc-300 font-medium pb-1 mb-1 border-b border-zinc-700">
                    Conf: {conf.toFixed(3)}
                  </div>
                  {entries.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2 py-0.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-zinc-300 font-medium">{entry.name}</span>
                      <span className="text-zinc-400 ml-auto pl-3">
                        P {entry.precision.toFixed(3)} / R {entry.recall.toFixed(3)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />

          {classNames.map((name) => (
            <Line
              key={name}
              dataKey={name}
              name={name}
              stroke={name === "all" ? "#3b82f6" : getClassColor(name)}
              strokeWidth={name === "all" ? 2.5 : 1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}

          {operatingPoint && (
            <ReferenceDot
              x={operatingPoint.recall}
              y={operatingPoint.precision}
              r={5}
              fill="#ef4444"
              stroke="#fff"
              strokeWidth={2}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
