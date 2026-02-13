/**
 * TanStack Query mutation for the POST /ingestion/scan endpoint.
 *
 * Returns a mutation that accepts a folder path string and returns
 * a ScanResult with detected splits.
 */

import { useMutation } from "@tanstack/react-query";

import { apiPost } from "@/lib/api";
import type { ScanResult } from "@/types/scan";

export function useScanFolder() {
  return useMutation({
    mutationFn: (rootPath: string) =>
      apiPost<ScanResult>("/ingestion/scan", { root_path: rootPath }),
  });
}
