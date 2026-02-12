/**
 * Multi-select collapsible Labels section for toggling annotation sources.
 *
 * Follows the same collapsible pattern as FilterSection but supports
 * multi-select checkboxes. Each source gets a colored dot via getSourceColor.
 */

"use client";

import { useState } from "react";
import { getSourceColor } from "@/lib/color-hash";
import { useUIStore } from "@/stores/ui-store";
import type { FacetItem } from "@/types/filter";

interface LabelsSectionProps {
  items: FacetItem[];
}

export function LabelsSection({ items }: LabelsSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const activeSources = useUIStore((s) => s.activeSources);
  const toggleSource = useUIStore((s) => s.toggleSource);

  const allSourceNames = items.map((item) => item.name);

  function isChecked(source: string): boolean {
    if (activeSources === null) return true; // null = show all
    return activeSources.includes(source);
  }

  if (items.length === 0) return null;

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-1 py-2 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Labels
        </span>
        <svg
          className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="max-h-48 overflow-y-auto pb-2">
          {items.map((item) => {
            const checked = isChecked(item.name);
            const color = getSourceColor(item.name);
            return (
              <button
                key={item.name}
                onClick={() => toggleSource(item.name, allSourceNames)}
                className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm transition-colors ${
                  checked
                    ? "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    : "text-zinc-400 hover:bg-zinc-50 dark:text-zinc-500 dark:hover:bg-zinc-800"
                }`}
              >
                {/* Checkbox indicator */}
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                    checked
                      ? "border-blue-500 bg-blue-500"
                      : "border-zinc-300 dark:border-zinc-600"
                  }`}
                >
                  {checked && (
                    <svg
                      className="h-2.5 w-2.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </span>

                {/* Colored dot */}
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />

                {/* Label */}
                <span className="min-w-0 flex-1 truncate">{item.name}</span>

                {/* Count */}
                <span className="shrink-0 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                  {item.count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
