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
import { useHotkeys } from "react-hotkeys-hook";

import { fullImageUrl } from "@/lib/api";
import {
  useAnnotations,
  useUpdateAnnotation,
  useCreateAnnotation,
  useDeleteAnnotation,
} from "@/hooks/use-annotations";
import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useSimilarity } from "@/hooks/use-similarity";
import { useFilterStore } from "@/stores/filter-store";
import { useUIStore } from "@/stores/ui-store";
import { AnnotationOverlay } from "@/components/grid/annotation-overlay";
import { TriageFilterButtons } from "@/components/triage/triage-tag-buttons";
import { TriageOverlay } from "./triage-overlay";
import { AnnotationList } from "./annotation-list";
import { SimilarityPanel } from "./similarity-panel";
import { useAnnotationTriage, useSetAnnotationTriage } from "@/hooks/use-annotation-triage";
import { nextTriageLabel } from "@/types/annotation-triage";
import type { Annotation } from "@/types/annotation";
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

/** Undo action for single-level annotation delete undo. */
interface UndoAction {
  type: "delete";
  annotation: Annotation;
}

interface SampleModalProps {
  /** Dataset ID for building image URLs and fetching annotations. */
  datasetId: string;
  /** All loaded samples (from the grid's query cache). */
  samples: Sample[];
  /** Dataset type -- "classification" shows class labels instead of bbox overlays. */
  datasetType?: string;
}

/**
 * Detail modal showing full-resolution image with annotation overlays
 * and a metadata/annotation table.
 *
 * Reads selectedSampleId and isDetailModalOpen from the Zustand UI store.
 * Finds the sample from the provided samples array (already in memory
 * from the grid's infinite query cache).
 */
export function SampleModal({ datasetId, samples, datasetType }: SampleModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const selectedSampleId = useUIStore((s) => s.selectedSampleId);
  const isDetailModalOpen = useUIStore((s) => s.isDetailModalOpen);
  const closeDetailModal = useUIStore((s) => s.closeDetailModal);
  const isEditMode = useUIStore((s) => s.isEditMode);
  const toggleEditMode = useUIStore((s) => s.toggleEditMode);
  const isDrawMode = useUIStore((s) => s.isDrawMode);
  const toggleDrawMode = useUIStore((s) => s.toggleDrawMode);
  const selectedAnnotationId = useUIStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = useUIStore((s) => s.setSelectedAnnotationId);
  const openDetailModal = useUIStore((s) => s.openDetailModal);

  // Annotation triage filter state
  const [triageFilter, setTriageFilter] = useState<string | null>(null);

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

  // Determine the active prediction source for IoU matching
  const predSource = predAnnotations.length > 0
    ? predAnnotations[0].source
    : null;

  // Per-annotation triage: only fetch when both GT and predictions exist
  const hasBothSources = gtAnnotations.length > 0 && predAnnotations.length > 0;
  const { data: triageMap } = useAnnotationTriage(
    datasetId,
    selectedSampleId,
    predSource ?? "prediction",
    hasBothSources && !isEditMode, // disable during edit mode (Konva takes over)
  );

  const setAnnotationTriage = useSetAnnotationTriage();

  // Click handler for cycling per-annotation triage labels
  const handleTriageClick = useCallback(
    (annotationId: string, currentLabel: string) => {
      if (!selectedSampleId) return;
      const next = nextTriageLabel(currentLabel);
      setAnnotationTriage.mutate({
        annotation_id: annotationId,
        dataset_id: datasetId,
        sample_id: selectedSampleId,
        label: next,
      });
    },
    [datasetId, selectedSampleId, setAnnotationTriage],
  );

  // Similarity search state -- only fetches when user clicks "Find Similar"
  const [showSimilar, setShowSimilar] = useState(false);
  const { data: similarityData, isLoading: similarityLoading } = useSimilarity(
    datasetId,
    selectedSampleId,
    20,
    showSimilar,
  );

  // Reset showSimilar and triage filter when the selected sample changes
  useEffect(() => {
    setShowSimilar(false);
    setTriageFilter(null);
  }, [selectedSampleId]);

  // -----------------------------------------------------------------------
  // Keyboard shortcuts (modal-scope)
  // -----------------------------------------------------------------------

  // Navigate to next sample: j / ArrowRight
  useHotkeys(
    "j, ArrowRight",
    () => {
      const idx = samples.findIndex((s) => s.id === selectedSampleId);
      if (idx >= 0 && idx < samples.length - 1) {
        openDetailModal(samples[idx + 1].id);
      }
    },
    { enabled: isDetailModalOpen, preventDefault: true },
    [selectedSampleId, samples],
  );

  // Navigate to previous sample: k / ArrowLeft
  useHotkeys(
    "k, ArrowLeft",
    () => {
      const idx = samples.findIndex((s) => s.id === selectedSampleId);
      if (idx > 0) {
        openDetailModal(samples[idx - 1].id);
      }
    },
    { enabled: isDetailModalOpen, preventDefault: true },
    [selectedSampleId, samples],
  );

  // Triage filter keys 1-4: toggle annotation filter
  useHotkeys(
    "1, 2, 3, 4",
    (e) => {
      const labels = ["tp", "fp", "fn", "mistake"];
      const label = labels[parseInt(e.key, 10) - 1];
      setTriageFilter((prev) => (prev === label ? null : label));
    },
    { enabled: isDetailModalOpen && !isEditMode, preventDefault: true },
  );

  // Edit mode toggle: e
  useHotkeys(
    "e",
    () => toggleEditMode(),
    { enabled: isDetailModalOpen },
  );

  // -----------------------------------------------------------------------
  // Undo stack for annotation deletes (single-level)
  // -----------------------------------------------------------------------
  const [lastAction, setLastAction] = useState<UndoAction | null>(null);

  // Reset undo state when navigating to a different sample
  useEffect(() => {
    setLastAction(null);
  }, [selectedSampleId]);

  // Delete selected annotation: Delete / Backspace (edit mode only)
  useHotkeys(
    "Delete, Backspace",
    () => {
      if (selectedAnnotationId) {
        // Save undo state before deleting
        const found = (annotations ?? []).find(
          (a) => a.id === selectedAnnotationId,
        );
        if (found) {
          setLastAction({ type: "delete", annotation: found });
        }
        deleteMutation.mutate(selectedAnnotationId);
        setSelectedAnnotationId(null);
      }
    },
    { enabled: isDetailModalOpen && isEditMode },
    [selectedAnnotationId, annotations],
  );

  // Undo last delete: Ctrl+Z / Cmd+Z (edit mode only)
  useHotkeys(
    "ctrl+z, meta+z",
    () => {
      if (lastAction?.type === "delete") {
        const a = lastAction.annotation;
        createMutation.mutate({
          dataset_id: a.dataset_id,
          sample_id: a.sample_id,
          category_name: a.category_name,
          bbox_x: a.bbox_x,
          bbox_y: a.bbox_y,
          bbox_w: a.bbox_w,
          bbox_h: a.bbox_h,
        });
        setLastAction(null);
      }
    },
    {
      enabled: isDetailModalOpen && isEditMode && lastAction !== null,
      preventDefault: true,
    },
    [lastAction, datasetId, selectedSampleId],
  );

  // Escape exits edit mode (does NOT close modal -- native dialog handles that)
  useHotkeys(
    "Escape",
    () => toggleEditMode(),
    { enabled: isDetailModalOpen && isEditMode },
  );

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
                {annotations && annotations.length > 0 && (() => {
                  const filteredTriageMap = triageFilter && triageMap
                    ? Object.fromEntries(
                        Object.entries(triageMap).filter(([, v]) => v.label === triageFilter)
                      )
                    : triageMap;
                  // If a filter is active but no annotations match, show nothing
                  if (triageFilter && (!filteredTriageMap || Object.keys(filteredTriageMap).length === 0)) {
                    return null;
                  }
                  return filteredTriageMap && Object.keys(filteredTriageMap).length > 0 ? (
                    <TriageOverlay
                      annotations={annotations}
                      triageMap={filteredTriageMap}
                      imageWidth={sample.width}
                      imageHeight={sample.height}
                      onClickAnnotation={handleTriageClick}
                    />
                  ) : (
                    <AnnotationOverlay
                      annotations={annotations}
                      imageWidth={sample.width}
                      imageHeight={sample.height}
                    />
                  );
                })()}
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
            {/* Triage filter buttons (always visible, not gated by edit mode) */}
            <TriageFilterButtons
              activeFilter={triageFilter}
              onFilterChange={setTriageFilter}
            />

            {/* Spacer + edit hint pushed right */}
            {isEditMode && (
              <span className="ml-auto text-xs text-zinc-400">
                {isDrawMode
                  ? "Click and drag to draw a new box"
                  : "Click a box to select, drag to move, handles to resize"}
              </span>
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

              <div className="mt-3 flex flex-col gap-2">
                <button
                  onClick={() => setShowSimilar(!showSimilar)}
                  className="w-full rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                >
                  {showSimilar ? "Hide Similar" : "Find Similar"}
                </button>
                {showSimilar && similarityData && similarityData.results.length > 0 && (
                  <button
                    onClick={() => {
                      const ids = similarityData.results.map((r) => r.sample_id);
                      useFilterStore.getState().setSampleIdFilter(ids);
                      useUIStore.getState().setActiveTab("grid");
                      useUIStore.getState().closeDetailModal();
                    }}
                    className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
                  >
                    Show in Grid ({similarityData.results.length})
                  </button>
                )}
              </div>
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
