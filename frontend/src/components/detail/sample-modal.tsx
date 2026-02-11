"use client";

/**
 * Full-resolution sample detail modal.
 *
 * Uses the native HTML <dialog> element for accessibility (focus trap,
 * Escape key, backdrop). Shows:
 *   - Full-resolution image with SVG annotation overlays
 *   - Sample metadata (filename, dimensions, split)
 *   - Tabular list of all annotations with class colors, bbox, area
 *
 * Opened when a grid cell is clicked (via useUIStore.openDetailModal).
 * Closed via Escape key, backdrop click, or the X button.
 */

import { useEffect, useRef, useCallback, type MouseEvent } from "react";

import { fullImageUrl } from "@/lib/api";
import { useAnnotations } from "@/hooks/use-annotations";
import { useUIStore } from "@/stores/ui-store";
import { AnnotationOverlay } from "@/components/grid/annotation-overlay";
import { AnnotationList } from "./annotation-list";
import type { Sample } from "@/types/sample";

interface SampleModalProps {
  /** Dataset ID for building image URLs and fetching annotations. */
  datasetId: string;
  /** All loaded samples (from the grid's query cache). */
  samples: Sample[];
}

/**
 * Detail modal showing full-resolution image with annotation overlays
 * and a metadata/annotation table.
 *
 * Reads selectedSampleId and isDetailModalOpen from the Zustand UI store.
 * Finds the sample from the provided samples array (already in memory
 * from the grid's infinite query cache).
 */
export function SampleModal({ datasetId, samples }: SampleModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const selectedSampleId = useUIStore((s) => s.selectedSampleId);
  const isDetailModalOpen = useUIStore((s) => s.isDetailModalOpen);
  const closeDetailModal = useUIStore((s) => s.closeDetailModal);

  // Find the selected sample from the flattened samples array
  const sample = selectedSampleId
    ? samples.find((s) => s.id === selectedSampleId) ?? null
    : null;

  // Fetch annotations for the selected sample via per-sample endpoint
  const { data: annotations } = useAnnotations(datasetId, selectedSampleId);

  // Sync dialog open/close with Zustand state
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isDetailModalOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isDetailModalOpen]);

  // Handle dialog's native close event (Escape key, form submission)
  const handleClose = useCallback(() => {
    closeDetailModal();
  }, [closeDetailModal]);

  // Close on backdrop click (click on ::backdrop triggers click on dialog itself)
  const handleBackdropClick = useCallback(
    (e: MouseEvent<HTMLDialogElement>) => {
      // Only close if the click target is the dialog element itself (backdrop area)
      if (e.target === dialogRef.current) {
        closeDetailModal();
      }
    },
    [closeDetailModal],
  );

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onClick={handleBackdropClick}
      className="m-auto max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-xl bg-white p-0 shadow-2xl backdrop:bg-black/60 dark:bg-zinc-900"
    >
      {sample && (
        <div
          className="flex max-h-[90vh] flex-col overflow-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={closeDetailModal}
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            aria-label="Close detail modal"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>

          {/* Full-resolution image with annotation overlays */}
          <div className="relative bg-zinc-100 dark:bg-zinc-800">
            <img
              src={fullImageUrl(datasetId, sample.id)}
              alt={sample.file_name}
              className="h-auto w-full"
              decoding="async"
            />
            {annotations && annotations.length > 0 && (
              <AnnotationOverlay
                annotations={annotations}
                imageWidth={sample.width}
                imageHeight={sample.height}
              />
            )}
          </div>

          {/* Metadata and annotations section */}
          <div className="grid gap-6 p-5 md:grid-cols-[1fr_2fr]">
            {/* Left: metadata panel */}
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Sample Details
              </h2>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                  File
                </dt>
                <dd
                  className="truncate text-zinc-900 dark:text-zinc-100"
                  title={sample.file_name}
                >
                  {sample.file_name}
                </dd>

                <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                  Dimensions
                </dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {sample.width} x {sample.height}
                </dd>

                {sample.split && (
                  <>
                    <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                      Split
                    </dt>
                    <dd className="text-zinc-900 dark:text-zinc-100">
                      <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-700">
                        {sample.split}
                      </span>
                    </dd>
                  </>
                )}

                <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                  Dataset ID
                </dt>
                <dd className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {sample.dataset_id}
                </dd>
              </dl>
            </div>

            {/* Right: annotation list table */}
            <div>
              {annotations ? (
                annotations.length > 0 ? (
                  <AnnotationList annotations={annotations} />
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No annotations for this sample.
                  </p>
                )
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Loading annotations...
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
