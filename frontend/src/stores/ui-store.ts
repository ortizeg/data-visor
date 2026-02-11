/**
 * Zustand store for client-side UI state.
 *
 * Server data (samples, datasets, annotations) lives in TanStack Query.
 * This store is only for UI state: modal open/close, selected sample,
 * grid column count.
 */

import { create } from "zustand";

import { DEFAULT_COLUMNS } from "@/lib/constants";

interface UIState {
  /** Currently selected sample ID for the detail modal. */
  selectedSampleId: string | null;
  /** Whether the detail modal is open. */
  isDetailModalOpen: boolean;
  /** Number of columns in the image grid. */
  columnsPerRow: number;

  /** Open the detail modal for a given sample. */
  openDetailModal: (sampleId: string) => void;
  /** Close the detail modal. */
  closeDetailModal: () => void;
  /** Set the number of grid columns (responsive). */
  setColumnsPerRow: (cols: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSampleId: null,
  isDetailModalOpen: false,
  columnsPerRow: DEFAULT_COLUMNS,

  openDetailModal: (sampleId) =>
    set({ selectedSampleId: sampleId, isDetailModalOpen: true }),
  closeDetailModal: () =>
    set({ selectedSampleId: null, isDetailModalOpen: false }),
  setColumnsPerRow: (cols) => set({ columnsPerRow: cols }),
}));
