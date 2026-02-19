"use client";

/**
 * Collapsible class filter with checkboxes for selecting which categories
 * to include in statistics computation.
 *
 * Provides select-all / deselect-all controls and displays the active
 * filter count as a badge when collapsed.
 */

import { useState } from "react";

interface ClassFilterProps {
  /** All available category names (from class distribution data). */
  categories: string[];
  /** Set of category names currently excluded from statistics. */
  excludedClasses: Set<string>;
  /** Toggle a single category's inclusion. */
  onToggle: (category: string) => void;
  /** Include all categories. */
  onSelectAll: () => void;
  /** Exclude all categories. */
  onDeselectAll: () => void;
}

export function ClassFilter({
  categories,
  excludedClasses,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: ClassFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const includedCount = categories.length - excludedClasses.size;
  const isFiltered = excludedClasses.size > 0;

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-zinc-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Class Filter
          </span>
          {isFiltered && (
            <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              {includedCount}/{categories.length}
            </span>
          )}
        </div>
        {isFiltered && !isExpanded && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {excludedClasses.size} class{excludedClasses.size !== 1 ? "es" : ""} hidden
          </span>
        )}
      </button>

      {/* Expandable body */}
      {isExpanded && (
        <div className="px-4 pb-3 border-t border-zinc-100 dark:border-zinc-800">
          {/* Bulk actions */}
          <div className="flex items-center gap-3 py-2">
            <button
              onClick={onSelectAll}
              disabled={excludedClasses.size === 0}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-default"
            >
              Select all
            </button>
            <span className="text-zinc-300 dark:text-zinc-600">|</span>
            <button
              onClick={onDeselectAll}
              disabled={excludedClasses.size === categories.length}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-default"
            >
              Deselect all
            </button>
          </div>

          {/* Checkbox list */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1 max-h-48 overflow-y-auto">
            {categories.map((name) => (
              <label
                key={name}
                className="flex items-center gap-2 py-0.5 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  checked={!excludedClasses.has(name)}
                  onChange={() => onToggle(name)}
                  className="rounded border-zinc-300 dark:border-zinc-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 h-3.5 w-3.5"
                />
                <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate group-hover:text-zinc-900 dark:group-hover:text-zinc-200">
                  {name}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
