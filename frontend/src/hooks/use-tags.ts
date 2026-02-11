/**
 * TanStack Query mutation hooks for bulk tag operations.
 *
 * - useBulkTag: adds a tag to multiple samples
 * - useBulkUntag: removes a tag from multiple samples
 *
 * Both invalidate ["samples"] and ["filter-facets"] on success so the
 * grid refreshes and new tags appear in the filter dropdown.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiPatch } from "@/lib/api";

interface BulkTagRequest {
  dataset_id: string;
  sample_ids: string[];
  tag: string;
}

interface BulkTagResponse {
  tagged?: number;
  untagged?: number;
}

export function useBulkTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkTagRequest) =>
      apiPatch<BulkTagResponse>("/samples/bulk-tag", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["samples"] });
      queryClient.invalidateQueries({ queryKey: ["filter-facets"] });
    },
  });
}

export function useBulkUntag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkTagRequest) =>
      apiPatch<BulkTagResponse>("/samples/bulk-untag", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["samples"] });
      queryClient.invalidateQueries({ queryKey: ["filter-facets"] });
    },
  });
}
