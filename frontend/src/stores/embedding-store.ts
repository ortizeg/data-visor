/**
 * Zustand store for embedding-related state (lasso selection).
 *
 * Lasso selection is a cross-filter concern (spatial selection from the
 * embedding space), separate from the metadata filter store. The
 * use-samples hook reads from both stores and combines them into the
 * API query.
 *
 * null semantics: lassoSelectedIds = null means no lasso is active
 * (show all samples). An empty array means "lasso drawn but nothing
 * selected" which effectively shows zero results.
 */

import { create } from "zustand";

interface EmbeddingState {
  /** Sample IDs selected via lasso. null = no lasso active (show all). */
  lassoSelectedIds: string[] | null;
  /** Set lasso-selected IDs (after point-in-polygon testing). */
  setLassoSelectedIds: (ids: string[] | null) => void;
  /** Clear lasso selection. */
  clearLasso: () => void;
}

export const useEmbeddingStore = create<EmbeddingState>((set) => ({
  lassoSelectedIds: null,
  setLassoSelectedIds: (ids) => set({ lassoSelectedIds: ids }),
  clearLasso: () => set({ lassoSelectedIds: null }),
}));

// Atomic selectors
export const useLassoSelectedIds = () =>
  useEmbeddingStore((s) => s.lassoSelectedIds);
