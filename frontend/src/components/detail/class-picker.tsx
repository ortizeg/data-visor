"use client";

/**
 * Positioned dropdown for assigning a category to a newly drawn bounding box.
 *
 * Shows a text input for filtering/typing + a scrollable list of available
 * categories. Supports selecting an existing category or typing a new one
 * and pressing Enter. Dismisses on Escape or clicking outside.
 */

import { useState, useRef, useEffect } from "react";
import { getClassColor } from "@/lib/color-hash";

export interface ClassPickerProps {
  /** Available category names from the dataset. */
  categories: string[];
  /** Screen position to render the dropdown near the drawn box. */
  position: { x: number; y: number };
  /** Called when a category is selected or a new one is typed. */
  onSelect: (categoryName: string) => void;
  /** Called when the user cancels (Escape or click outside). */
  onCancel: () => void;
}

/**
 * Render an absolute-positioned category picker dropdown.
 *
 * The input auto-focuses on mount. Typing filters the category list.
 * Pressing Enter with a non-empty value selects it (even if it is a new
 * category not in the list). Escape or clicking outside dismisses.
 */
export function ClassPicker({
  categories,
  position,
  onSelect,
  onCancel,
}: ClassPickerProps) {
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onCancel();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onCancel]);

  const filtered = categories.filter((c) =>
    c.toLowerCase().includes(filter.toLowerCase()),
  );

  const trimmed = filter.trim();
  const isNewCategory =
    trimmed.length > 0 &&
    !categories.some((c) => c.toLowerCase() === trimmed.toLowerCase());

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Enter" && trimmed.length > 0) {
      onSelect(trimmed);
    }
  }

  return (
    <div
      ref={containerRef}
      className="absolute z-50 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
      style={{ left: position.x, top: position.y }}
    >
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search or type new..."
        className="mb-2 w-full rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
      />

      <ul className="max-h-48 overflow-auto">
        {filtered.map((category) => (
          <li key={category}>
            <button
              type="button"
              onClick={() => onSelect(category)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getClassColor(category) }}
              />
              {category}
            </button>
          </li>
        ))}

        {isNewCategory && (
          <li>
            <button
              type="button"
              onClick={() => onSelect(trimmed)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-zinc-700"
            >
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-dashed border-blue-400" />
              Create &quot;{trimmed}&quot;
            </button>
          </li>
        )}

        {filtered.length === 0 && !isNewCategory && (
          <li className="px-2 py-1 text-sm text-zinc-500 dark:text-zinc-400">
            No matching categories
          </li>
        )}
      </ul>
    </div>
  );
}
