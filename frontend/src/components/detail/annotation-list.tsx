"use client";

/**
 * Tabular annotation metadata display for the detail modal.
 *
 * Shows each annotation's class name (with colored dot), bounding box
 * coordinates, area, source, and confidence. Compact table with
 * alternating row colors and sticky header.
 */

import { getClassColor } from "@/lib/color-hash";
import type { Annotation } from "@/types/annotation";

interface AnnotationListProps {
  /** Annotations to display in the table. */
  annotations: Annotation[];
}

/**
 * Render a table of annotation metadata for a sample.
 *
 * Each row shows: colored class dot, class name, bbox coordinates,
 * area, source, and confidence (if available).
 */
export function AnnotationList({ annotations }: AnnotationListProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {annotations.length} annotation{annotations.length !== 1 ? "s" : ""}
      </h3>

      <div className="max-h-64 overflow-auto rounded border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
            <tr>
              <th className="px-2 py-1.5 font-medium text-zinc-600 dark:text-zinc-400">
                Class
              </th>
              <th className="px-2 py-1.5 font-medium text-zinc-600 dark:text-zinc-400">
                Bounding Box
              </th>
              <th className="px-2 py-1.5 font-medium text-zinc-600 dark:text-zinc-400 text-right">
                Area
              </th>
              <th className="px-2 py-1.5 font-medium text-zinc-600 dark:text-zinc-400">
                Source
              </th>
              <th className="px-2 py-1.5 font-medium text-zinc-600 dark:text-zinc-400 text-right">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {annotations.map((ann, i) => {
              const color = getClassColor(ann.category_name);
              return (
                <tr
                  key={ann.id}
                  className={
                    i % 2 === 0
                      ? "bg-white dark:bg-zinc-900"
                      : "bg-zinc-50 dark:bg-zinc-850"
                  }
                >
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-zinc-900 dark:text-zinc-100">
                        {ann.category_name}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono text-zinc-600 dark:text-zinc-400">
                    {ann.bbox_x.toFixed(1)}, {ann.bbox_y.toFixed(1)},{" "}
                    {ann.bbox_w.toFixed(1)} x {ann.bbox_h.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {ann.area.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                    {ann.source}
                  </td>
                  <td className="px-2 py-1.5 text-right text-zinc-600 dark:text-zinc-400">
                    {ann.confidence !== null
                      ? `${(ann.confidence * 100).toFixed(1)}%`
                      : "\u2014"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
