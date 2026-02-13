/**
 * POST SSE streaming hook for import progress.
 *
 * Unlike EventSource (GET-only), this uses fetch() with ReadableStream
 * because the import endpoint is POST. Parses SSE `data:` lines from
 * the stream into IngestProgress objects.
 */

import { useCallback, useRef, useState } from "react";

import { API_BASE } from "@/lib/constants";
import type { ImportRequest, IngestProgress } from "@/types/scan";

interface UseIngestProgressReturn {
  /** Current progress event (null before first event). */
  progress: IngestProgress | null;
  /** Whether the import stream is currently active. */
  isImporting: boolean;
  /** Error message if the stream fails. */
  error: string | null;
  /** Start the import stream with the given request body. */
  startImport: (request: ImportRequest) => void;
}

export function useIngestProgress(
  onComplete?: () => void,
): UseIngestProgressReturn {
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startImport = useCallback(
    (request: ImportRequest) => {
      // Abort any existing stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsImporting(true);
      setError(null);
      setProgress(null);

      (async () => {
        try {
          const response = await fetch(`${API_BASE}/ingestion/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
            signal: controller.signal,
          });

          if (!response.ok) {
            const text = await response.text();
            let detail = `Import failed: ${response.status}`;
            try {
              const parsed = JSON.parse(text);
              if (parsed.detail) detail = parsed.detail;
            } catch {
              // Use default message
            }
            setError(detail);
            setIsImporting(false);
            return;
          }

          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";

            for (const part of parts) {
              const trimmed = part.trim();
              if (trimmed.startsWith("data: ")) {
                try {
                  const data = JSON.parse(
                    trimmed.slice(6),
                  ) as IngestProgress;
                  setProgress(data);

                  if (data.stage === "complete") {
                    setIsImporting(false);
                    onComplete?.();
                  }
                } catch {
                  // Skip malformed SSE events
                }
              }
            }
          }

          // Stream ended naturally
          setIsImporting(false);
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return; // Intentional abort, not an error
          }
          setError(
            err instanceof Error ? err.message : "Import stream failed",
          );
          setIsImporting(false);
        }
      })();
    },
    [onComplete],
  );

  return { progress, isImporting, error, startImport };
}
