/**
 * Hooks for near-duplicate detection: trigger, SSE progress, and results.
 *
 * Follows the same EventSource pattern as use-embedding-progress.ts
 * and TanStack Query patterns from use-embeddings.ts.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { API_BASE } from "@/lib/constants";
import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types (mirror backend Pydantic models)
// ---------------------------------------------------------------------------

export interface NearDuplicateGroup {
  sample_ids: string[];
  size: number;
}

export interface NearDuplicateResponse {
  groups: NearDuplicateGroup[];
  total_groups: number;
  total_duplicates: number;
  threshold: number;
}

export interface NearDuplicateProgress {
  status: string; // "idle" | "scanning" | "grouping" | "complete" | "error"
  progress: number; // 0.0 to 1.0
  scanned: number;
  total: number;
  groups_found: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Trigger detection (fire-and-forget POST)
// ---------------------------------------------------------------------------

/**
 * Trigger near-duplicate detection for a dataset.
 *
 * This is a plain async function (not a hook) -- call it imperatively
 * from a button handler.
 */
export async function triggerDetection(
  datasetId: string,
  threshold = 0.95,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/datasets/${datasetId}/near-duplicates/detect?threshold=${threshold}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.detail ?? `Detection trigger failed: ${res.status}`,
    );
  }
}

// ---------------------------------------------------------------------------
// SSE progress hook
// ---------------------------------------------------------------------------

const IDLE_PROGRESS: NearDuplicateProgress = {
  status: "idle",
  progress: 0,
  scanned: 0,
  total: 0,
  groups_found: 0,
  message: "Not started",
};

/**
 * Subscribe to the near-duplicate detection SSE progress stream.
 *
 * Opens an EventSource when `enabled` is true, parses "progress"
 * events, and closes on terminal status (complete / error).
 */
export function useNearDuplicateProgress(
  datasetId: string,
  enabled: boolean,
): { progress: NearDuplicateProgress; isRunning: boolean } {
  const [progress, setProgress] =
    useState<NearDuplicateProgress>(IDLE_PROGRESS);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const url = `${API_BASE}/datasets/${datasetId}/near-duplicates/progress`;
    const source = new EventSource(url);

    source.addEventListener("progress", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as NearDuplicateProgress;
        setProgress(data);

        if (data.status === "complete" || data.status === "error") {
          source.close();
        }
      } catch {
        // Ignore malformed events
      }
    });

    source.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as NearDuplicateProgress;
        setProgress(data);

        if (data.status === "complete" || data.status === "error") {
          source.close();
        }
      } catch {
        // Ignore malformed events
      }
    };

    source.onerror = () => {
      // Let EventSource handle reconnection for transient errors.
    };

    return () => {
      source.close();
    };
  }, [datasetId, enabled]);

  const isRunning =
    progress.status === "scanning" || progress.status === "grouping";

  return { progress, isRunning };
}

// ---------------------------------------------------------------------------
// Results query hook
// ---------------------------------------------------------------------------

/**
 * Fetch cached near-duplicate results via TanStack Query.
 *
 * Only fetches when `enabled` is true (i.e. after detection completes).
 */
export function useNearDuplicateResults(
  datasetId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["near-duplicates", datasetId],
    queryFn: () =>
      apiFetch<NearDuplicateResponse>(
        `/datasets/${datasetId}/near-duplicates`,
      ),
    enabled,
    staleTime: Infinity, // Results are stable until a new detection runs
  });
}
