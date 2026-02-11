/**
 * TanStack Query hook for fetching dataset statistics.
 *
 * Returns class distribution, split breakdown, and summary stats
 * computed server-side by DuckDB GROUP BY queries.
 */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { DatasetStatistics } from "@/types/statistics";

export function useStatistics(datasetId: string) {
  return useQuery({
    queryKey: ["statistics", datasetId],
    queryFn: () =>
      apiFetch<DatasetStatistics>(`/datasets/${datasetId}/statistics`),
    staleTime: 5 * 60 * 1000, // 5 min -- invalidated after prediction import
  });
}
