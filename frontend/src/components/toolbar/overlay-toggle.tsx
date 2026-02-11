"use client";

/**
 * Segmented control for switching between GT, Predictions, and Both
 * annotation overlay modes. Only renders when the dataset has predictions.
 */

import { useUIStore, type OverlayMode } from "@/stores/ui-store";

const OPTIONS: { value: OverlayMode; label: string }[] = [
  { value: "ground_truth", label: "GT" },
  { value: "prediction", label: "Pred" },
  { value: "both", label: "Both" },
];

interface OverlayToggleProps {
  /** Whether the dataset has imported predictions. Hides toggle if false. */
  hasPredictions: boolean;
}

export function OverlayToggle({ hasPredictions }: OverlayToggleProps) {
  const overlayMode = useUIStore((s) => s.overlayMode);
  const setOverlayMode = useUIStore((s) => s.setOverlayMode);

  if (!hasPredictions) return null;

  return (
    <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden dark:border-zinc-700">
      {OPTIONS.map((opt) => {
        const isActive = overlayMode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setOverlayMode(opt.value)}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
