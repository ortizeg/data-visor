/**
 * EventSource hook for consuming SSE progress streams from the
 * embedding generation and reduction endpoints.
 *
 * Wraps the browser EventSource API with React lifecycle management:
 * - Creates the connection when `enabled` becomes true
 * - Parses "progress" events into EmbeddingProgress state
 * - Closes the connection on "complete" or "error" status
 *   (prevents auto-reconnect loop -- Pitfall 6 from research)
 * - Cleans up on unmount
 */

import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/constants";
import type { EmbeddingProgress } from "@/types/embedding";

const IDLE_PROGRESS: EmbeddingProgress = {
  status: "idle",
  message: "",
};

/**
 * Subscribe to an SSE progress stream.
 *
 * @param path - API path relative to API_BASE (e.g. `/datasets/{id}/embeddings/progress`)
 * @param enabled - Whether to open the EventSource connection
 * @returns Current progress state
 */
export function useEmbeddingProgress(
  path: string,
  enabled: boolean,
): EmbeddingProgress {
  const [progress, setProgress] = useState<EmbeddingProgress>(IDLE_PROGRESS);

  useEffect(() => {
    if (!enabled) {
      setProgress(IDLE_PROGRESS);
      return;
    }

    const url = `${API_BASE}${path}`;
    const source = new EventSource(url);

    // Listen for named "progress" events (backend uses event: "progress")
    source.addEventListener("progress", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as EmbeddingProgress;
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
        const data = JSON.parse(e.data) as EmbeddingProgress;
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
      // For unexpected errors, we let EventSource retry.
    };

    return () => {
      source.close();
    };
  }, [path, enabled]);

  return progress;
}
