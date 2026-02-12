/**
 * Zustand store for client-side UI state.
 *
 * Server data (samples, datasets, annotations) lives in TanStack Query.
 * This store is only for UI state: modal open/close, selected sample,
 * grid column count, active annotation sources.
 */

import { create } from "zustand";

import { DEFAULT_COLUMNS } from "@/lib/constants";

/** Which tab is active on the dataset page. */
export type DatasetTab = "grid" | "statistics";

interface UIState {
  /** Currently selected sample ID for the detail modal. */
  selectedSampleId: string | null;
  /** Whether the detail modal is open. */
  isDetailModalOpen: boolean;
  /** Number of columns in the image grid. */
  columnsPerRow: number;
  /** Active annotation sources to display. null = show all (default). */
  activeSources: string[] | null;
  /** Which tab is active on the dataset page (grid or statistics). */
  activeTab: DatasetTab;

  /** Open the detail modal for a given sample. */
  openDetailModal: (sampleId: string) => void;
  /** Close the detail modal. */
  closeDetailModal: () => void;
  /** Set the number of grid columns (responsive). */
  setColumnsPerRow: (cols: number) => void;
  /** Set active sources explicitly (null = show all). */
  setActiveSources: (sources: string[] | null) => void;
  /** Toggle a single source on/off. Requires allSources for null→explicit conversion. */
  toggleSource: (source: string, allSources: string[]) => void;
  /** Set the active tab on the dataset page. */
  setActiveTab: (tab: DatasetTab) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSampleId: null,
  isDetailModalOpen: false,
  columnsPerRow: DEFAULT_COLUMNS,
  activeSources: null,
  activeTab: "grid",

  openDetailModal: (sampleId) =>
    set({ selectedSampleId: sampleId, isDetailModalOpen: true }),
  closeDetailModal: () =>
    set({ selectedSampleId: null, isDetailModalOpen: false }),
  setColumnsPerRow: (cols) => set({ columnsPerRow: cols }),
  setActiveSources: (sources) => set({ activeSources: sources }),
  toggleSource: (source, allSources) =>
    set((state) => {
      if (state.activeSources === null) {
        // Currently showing all — switch to explicit list with this source removed
        const next = allSources.filter((s) => s !== source);
        return { activeSources: next.length === 0 ? null : next };
      }
      const has = state.activeSources.includes(source);
      const next = has
        ? state.activeSources.filter((s) => s !== source)
        : [...state.activeSources, source];
      // If result equals all sources, reset to null
      if (next.length >= allSources.length) {
        return { activeSources: null };
      }
      return { activeSources: next.length === 0 ? null : next };
    }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
