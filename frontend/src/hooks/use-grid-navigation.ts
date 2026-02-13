/**
 * Grid keyboard navigation hook.
 *
 * Binds arrow keys (j/k/ArrowRight/ArrowLeft/ArrowDown/ArrowUp) for moving
 * a visible focus ring through grid cells, and Enter to open the detail modal.
 * Shortcuts are disabled when the detail modal is open or a non-grid tab is active.
 * Focus index resets to null when the samples array length changes (filter applied).
 */

import { useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { useUIStore } from "@/stores/ui-store";
import type { Sample } from "@/types/sample";

export function useGridNavigation(
  samples: Sample[],
  columnsPerRow: number,
  scrollToRow: (rowIndex: number) => void,
) {
  const isModalOpen = useUIStore((s) => s.isDetailModalOpen);
  const activeTab = useUIStore((s) => s.activeTab);
  const focusedGridIndex = useUIStore((s) => s.focusedGridIndex);
  const setFocusedGridIndex = useUIStore((s) => s.setFocusedGridIndex);
  const openDetailModal = useUIStore((s) => s.openDetailModal);

  const enabled = activeTab === "grid" && !isModalOpen;
  const maxIdx = samples.length - 1;

  function moveTo(newIdx: number) {
    const clamped = Math.max(0, Math.min(newIdx, maxIdx));
    setFocusedGridIndex(clamped);
    scrollToRow(Math.floor(clamped / columnsPerRow));
  }

  // Next cell: j or ArrowRight
  useHotkeys(
    "j, ArrowRight",
    () => moveTo((focusedGridIndex ?? -1) + 1),
    { enabled, preventDefault: true },
    [focusedGridIndex, maxIdx],
  );

  // Previous cell: k or ArrowLeft
  useHotkeys(
    "k, ArrowLeft",
    () => moveTo((focusedGridIndex ?? 0) - 1),
    { enabled, preventDefault: true },
    [focusedGridIndex, maxIdx],
  );

  // Next row: ArrowDown
  useHotkeys(
    "ArrowDown",
    () => moveTo((focusedGridIndex ?? -columnsPerRow) + columnsPerRow),
    { enabled, preventDefault: true },
    [focusedGridIndex, maxIdx, columnsPerRow],
  );

  // Previous row: ArrowUp
  useHotkeys(
    "ArrowUp",
    () => moveTo((focusedGridIndex ?? columnsPerRow) - columnsPerRow),
    { enabled, preventDefault: true },
    [focusedGridIndex, maxIdx, columnsPerRow],
  );

  // Open detail modal for focused cell: Enter
  useHotkeys(
    "Enter",
    () => {
      if (focusedGridIndex !== null && samples[focusedGridIndex]) {
        openDetailModal(samples[focusedGridIndex].id);
      }
    },
    { enabled },
    [focusedGridIndex, samples],
  );

  // Reset focus when samples array length changes (filter applied, new data loaded)
  useEffect(() => {
    setFocusedGridIndex(null);
  }, [samples.length, setFocusedGridIndex]);
}
