/**
 * Central keyboard shortcut registry.
 *
 * All keyboard shortcuts are defined here as data -- consumed by both
 * useHotkeys hook calls and the help overlay component. This keeps
 * shortcut definitions DRY: one source of truth for keys, labels, and groups.
 */

export interface ShortcutDef {
  /** react-hotkeys-hook key string (e.g. "j, ArrowRight"). */
  keys: string;
  /** Human-readable key label for the help overlay (e.g. "J / ->"). */
  display: string;
  /** Action description shown in the help overlay. */
  label: string;
  /** Grouping category for the help overlay sections. */
  group: "navigation" | "triage" | "editing" | "general";
  /** When this shortcut is active (e.g. "Grid view", "Modal open"). */
  context?: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  // -- Navigation --
  {
    keys: "j, ArrowRight",
    display: "J / \u2192",
    label: "Next sample",
    group: "navigation",
    context: "Grid or Modal",
  },
  {
    keys: "k, ArrowLeft",
    display: "K / \u2190",
    label: "Previous sample",
    group: "navigation",
    context: "Grid or Modal",
  },
  {
    keys: "ArrowDown",
    display: "\u2193",
    label: "Next row (grid)",
    group: "navigation",
    context: "Grid view",
  },
  {
    keys: "ArrowUp",
    display: "\u2191",
    label: "Previous row (grid)",
    group: "navigation",
    context: "Grid view",
  },
  {
    keys: "Enter",
    display: "Enter",
    label: "Open sample detail",
    group: "navigation",
    context: "Grid view",
  },
  {
    keys: "Escape",
    display: "Esc",
    label: "Close modal / exit mode",
    group: "navigation",
    context: "Modal open",
  },

  // -- Triage --
  {
    keys: "1",
    display: "1",
    label: "Tag as TP",
    group: "triage",
    context: "Modal open",
  },
  {
    keys: "2",
    display: "2",
    label: "Tag as FP",
    group: "triage",
    context: "Modal open",
  },
  {
    keys: "3",
    display: "3",
    label: "Tag as FN",
    group: "triage",
    context: "Modal open",
  },
  {
    keys: "4",
    display: "4",
    label: "Tag as Mistake",
    group: "triage",
    context: "Modal open",
  },
  {
    keys: "h",
    display: "H",
    label: "Toggle highlight mode",
    group: "triage",
    context: "Any",
  },

  // -- Editing --
  {
    keys: "e",
    display: "E",
    label: "Toggle edit mode",
    group: "editing",
    context: "Modal open",
  },
  {
    keys: "Delete, Backspace",
    display: "Del / Backspace",
    label: "Delete selected annotation",
    group: "editing",
    context: "Edit mode",
  },
  {
    keys: "ctrl+z, meta+z",
    display: "Ctrl+Z / Cmd+Z",
    label: "Undo last edit",
    group: "editing",
    context: "Edit mode",
  },

  // -- General --
  {
    keys: "shift+/",
    display: "?",
    label: "Show keyboard shortcuts",
    group: "general",
    context: "Any",
  },
  {
    keys: "shift+l",
    display: "Shift+L",
    label: "Toggle lasso selection",
    group: "general",
    context: "Grid view",
  },
];
