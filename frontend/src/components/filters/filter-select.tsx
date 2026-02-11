/**
 * Reusable single-select dropdown for category/split filters.
 *
 * Renders a <select> element with an "All" default option that maps to null.
 * Options are populated from the facets endpoint via the parent component.
 */

"use client";

interface FilterSelectProps {
  label: string;
  options: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}

export function FilterSelect({
  label,
  options,
  value,
  onChange,
}: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
