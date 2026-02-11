/**
 * Collapsible filter section with inline checkbox items and counts.
 *
 * Inspired by FiftyOne/Voxel51's sidebar pattern: expandable sections
 * with checkbox lists instead of dropdown <select> menus.
 * Single-select: clicking an already-selected item deselects it.
 */

"use client";

import { useState } from "react";
import type { FacetItem } from "@/types/filter";

interface FilterSectionProps {
  title: string;
  items: FacetItem[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  defaultOpen?: boolean;
}

export function FilterSection({
  title,
  items,
  selected,
  onSelect,
  defaultOpen = true,
}: FilterSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-1 py-2 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {title}
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
          {items.length === 0 ? (
            <p className="px-1 py-1 text-xs text-zinc-400 dark:text-zinc-500">
              No values
            </p>
          ) : (
            items.map((item) => {
              const isSelected = selected === item.name;
              return (
                <button
                  key={item.name}
                  onClick={() => onSelect(isSelected ? null : item.name)}
                  className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {/* Checkbox indicator */}
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                      isSelected
                        ? "border-blue-500 bg-blue-500"
                        : "border-zinc-300 dark:border-zinc-600"
                    }`}
                  >
                    {isSelected && (
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

                  {/* Label */}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>

                  {/* Count */}
                  <span
                    className={`shrink-0 text-xs tabular-nums ${
                      isSelected
                        ? "text-blue-500 dark:text-blue-400"
                        : "text-zinc-400 dark:text-zinc-500"
                    }`}
                  >
                    {item.count.toLocaleString()}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
