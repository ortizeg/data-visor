/**
 * TanStack Query hook for fetching dataset statistics.
 *
 * Returns class distribution, split breakdown, and summary stats
 * computed server-side by DuckDB GROUP BY queries.
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { DatasetStatistics } from "@/types/statistics";

export function useStatistics(datasetId: string, split: string | null = null) {
  const params = split ? `?split=${encodeURIComponent(split)}` : "";
  return useQuery({
    queryKey: ["statistics", datasetId, split],
    queryFn: () =>
      apiFetch<DatasetStatistics>(`/datasets/${datasetId}/statistics${params}`),
    staleTime: 5 * 60 * 1000, // 5 min -- invalidated after prediction import
  });
}
