"use client";

/**
 * Metric summary cards showing mAP@50, mAP@75, and mAP@50:95.
 *
 * Reuses card styling from annotation-summary.tsx.
 * Values formatted as percentages to 1 decimal place.
 */

import type { APMetrics } from "@/types/evaluation";

interface MetricsCardsProps {
  metrics: APMetrics;
}

const CARDS: { key: keyof APMetrics; label: string }[] = [
  { key: "map50", label: "mAP@50" },
  { key: "map75", label: "mAP@75" },
  { key: "map50_95", label: "mAP@50:95" },
];

export function MetricsCards({ metrics }: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 bg-white dark:bg-zinc-900"
        >
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {(metrics[card.key] * 100).toFixed(1)}%
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {card.label}
          </p>
        </div>
      ))}
    </div>
  );
}
