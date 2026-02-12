/**
 * EventSource hook for consuming SSE progress streams from the
 * VLM auto-tagging endpoint.
 *
 * Reuses the same SSE pattern as use-embedding-progress.ts:
 * - Creates the connection when `enabled` becomes true
 * - Parses "progress" events into TaggingProgress state
 * - Closes the connection on "complete" or "error" status
 * - Cleans up on unmount
 */

import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/constants";
import type { TaggingProgress } from "@/types/vlm";

const IDLE_PROGRESS: TaggingProgress = {
  status: "idle",
  processed: 0,
  total: 0,
  message: "",
};

/**
 * Subscribe to a VLM auto-tagging SSE progress stream.
 *
 * @param datasetId - The dataset to monitor auto-tagging for
 * @param enabled - Whether to open the EventSource connection
 * @returns Current tagging progress state
 */
export function useVLMProgress(
  datasetId: string,
  enabled: boolean,
): TaggingProgress {
  const [progress, setProgress] = useState<TaggingProgress>(IDLE_PROGRESS);

  useEffect(() => {
    if (!enabled) {
      setProgress(IDLE_PROGRESS);
      return;
    }

    const url = `${API_BASE}/datasets/${datasetId}/auto-tag/progress`;
    const source = new EventSource(url);

    // Listen for named "progress" events (backend uses event: "progress")
    source.addEventListener("progress", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as TaggingProgress;
        setProgress(data);

        // Close on terminal status to prevent auto-reconnect
        if (data.status === "complete" || data.status === "error") {
          source.close();
        }
      } catch {
        // Ignore malformed events
      }
    });

    // Also handle generic messages as fallback
    source.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as TaggingProgress;
        setProgress(data);

        if (data.status === "complete" || data.status === "error") {
          source.close();
        }
      } catch {
        // Ignore malformed events
      }
    };

    source.onerror = () => {
      // EventSource will attempt to reconnect automatically.
      // If the connection was intentionally closed (complete/error), this is a no-op.
    };

    return () => {
      source.close();
    };
  }, [datasetId, enabled]);

  return progress;
}
