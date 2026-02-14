"use client";

/**
 * Annotation triage filter buttons for the detail modal.
 *
 * Renders a row of All / TP / FP / FN / Mistake buttons that filter
 * which triage-classified annotation boxes are visible in the overlay.
 * Clicking the already-active filter clears it (shows all).
 */

import { ANNOTATION_TRIAGE_COLORS } from "@/types/annotation-triage";

const FILTER_OPTIONS = [
  { label: "All", value: null },
  { label: "TP", value: "tp" },
  { label: "FP", value: "fp" },
  { label: "FN", value: "fn" },
  { label: "Mistake", value: "mistake" },
] as const;

interface TriageFilterButtonsProps {
  activeFilter: string | null;
  onFilterChange: (label: string | null) => void;
}

export function TriageFilterButtons({
  activeFilter,
  onFilterChange,
}: TriageFilterButtonsProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-zinc-500">Filter:</span>
      <div className="flex items-center gap-1">
        {FILTER_OPTIONS.map((opt) => {
          const isActive =
            opt.value === null ? activeFilter === null : activeFilter === opt.value;
          const color = opt.value ? ANNOTATION_TRIAGE_COLORS[opt.value] : undefined;
          return (
            <button
              key={opt.label}
              onClick={() =>
                onFilterChange(
                  opt.value === null
                    ? null
                    : activeFilter === opt.value
                      ? null
                      : opt.value,
                )
              }
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "text-white"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
              style={
                isActive && color
                  ? { backgroundColor: color }
                  : isActive
                    ? { backgroundColor: "#71717a" }
                    : undefined
              }
            >
              {color && (
                <span
                  className={isActive ? "opacity-70" : ""}
                  style={{ color }}
                >
                  ●
                </span>
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
