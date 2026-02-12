"use client";

/**
 * Per-class AP breakdown table.
 *
 * Shows AP@50, AP@75, AP@50:95, Precision, and Recall per class.
 * Sorted by AP@50 descending. Values formatted to 3 decimal places.
 */

import { useMemo } from "react";

import type { PerClassMetrics } from "@/types/evaluation";

interface PerClassTableProps {
  metrics: PerClassMetrics[];
}

export function PerClassTable({ metrics }: PerClassTableProps) {
  const sorted = useMemo(
    () => [...metrics].sort((a, b) => b.ap50 - a.ap50),
    [metrics],
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
          No per-class metrics available
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
        Per-Class AP
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="text-left py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                Class
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                AP@50
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                AP@75
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                AP@50:95
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                Precision
              </th>
              <th className="text-right py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400">
                Recall
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr
                key={m.class_name}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="py-2 px-3 text-zinc-900 dark:text-zinc-100 font-medium">
                  {m.class_name}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.ap50.toFixed(3)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.ap75.toFixed(3)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.ap50_95.toFixed(3)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.precision.toFixed(3)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-zinc-700 dark:text-zinc-300">
                  {m.recall.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
