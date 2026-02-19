"use client";

/**
 * Confusion matrix heatmap rendered as an HTML table.
 *
 * Diagonal cells use blue intensity (correct predictions).
 * Off-diagonal cells use red intensity (misclassifications).
 * Column headers are rotated for compactness.
 *
 * Features:
 * - Threshold slider to hide low-value off-diagonal cells
 * - Overflow scroll container for large matrices
 * - Compact mode for high-cardinality (>20 classes)
 */

import { useState, useMemo } from "react";

interface ConfusionMatrixProps {
  matrix: number[][];
  labels: string[];
  onCellClick?: (actualClass: string, predictedClass: string) => void;
}

function cellColor(value: number, maxVal: number, isDiagonal: boolean): string {
  if (value === 0 || maxVal === 0) return "transparent";
  const intensity = Math.min(value / maxVal, 1);
  const alpha = 0.15 + intensity * 0.65;
  return isDiagonal
    ? `rgba(59, 130, 246, ${alpha})`  // blue for correct
    : `rgba(239, 68, 68, ${alpha})`;  // red for errors
}

export function ConfusionMatrix({ matrix, labels, onCellClick }: ConfusionMatrixProps) {
  const [threshold, setThreshold] = useState(0.01);

  if (matrix.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
          No confusion matrix data available
        </p>
      </div>
    );
  }

  // Row-normalize: each cell = count / row_sum (fraction of actual class)
  const normalized = matrix.map((row) => {
    const sum = row.reduce((a, b) => a + b, 0);
    return sum > 0 ? row.map((v) => v / sum) : row.map(() => 0);
  });

  // Count off-diagonal cells hidden by threshold (only those with actual values)
  const hiddenCount = useMemo(() => {
    let count = 0;
    for (let ri = 0; ri < normalized.length; ri++) {
      for (let ci = 0; ci < normalized[ri].length; ci++) {
        if (ri !== ci && normalized[ri][ci] > 0 && normalized[ri][ci] < threshold) {
          count++;
        }
      }
    }
    return count;
  }, [normalized, threshold]);

  const isCompact = labels.length > 20;

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
      {/* Header with title and threshold slider */}
      <div className="flex flex-wrap items-center gap-4 mb-3">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Confusion Matrix
          <span className="font-normal text-zinc-400 dark:text-zinc-500 ml-1">
            (row-normalized)
          </span>
        </h3>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Min:
          </label>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-24 accent-blue-500"
          />
          <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400 w-8">
            {(threshold * 100).toFixed(0)}%
          </span>
          {hiddenCount > 0 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {hiddenCount} cells hidden
            </span>
          )}
        </div>
      </div>

      {/* Overflow scroll container */}
      <div className="overflow-auto max-h-[500px]">
        {/* "Predicted" axis title above the grid columns */}
        <div className="flex">
          <div style={{ flexShrink: 0, width: 24 }} />
          <div className="flex-1 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400 pb-1">
            Predicted
          </div>
        </div>

        <div className="flex items-stretch">
          {/* "Actual" axis title left of the grid rows */}
          <div
            className="flex items-center justify-center text-xs font-medium text-zinc-500 dark:text-zinc-400"
            style={{ flexShrink: 0, width: 24 }}
          >
            <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
              Actual
            </span>
          </div>

          {/* The matrix table */}
          <table className="text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                {/* Spacer for row labels column */}
                <th />
                {labels.map((label) => (
                  <th
                    key={label}
                    className="p-1 font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    <div
                      className={`whitespace-nowrap${isCompact ? " max-w-[80px] truncate" : ""}`}
                      style={{
                        writingMode: "vertical-rl",
                        transform: "rotate(180deg)",
                        maxHeight: 80,
                      }}
                    >
                      {label}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalized.map((row, ri) => (
                <tr key={ri}>
                  {/* Row class label */}
                  <td className={`p-1 font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap pr-2 text-right${isCompact ? " max-w-[80px] truncate" : ""}`}>
                    {labels[ri] ?? ""}
                  </td>
                  {/* Data cells */}
                  {row.map((norm, ci) => {
                    const rawValue = matrix[ri][ci];
                    const isDiagonal = ri === ci;
                    const isBelowThreshold = !isDiagonal && norm > 0 && norm < threshold;
                    const isClickable = rawValue > 0 && !!onCellClick && !isBelowThreshold;
                    return (
                      <td
                        key={ci}
                        className={`p-1 text-center ${isCompact ? "min-w-[24px]" : "min-w-[32px]"} border border-zinc-200 dark:border-zinc-700${
                          isClickable
                            ? " cursor-pointer hover:ring-2 hover:ring-blue-500 hover:ring-inset"
                            : ""
                        }`}
                        style={{
                          backgroundColor: isBelowThreshold
                            ? "transparent"
                            : cellColor(norm, 1, isDiagonal),
                        }}
                        onClick={
                          isClickable
                            ? () => onCellClick(labels[ri], labels[ci])
                            : undefined
                        }
                      >
                        {!isBelowThreshold && (
                          <span className={`text-zinc-800 dark:text-zinc-200${isCompact ? " text-[10px]" : ""}`}>
                            {norm > 0 ? norm.toFixed(2) : ""}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
