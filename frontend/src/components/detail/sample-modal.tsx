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

import { useEffect, useRef, useState, useCallback, type MouseEvent } from "react";
import dynamic from "next/dynamic";

import { fullImageUrl } from "@/lib/api";
import {
  useAnnotations,
  useUpdateAnnotation,
  useCreateAnnotation,
  useDeleteAnnotation,
} from "@/hooks/use-annotations";
import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useSimilarity } from "@/hooks/use-similarity";
import { useUIStore } from "@/stores/ui-store";
import { AnnotationOverlay } from "@/components/grid/annotation-overlay";
import { TriageTagButtons } from "@/components/triage/triage-tag-buttons";
import { AnnotationList } from "./annotation-list";
import { SimilarityPanel } from "./similarity-panel";
import type { Sample } from "@/types/sample";

const AnnotationEditor = dynamic(
  () =>
    import("./annotation-editor").then((m) => ({
      default: m.AnnotationEditor,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center">
        Loading editor...
      </div>
    ),
  },
);

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
  const isEditMode = useUIStore((s) => s.isEditMode);
  const toggleEditMode = useUIStore((s) => s.toggleEditMode);
  const isDrawMode = useUIStore((s) => s.isDrawMode);
  const toggleDrawMode = useUIStore((s) => s.toggleDrawMode);
  const isHighlightMode = useUIStore((s) => s.isHighlightMode);
  const toggleHighlightMode = useUIStore((s) => s.toggleHighlightMode);

  // Find the selected sample from the flattened samples array
  const sample = selectedSampleId
    ? samples.find((s) => s.id === selectedSampleId) ?? null
    : null;

  // Fetch annotations for the selected sample via per-sample endpoint
  const { data: annotations } = useAnnotations(datasetId, selectedSampleId);

  // Mutation hooks for annotation CRUD
  const updateMutation = useUpdateAnnotation(datasetId, selectedSampleId ?? "");
  const createMutation = useCreateAnnotation(datasetId, selectedSampleId ?? "");
  const deleteMutation = useDeleteAnnotation(datasetId, selectedSampleId ?? "");

  // Get categories from filter facets for the class picker
  const { data: facets } = useFilterFacets(datasetId);
  const categories = facets?.categories?.map((c) => c.name) ?? [];

  // Split annotations by source for the editor
  const gtAnnotations = (annotations ?? []).filter(
    (a) => a.source === "ground_truth",
  );
  const predAnnotations = (annotations ?? []).filter(
    (a) => a.source !== "ground_truth",
  );

  // Similarity search state -- only fetches when user clicks "Find Similar"
  const [showSimilar, setShowSimilar] = useState(false);
  const { data: similarityData, isLoading: similarityLoading } = useSimilarity(
    datasetId,
    selectedSampleId,
    20,
    showSimilar,
  );

  // Reset showSimilar when the selected sample changes
  useEffect(() => {
    setShowSimilar(false);
  }, [selectedSampleId]);

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

          {/* Full-resolution image with annotation overlays or Konva editor */}
          <div className="relative bg-zinc-100 dark:bg-zinc-800">
            {isEditMode ? (
              <AnnotationEditor
                imageUrl={fullImageUrl(datasetId, sample.id)}
                annotations={gtAnnotations}
                predictions={predAnnotations}
                imageWidth={sample.width}
                imageHeight={sample.height}
                categories={categories}
                onUpdate={(id, bbox) =>
                  updateMutation.mutate({ id, ...bbox })
                }
                onCreate={(bbox, categoryName) =>
                  createMutation.mutate({
                    dataset_id: datasetId,
                    sample_id: sample.id,
                    category_name: categoryName,
                    ...bbox,
                  })
                }
              />
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* Edit toolbar */}
          <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-2 dark:border-zinc-700">
            <button
              onClick={toggleEditMode}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                isEditMode
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {isEditMode ? "Done" : "Edit Annotations"}
            </button>
            {isEditMode && (
              <button
                onClick={toggleDrawMode}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  isDrawMode
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {isDrawMode ? "Cancel Draw" : "Draw New Box"}
              </button>
            )}
            {/* Triage tag buttons (always visible, not gated by edit mode) */}
            <TriageTagButtons
              datasetId={datasetId}
              sampleId={sample.id}
              currentTags={sample.tags ?? []}
            />

            {/* Spacer + highlight toggle + edit hint pushed right */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={toggleHighlightMode}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  isHighlightMode
                    ? "bg-yellow-500 text-white hover:bg-yellow-600"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                Highlight
              </button>
              {isEditMode && (
                <span className="text-xs text-zinc-400">
                  {isDrawMode
                    ? "Click and drag to draw a new box"
                    : "Click a box to select, drag to move, handles to resize"}
                </span>
              )}
            </div>
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

              <button
                onClick={() => setShowSimilar(!showSimilar)}
                className="mt-3 w-full rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
              >
                {showSimilar ? "Hide Similar" : "Find Similar"}
              </button>
            </div>

            {/* Right: annotation list table */}
            <div>
              {annotations ? (
                annotations.length > 0 ? (
                  <AnnotationList
                    annotations={annotations}
                    onDelete={
                      isEditMode
                        ? (id) => deleteMutation.mutate(id)
                        : undefined
                    }
                  />
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

          {/* Similarity results panel (shown when "Find Similar" is clicked) */}
          {showSimilar && (
            <div className="border-t border-zinc-200 p-5 dark:border-zinc-700">
              <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Similar Images
              </h3>
              <SimilarityPanel
                datasetId={datasetId}
                results={similarityData?.results ?? []}
                isLoading={similarityLoading}
                onSelectSample={(sampleId) => {
                  useUIStore.getState().openDetailModal(sampleId);
                }}
              />
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
