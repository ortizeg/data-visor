"use client";

/**
 * Horizontal bar chart showing per-class annotation counts.
 *
 * Displays GT and prediction counts side by side for each category,
 * sorted by GT count descending.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import type { ClassDistribution as ClassDistributionType } from "@/types/statistics";

interface ClassDistributionProps {
  data: ClassDistributionType[];
}

export function ClassDistribution({ data }: ClassDistributionProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400 py-8 text-center">
        No annotations yet
      </p>
    );
  }

  const chartHeight = Math.max(300, data.length * 35);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleBarClick = (data: any) => {
    const categoryName = data?.category_name ?? data?.payload?.category_name;
    if (!categoryName) return;
    useFilterStore.getState().setCategory(categoryName);
    useUIStore.getState().setActiveTab("grid");
  };

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart layout="vertical" data={data} margin={{ left: 20, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" />
        <YAxis
          type="category"
          dataKey="category_name"
          width={120}
          tick={{ fontSize: 12 }}
        />
        <Tooltip />
        <Legend />
        <Bar
          dataKey="gt_count"
          name="Ground Truth"
          fill="#3b82f6"
          radius={[0, 2, 2, 0]}
          className="cursor-pointer"
          onClick={handleBarClick}
        />
        <Bar
          dataKey="pred_count"
          name="Predictions"
          fill="#f59e0b"
          radius={[0, 2, 2, 0]}
          className="cursor-pointer"
          onClick={handleBarClick}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
