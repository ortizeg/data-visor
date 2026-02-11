/**
 * Zustand store for client-side UI state.
 *
 * Server data (samples, datasets, annotations) lives in TanStack Query.
 * This store is only for UI state: modal open/close, selected sample,
 * grid column count, overlay mode.
 */

import { create } from "zustand";

import { DEFAULT_COLUMNS } from "@/lib/constants";

/** Which annotation sources to display on the grid overlay. */
export type OverlayMode = "ground_truth" | "prediction" | "both";

interface UIState {
  /** Currently selected sample ID for the detail modal. */
  selectedSampleId: string | null;
  /** Whether the detail modal is open. */
  isDetailModalOpen: boolean;
  /** Number of columns in the image grid. */
  columnsPerRow: number;
  /** Which annotation sources to show (GT, predictions, or both). */
  overlayMode: OverlayMode;

  /** Open the detail modal for a given sample. */
  openDetailModal: (sampleId: string) => void;
  /** Close the detail modal. */
  closeDetailModal: () => void;
  /** Set the number of grid columns (responsive). */
  setColumnsPerRow: (cols: number) => void;
  /** Set the overlay mode for annotation rendering. */
  setOverlayMode: (mode: OverlayMode) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSampleId: null,
  isDetailModalOpen: false,
  columnsPerRow: DEFAULT_COLUMNS,
  overlayMode: "ground_truth",

  openDetailModal: (sampleId) =>
    set({ selectedSampleId: sampleId, isDetailModalOpen: true }),
  closeDetailModal: () =>
    set({ selectedSampleId: null, isDetailModalOpen: false }),
  setColumnsPerRow: (cols) => set({ columnsPerRow: cols }),
  setOverlayMode: (mode) => set({ overlayMode: mode }),
}));
