"use client";

/**
 * Summary stat cards showing aggregate dataset counts.
 *
 * Renders a 4-column grid of cards for total images, GT annotations,
 * predictions, and categories.
 */

import type { SummaryStats } from "@/types/statistics";

interface AnnotationSummaryProps {
  summary: SummaryStats;
  datasetType?: string;
}

const DETECTION_CARDS: { key: keyof SummaryStats; label: string }[] = [
  { key: "total_images", label: "Total Images" },
  { key: "gt_annotations", label: "GT Annotations" },
  { key: "pred_annotations", label: "Predictions" },
  { key: "total_categories", label: "Categories" },
];

const CLASSIFICATION_CARDS: { key: keyof SummaryStats; label: string }[] = [
  { key: "total_images", label: "Total Images" },
  { key: "gt_annotations", label: "Labeled Images" },
  { key: "pred_annotations", label: "Predictions" },
  { key: "total_categories", label: "Classes" },
];

export function AnnotationSummary({ summary, datasetType }: AnnotationSummaryProps) {
  const CARDS = datasetType === "classification" ? CLASSIFICATION_CARDS : DETECTION_CARDS;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 bg-white dark:bg-zinc-900"
        >
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {summary[card.key].toLocaleString()}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {card.label}
          </p>
        </div>
      ))}
    </div>
  );
}
