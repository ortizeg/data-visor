"use client";

/**
 * Quick-tag buttons for error triage in the detail modal.
 *
 * Renders a row of TP / FP / FN / Mistake buttons that set or remove
 * triage tags on the current sample. Clicking the already-active tag
 * removes it; clicking a different tag replaces atomically.
 */

import { TRIAGE_OPTIONS } from "@/types/triage";
import { useSetTriageTag, useRemoveTriageTag } from "@/hooks/use-triage";

interface TriageTagButtonsProps {
  datasetId: string;
  sampleId: string;
  /** The sample's current tags array (may include non-triage tags). */
  currentTags: string[];
}

export function TriageTagButtons({
  datasetId,
  sampleId,
  currentTags,
}: TriageTagButtonsProps) {
  const setTriageTag = useSetTriageTag();
  const removeTriageTag = useRemoveTriageTag();

  const activeTriageTag =
    currentTags.find((t) => t.startsWith("triage:")) ?? null;

  function handleClick(tag: string) {
    if (tag === activeTriageTag) {
      // Toggle off -- remove the triage tag
      removeTriageTag.mutate({ dataset_id: datasetId, sample_id: sampleId });
    } else {
      // Set or replace the triage tag
      setTriageTag.mutate({
        dataset_id: datasetId,
        sample_id: sampleId,
        tag,
      });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-zinc-500">Triage:</span>
      <div className="flex items-center gap-1">
        {TRIAGE_OPTIONS.map((opt) => {
          const isActive = activeTriageTag === opt.tag;
          return (
            <button
              key={opt.tag}
              onClick={() => handleClick(opt.tag)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? `${opt.colorClass} text-white`
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
