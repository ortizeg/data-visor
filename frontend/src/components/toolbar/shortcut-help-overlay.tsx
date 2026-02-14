"use client";

/**
 * Full-screen overlay listing all keyboard shortcuts grouped by category.
 *
 * Triggered by ? (shift+/), dismissed by Escape or backdrop click.
 * Reads shortcut definitions from the central SHORTCUTS registry
 * and groups them by the `group` field for organized display.
 */

import { useHotkeys } from "react-hotkeys-hook";

import { SHORTCUTS, type ShortcutDef } from "@/lib/shortcuts";
import { useUIStore } from "@/stores/ui-store";

/** Group shortcuts by their `group` field using a simple reduce. */
function groupByCategory(
  shortcuts: readonly ShortcutDef[],
): Record<string, ShortcutDef[]> {
  return shortcuts.reduce<Record<string, ShortcutDef[]>>((acc, shortcut) => {
    const group = shortcut.group;
    if (!acc[group]) {
      acc[group] = [];
    }
    acc[group].push(shortcut);
    return acc;
  }, {});
}

export function ShortcutHelpOverlay() {
  const isOpen = useUIStore((s) => s.isHelpOverlayOpen);
  const toggleHelp = useUIStore((s) => s.toggleHelpOverlay);

  // Toggle help overlay: ? (shift+/)
  useHotkeys("shift+/", () => toggleHelp(), { preventDefault: true });

  // Close help overlay: Escape (only when open)
  useHotkeys(
    "Escape",
    () => {
      if (isOpen) toggleHelp();
    },
    { enabled: isOpen },
  );

  if (!isOpen) return null;

  const groups = groupByCategory(SHORTCUTS);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={toggleHelp}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Keyboard Shortcuts
        </h2>
        {Object.entries(groups).map(([group, shortcuts]) => (
          <div key={group} className="mb-4">
            <h3 className="mb-2 text-sm font-medium capitalize text-zinc-500">
              {group}
            </h3>
            <div className="space-y-1">
              {shortcuts.map((s) => (
                <div
                  key={s.keys}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">
                    {s.label}
                  </span>
                  <kbd className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-mono dark:bg-zinc-800">
                    {s.display}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
