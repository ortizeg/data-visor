"use client";

/**
 * Vertical bar chart showing sample counts per dataset split.
 *
 * Renders train/val/test/unassigned split distribution.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import type { SplitBreakdown as SplitBreakdownType } from "@/types/statistics";

interface SplitBreakdownProps {
  data: SplitBreakdownType[];
}

export function SplitBreakdown({ data }: SplitBreakdownProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">
        No splits defined
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ left: 10, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="split_name" tick={{ fontSize: 12 }} />
        <YAxis />
        <Tooltip />
        <Bar
          dataKey="count"
          name="Samples"
          fill="#8b5cf6"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
