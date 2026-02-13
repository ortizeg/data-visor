/**
 * Zustand store for the ingestion wizard state.
 *
 * Manages the three-step wizard flow: path input -> scan confirmation -> import progress.
 * Server data (scan results, progress) is fetched by hooks; this store holds
 * UI state: current step, selected splits, dataset name.
 */

import { create } from "zustand";

import type { ScanResult } from "@/types/scan";

type WizardStep = "input" | "confirm" | "importing" | "done";

interface IngestState {
  /** Current wizard step. */
  step: WizardStep;
  /** Scan result from backend. */
  scanResult: ScanResult | null;
  /** Set of split names the user has selected for import. */
  selectedSplits: Set<string>;
  /** User-editable dataset name. */
  datasetName: string;
  /** Error message from scan or import. */
  error: string | null;

  /** Store scan result, populate selected splits, advance to confirm step. */
  setScanResult: (result: ScanResult) => void;
  /** Toggle a split name in/out of the selected set. */
  toggleSplit: (name: string) => void;
  /** Update the dataset name. */
  setDatasetName: (name: string) => void;
  /** Advance to the importing step. */
  startImport: () => void;
  /** Mark import as done. */
  setDone: () => void;
  /** Set an error message. */
  setError: (error: string) => void;
  /** Reset all state to defaults (for "Import Another" flow). */
  reset: () => void;
}

export const useIngestStore = create<IngestState>((set) => ({
  step: "input",
  scanResult: null,
  selectedSplits: new Set<string>(),
  datasetName: "",
  error: null,

  setScanResult: (result) =>
    set({
      scanResult: result,
      selectedSplits: new Set(result.splits.map((s) => s.name)),
      datasetName: result.dataset_name,
      step: "confirm",
      error: null,
    }),

  toggleSplit: (name) =>
    set((state) => {
      const next = new Set(state.selectedSplits);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return { selectedSplits: next };
    }),

  setDatasetName: (name) => set({ datasetName: name }),

  startImport: () => set({ step: "importing", error: null }),

  setDone: () => set({ step: "done" }),

  setError: (error) => set({ error }),

  reset: () =>
    set({
      step: "input",
      scanResult: null,
      selectedSplits: new Set<string>(),
      datasetName: "",
      error: null,
    }),
}));
