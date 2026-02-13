# Phase 13: Keyboard Shortcuts - Research

**Researched:** 2026-02-13
**Domain:** React keyboard event handling, shortcut management, accessibility
**Confidence:** HIGH

## Summary

This phase adds keyboard shortcuts for power-user navigation, triage, and annotation editing in the DataVisor frontend. The codebase currently has zero keyboard shortcut infrastructure -- only two isolated `onKeyDown` handlers exist (class picker Escape/Enter, path input Enter). The native `<dialog>` element already handles Escape for closing the sample modal.

The recommended approach is to use **react-hotkeys-hook** (v5.2.4), the dominant React keyboard shortcut library with 3.4k GitHub stars, 40.9k npm dependents, and confirmed React 19 compatibility (peerDependency `>=16.8.0`). It provides a single `useHotkeys` hook with component scoping, automatic input-field suppression, and conditional enable/disable -- all features directly needed for this phase.

The implementation naturally divides into four scopes: (1) grid-level navigation shortcuts (arrows, j/k, Enter), (2) modal-level navigation and triage shortcuts (arrows, j/k, number keys, h, e, Escape), (3) edit-mode annotation shortcuts (Delete, Ctrl+Z), and (4) a global help overlay triggered by `?`. Each scope maps cleanly to existing components and Zustand store actions. No backend changes are required.

**Primary recommendation:** Use react-hotkeys-hook v5 with `useHotkeys` calls co-located in the components that own the relevant state, with a centralized shortcut registry constant for the help overlay.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-hotkeys-hook | ^5.2.4 | Declarative keyboard shortcut hooks | 3.4k stars, 40.9k dependents, React 19 compatible, MIT, active maintenance (last release 2026-02-02) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zustand | ^5.0.11 (already installed) | State for focusedIndex, helpOverlayOpen | Extends existing ui-store |
| react (built-in) | 19.2.3 (already installed) | useCallback for stable handler refs | Always |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-hotkeys-hook | Custom useKeyboard hook (~60 lines) | Misses: scoped shortcuts, automatic input suppression, modifier combos, `enabled` option. Would need to hand-roll all of these. |
| react-hotkeys-hook | @react-hook/hotkey | Much smaller community (fewer dependents), less documentation |
| react-hotkeys-hook | react-hotkeys (greena13) | Class-component era, not hooks-first, heavier |

**Installation:**
```bash
cd frontend && npm install react-hotkeys-hook
```

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/
├── lib/
│   └── shortcuts.ts           # Central shortcut registry (key combos + labels + groups)
├── hooks/
│   └── use-grid-navigation.ts # Focused index + arrow/j/k navigation for grid
├── components/
│   ├── detail/
│   │   └── sample-modal.tsx   # Add useHotkeys calls for modal-scope shortcuts
│   ├── grid/
│   │   └── image-grid.tsx     # Add useHotkeys calls for grid-scope shortcuts
│   └── toolbar/
│       └── shortcut-help-overlay.tsx  # "?" help overlay component
└── stores/
    └── ui-store.ts            # Add focusedGridIndex, isHelpOverlayOpen
```

### Pattern 1: Co-located useHotkeys in owning component
**What:** Place `useHotkeys` calls directly in the component that owns the relevant state/actions, not in a global provider.
**When to use:** Always. This is the react-hotkeys-hook recommended pattern.
**Example:**
```typescript
// Source: react-hotkeys-hook official docs
import { useHotkeys } from 'react-hotkeys-hook';

function SampleModal({ samples, datasetId }) {
  const selectedSampleId = useUIStore((s) => s.selectedSampleId);
  const openDetailModal = useUIStore((s) => s.openDetailModal);

  // Navigate to next sample in the modal
  useHotkeys('j, ArrowRight', () => {
    const currentIdx = samples.findIndex((s) => s.id === selectedSampleId);
    if (currentIdx < samples.length - 1) {
      openDetailModal(samples[currentIdx + 1].id);
    }
  }, { enabled: isDetailModalOpen }, [selectedSampleId, samples]);

  // ...
}
```

### Pattern 2: Central shortcut registry for help overlay
**What:** A single `shortcuts.ts` file defining all shortcuts as data, consumed by both `useHotkeys` calls and the help overlay display.
**When to use:** Always -- keeps shortcut definitions DRY.
**Example:**
```typescript
// lib/shortcuts.ts
export interface ShortcutDef {
  keys: string;          // react-hotkeys-hook key string
  label: string;         // Human-readable description
  group: 'navigation' | 'triage' | 'editing' | 'general';
}

export const SHORTCUTS: ShortcutDef[] = [
  // Navigation
  { keys: 'ArrowLeft, k',  label: 'Previous sample',          group: 'navigation' },
  { keys: 'ArrowRight, j', label: 'Next sample',              group: 'navigation' },
  { keys: 'ArrowUp',       label: 'Previous row',             group: 'navigation' },
  { keys: 'ArrowDown',     label: 'Next row',                 group: 'navigation' },
  { keys: 'Enter',         label: 'Open selected sample',     group: 'navigation' },
  { keys: 'Escape',        label: 'Close modal / exit mode',  group: 'navigation' },

  // Triage (modal only)
  { keys: '1',             label: 'Tag as TP',                group: 'triage' },
  { keys: '2',             label: 'Tag as FP',                group: 'triage' },
  { keys: '3',             label: 'Tag as FN',                group: 'triage' },
  { keys: '4',             label: 'Tag as Mistake',           group: 'triage' },
  { keys: 'h',             label: 'Toggle highlight mode',    group: 'triage' },

  // Editing (modal + edit mode only)
  { keys: 'e',             label: 'Toggle edit mode',         group: 'editing' },
  { keys: 'Delete, Backspace', label: 'Delete selected annotation', group: 'editing' },
  { keys: 'ctrl+z, meta+z', label: 'Undo last edit',         group: 'editing' },

  // General
  { keys: 'shift+/',       label: 'Show shortcut help',       group: 'general' },
];
```

### Pattern 3: Conditional enable via `enabled` option
**What:** Use the `enabled` option to activate shortcuts only in the correct context (modal open, edit mode active, etc.).
**When to use:** For context-dependent shortcuts (triage keys only when modal is open, delete only when edit mode is active).
**Example:**
```typescript
const isDetailModalOpen = useUIStore((s) => s.isDetailModalOpen);
const isEditMode = useUIStore((s) => s.isEditMode);

// Only active when modal is open AND edit mode is on
useHotkeys('Delete, Backspace', () => {
  if (selectedAnnotationId) {
    deleteMutation.mutate(selectedAnnotationId);
  }
}, { enabled: isDetailModalOpen && isEditMode }, [selectedAnnotationId]);
```

### Pattern 4: Grid focused index with visual indicator
**What:** Track a `focusedGridIndex` in the ui-store separate from the selected/opened sample. Arrow keys and j/k move the focus ring; Enter opens the modal for the focused cell.
**When to use:** Grid view when modal is closed.
**Example:**
```typescript
// In ui-store.ts
interface UIState {
  // ... existing fields
  focusedGridIndex: number | null;
  setFocusedGridIndex: (index: number | null) => void;
}

// In image-grid.tsx
useHotkeys('ArrowRight, j', () => {
  setFocusedGridIndex(Math.min((focusedGridIndex ?? -1) + 1, allSamples.length - 1));
}, { enabled: activeTab === 'grid' && !isDetailModalOpen });

useHotkeys('ArrowDown', () => {
  setFocusedGridIndex(Math.min((focusedGridIndex ?? -1) + columnsPerRow, allSamples.length - 1));
}, { enabled: activeTab === 'grid' && !isDetailModalOpen });

useHotkeys('Enter', () => {
  if (focusedGridIndex !== null && allSamples[focusedGridIndex]) {
    openDetailModal(allSamples[focusedGridIndex].id);
  }
}, { enabled: activeTab === 'grid' && !isDetailModalOpen });
```

### Anti-Patterns to Avoid
- **Global keydown listener in useEffect:** Do not add `window.addEventListener('keydown', ...)` manually. Use `useHotkeys` which handles cleanup, input suppression, and scoping automatically.
- **Shortcuts in layout.tsx or providers:** Do not put all shortcuts in a global provider component. Keep them co-located with the component that owns the action.
- **Hardcoded key strings in multiple places:** Always reference the `SHORTCUTS` registry constant to keep shortcut definitions DRY.
- **Firing shortcuts while typing in inputs:** react-hotkeys-hook suppresses shortcuts in input/textarea/select by default. Do NOT set `enableOnFormTags` unless explicitly needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Keyboard shortcut binding | Custom useEffect + addEventListener | `useHotkeys` from react-hotkeys-hook | Handles cleanup, input suppression, modifier combos, `enabled` toggle, scoping. A custom implementation would need to replicate all of these. |
| Key combo parsing | Manual `e.key === 'k' && e.ctrlKey` checks | react-hotkeys-hook key string syntax (`'ctrl+z'`) | Handles cross-platform modifier differences (Ctrl vs Cmd), key code normalization |
| Shortcut help overlay data | Manual list of strings | Central `SHORTCUTS` registry consumed by both hook calls and overlay | Single source of truth, impossible to forget updating the overlay when shortcuts change |

**Key insight:** The complexity in keyboard shortcuts is not in the event handling itself but in the edge cases: suppressing during text input, handling modifier key differences across OS, cleanup on unmount, and conditional activation based on UI context. react-hotkeys-hook handles all of these.

## Common Pitfalls

### Pitfall 1: Shortcuts firing during text input
**What goes wrong:** User types "j" in the search filter input and accidentally navigates to the next grid cell.
**Why it happens:** Global keyboard listeners do not distinguish between typing and shortcut invocation.
**How to avoid:** react-hotkeys-hook suppresses shortcuts in input/textarea/select by default. Do NOT set `enableOnFormTags` for navigation or triage shortcuts. Only the `?` help shortcut should use `enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT']` if desired.
**Warning signs:** Shortcuts firing when the search input or class picker input is focused.

### Pitfall 2: Conflict with dialog Escape handling
**What goes wrong:** Pressing Escape in the detail modal both closes the dialog (native behavior) and triggers a custom Escape handler, causing double state updates or unexpected behavior.
**Why it happens:** The native `<dialog>` element fires a `cancel` event on Escape, which triggers `onClose`. A separate `useHotkeys('Escape', ...)` also fires.
**How to avoid:** Do NOT register a `useHotkeys('Escape', ...)` for closing the modal. The dialog's native Escape handling already calls `closeDetailModal()` via the `onClose` handler. Only use a custom Escape handler for exiting edit mode or draw mode within the modal, and use `enabled` to gate it to when edit mode is active.
**Warning signs:** Modal closing AND edit mode toggling on a single Escape press.

### Pitfall 3: Stale closure in shortcut callbacks
**What goes wrong:** The shortcut callback references an old value of `selectedSampleId` or `samples`, navigating to the wrong sample.
**Why it happens:** `useHotkeys` captures the callback in a closure. Without the deps array, the callback does not see updated state.
**How to avoid:** Always pass a dependency array as the 4th argument to `useHotkeys`: `useHotkeys('j', callback, options, [selectedSampleId, samples])`. This is equivalent to `useCallback` deps.
**Warning signs:** Navigation shortcuts always jumping to the same sample regardless of current position.

### Pitfall 4: Number keys conflicting with Konva/canvas events
**What goes wrong:** When the annotation editor (react-konva Stage) has focus, number key shortcuts (1-4 for triage) may not propagate correctly, or the Stage may intercept key events.
**Why it happens:** Konva's Stage element may capture keyboard events differently from regular DOM elements.
**How to avoid:** Triage number keys should be registered at the document level (default `useHotkeys` behavior), not scoped to the Stage. Since `useHotkeys` attaches to `document` by default, this works. Ensure triage shortcuts are `enabled` only when `isDetailModalOpen && !isEditMode` (triage tagging during edit mode could be confusing).
**Warning signs:** Number keys working for triage when the annotation editor is not active but failing when it is.

### Pitfall 5: Grid focus index out of bounds after filter change
**What goes wrong:** User focuses grid index 45, then applies a filter that reduces results to 10 items. Index 45 no longer exists.
**Why it happens:** The focusedGridIndex in the store is not reset when the samples array changes.
**How to avoid:** Add a useEffect in the grid component that clamps or resets `focusedGridIndex` when `allSamples.length` changes. Reset to `null` when the grid is not in focus or the tab changes.
**Warning signs:** Visual focus ring disappearing or appearing on a non-existent cell after filtering.

### Pitfall 6: Focus ring not scrolling into view
**What goes wrong:** User presses ArrowDown repeatedly and the focused cell scrolls off-screen but the virtualizer does not scroll to it.
**Why it happens:** The virtualized grid only renders visible rows. The focused cell may not be rendered.
**How to avoid:** After updating `focusedGridIndex`, call `rowVirtualizer.scrollToIndex(Math.floor(newIndex / columnsPerRow))` to ensure the focused row is visible.
**Warning signs:** Pressing arrow keys with no visible response because the focused cell is outside the viewport.

## Code Examples

### Installing react-hotkeys-hook
```bash
# From project root
cd frontend && npm install react-hotkeys-hook
```

### Shortcut Registry (lib/shortcuts.ts)
```typescript
// Source: Custom pattern, verified approach from react-hotkeys-hook docs

export interface ShortcutDef {
  keys: string;
  display: string;  // Human-friendly key label ("J / Right Arrow")
  label: string;    // Action description
  group: 'navigation' | 'triage' | 'editing' | 'general';
  context?: string; // When active ("Grid view", "Modal open", etc.)
}

export const SHORTCUTS: ShortcutDef[] = [
  // -- Navigation --
  { keys: 'j, ArrowRight', display: 'J / \u2192', label: 'Next sample', group: 'navigation', context: 'Grid or Modal' },
  { keys: 'k, ArrowLeft',  display: 'K / \u2190', label: 'Previous sample', group: 'navigation', context: 'Grid or Modal' },
  { keys: 'ArrowDown',     display: '\u2193', label: 'Next row (grid)', group: 'navigation', context: 'Grid view' },
  { keys: 'ArrowUp',       display: '\u2191', label: 'Previous row (grid)', group: 'navigation', context: 'Grid view' },
  { keys: 'Enter',         display: 'Enter', label: 'Open sample detail', group: 'navigation', context: 'Grid view' },
  { keys: 'Escape',        display: 'Esc', label: 'Close modal / exit mode', group: 'navigation', context: 'Modal open' },

  // -- Triage --
  { keys: '1', display: '1', label: 'Tag as TP', group: 'triage', context: 'Modal open' },
  { keys: '2', display: '2', label: 'Tag as FP', group: 'triage', context: 'Modal open' },
  { keys: '3', display: '3', label: 'Tag as FN', group: 'triage', context: 'Modal open' },
  { keys: '4', display: '4', label: 'Tag as Mistake', group: 'triage', context: 'Modal open' },
  { keys: 'h', display: 'H', label: 'Toggle highlight mode', group: 'triage', context: 'Any' },

  // -- Editing --
  { keys: 'e', display: 'E', label: 'Toggle edit mode', group: 'editing', context: 'Modal open' },
  { keys: 'Delete, Backspace', display: 'Del / Backspace', label: 'Delete selected annotation', group: 'editing', context: 'Edit mode' },
  { keys: 'ctrl+z, meta+z', display: 'Ctrl+Z / Cmd+Z', label: 'Undo last edit', group: 'editing', context: 'Edit mode' },

  // -- General --
  { keys: 'shift+/', display: '?', label: 'Show keyboard shortcuts', group: 'general', context: 'Any' },
];
```

### useHotkeys in SampleModal (modal-scope shortcuts)
```typescript
// Source: react-hotkeys-hook v5 API (verified from official docs)
import { useHotkeys } from 'react-hotkeys-hook';
import { TRIAGE_OPTIONS } from '@/types/triage';

// Inside SampleModal component:

// -- Next/Prev sample navigation (modal) --
useHotkeys('j, ArrowRight', () => {
  const idx = samples.findIndex((s) => s.id === selectedSampleId);
  if (idx >= 0 && idx < samples.length - 1) {
    openDetailModal(samples[idx + 1].id);
  }
}, { enabled: isDetailModalOpen, preventDefault: true }, [selectedSampleId, samples]);

useHotkeys('k, ArrowLeft', () => {
  const idx = samples.findIndex((s) => s.id === selectedSampleId);
  if (idx > 0) {
    openDetailModal(samples[idx - 1].id);
  }
}, { enabled: isDetailModalOpen, preventDefault: true }, [selectedSampleId, samples]);

// -- Triage number keys --
TRIAGE_OPTIONS.forEach((opt, i) => {
  useHotkeys(String(i + 1), () => {
    if (sample) {
      const activeTag = sample.tags?.find((t) => t.startsWith('triage:')) ?? null;
      if (activeTag === opt.tag) {
        removeTriageTag.mutate({ dataset_id: datasetId, sample_id: sample.id });
      } else {
        setTriageTag.mutate({ dataset_id: datasetId, sample_id: sample.id, tag: opt.tag });
      }
    }
  }, { enabled: isDetailModalOpen }, [sample, datasetId]);
});

// -- Highlight toggle --
useHotkeys('h', () => {
  toggleHighlightMode();
}, { enabled: isDetailModalOpen });

// -- Edit mode toggle --
useHotkeys('e', () => {
  toggleEditMode();
}, { enabled: isDetailModalOpen });

// -- Delete annotation (edit mode only) --
useHotkeys('Delete, Backspace', () => {
  if (selectedAnnotationId) {
    deleteMutation.mutate(selectedAnnotationId);
    setSelectedAnnotationId(null);
  }
}, { enabled: isDetailModalOpen && isEditMode }, [selectedAnnotationId]);
```

### Grid Navigation Hook (hooks/use-grid-navigation.ts)
```typescript
import { useHotkeys } from 'react-hotkeys-hook';
import { useUIStore } from '@/stores/ui-store';
import type { Sample } from '@/types/sample';

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

  const enabled = activeTab === 'grid' && !isModalOpen;
  const maxIdx = samples.length - 1;

  function moveTo(newIdx: number) {
    const clamped = Math.max(0, Math.min(newIdx, maxIdx));
    setFocusedGridIndex(clamped);
    scrollToRow(Math.floor(clamped / columnsPerRow));
  }

  useHotkeys('j, ArrowRight', () => moveTo((focusedGridIndex ?? -1) + 1),
    { enabled, preventDefault: true }, [focusedGridIndex, maxIdx]);

  useHotkeys('k, ArrowLeft', () => moveTo((focusedGridIndex ?? 0) - 1),
    { enabled, preventDefault: true }, [focusedGridIndex, maxIdx]);

  useHotkeys('ArrowDown', () => moveTo((focusedGridIndex ?? -columnsPerRow) + columnsPerRow),
    { enabled, preventDefault: true }, [focusedGridIndex, maxIdx, columnsPerRow]);

  useHotkeys('ArrowUp', () => moveTo((focusedGridIndex ?? columnsPerRow) - columnsPerRow),
    { enabled, preventDefault: true }, [focusedGridIndex, maxIdx, columnsPerRow]);

  useHotkeys('Enter', () => {
    if (focusedGridIndex !== null && samples[focusedGridIndex]) {
      openDetailModal(samples[focusedGridIndex].id);
    }
  }, { enabled }, [focusedGridIndex, samples]);
}
```

### Help Overlay Component
```typescript
// components/toolbar/shortcut-help-overlay.tsx
import { useHotkeys } from 'react-hotkeys-hook';
import { SHORTCUTS } from '@/lib/shortcuts';
import { useUIStore } from '@/stores/ui-store';

export function ShortcutHelpOverlay() {
  const isOpen = useUIStore((s) => s.isHelpOverlayOpen);
  const toggleHelp = useUIStore((s) => s.toggleHelpOverlay);

  useHotkeys('shift+/', () => toggleHelp(), { preventDefault: true });
  useHotkeys('Escape', () => { if (isOpen) toggleHelp(); }, { enabled: isOpen });

  if (!isOpen) return null;

  const groups = Object.groupBy(SHORTCUTS, (s) => s.group);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
         onClick={toggleHelp}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900"
           onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">Keyboard Shortcuts</h2>
        {Object.entries(groups).map(([group, shortcuts]) => (
          <div key={group} className="mb-4">
            <h3 className="mb-2 text-sm font-medium capitalize text-zinc-500">{group}</h3>
            <div className="space-y-1">
              {shortcuts?.map((s) => (
                <div key={s.keys} className="flex items-center justify-between py-1">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{s.label}</span>
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
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-hotkeys (class components, HotkeyMap objects) | react-hotkeys-hook v5 (single useHotkeys hook) | 2022+ | Simpler API, hooks-native, smaller bundle |
| Manual useEffect + addEventListener | useHotkeys with enabled/scoping | 2020+ | Automatic cleanup, input suppression, cross-platform modifier handling |
| Separate shortcut overlay library | Data-driven overlay from same shortcut registry | Current standard | Single source of truth, no sync issues |

**Deprecated/outdated:**
- `react-hotkeys` by greena13: Last meaningful update was 2020. Class-component era API.
- `hotkeys-js` directly: Works but no React lifecycle integration, requires manual cleanup.

## Open Questions

1. **Undo (Ctrl+Z) for annotation edits**
   - What we know: The requirement mentions Ctrl+Z for undoing edits. Currently, annotation mutations go directly to the backend via TanStack Query mutations (update, create, delete).
   - What's unclear: There is no client-side undo stack. Implementing true undo requires either (a) an optimistic update rollback pattern with TanStack Query, or (b) a backend undo endpoint, or (c) a client-side command history stack that replays reverse mutations.
   - Recommendation: Simplest viable approach is a client-side undo stack that stores the last N mutation inverses (e.g., "delete annotation X" has inverse "create annotation with X's data"). Limit to the last action only for v1. Flag this as a task that needs careful scoping during planning.

2. **Modal prev/next auto-advance after triage**
   - What we know: Power users triaging will want to tag a sample and immediately advance to the next one.
   - What's unclear: Whether auto-advance should be the default or require a separate shortcut.
   - Recommendation: Do NOT auto-advance by default. Let the user press j/ArrowRight after tagging. This is safer and more predictable.

3. **Object.groupBy browser support**
   - What we know: `Object.groupBy` is used in the help overlay code example above. It is available in all modern browsers (Chrome 117+, Firefox 119+, Safari 17.4+).
   - What's unclear: Whether the project's TypeScript config includes `es2024` lib (which adds the type).
   - Recommendation: If TypeScript complains, use a simple `reduce` instead or add `es2024` to tsconfig lib.

## Sources

### Primary (HIGH confidence)
- [react-hotkeys-hook GitHub](https://github.com/JohannesKlauss/react-hotkeys-hook) - v5.2.4, peer deps, React 19 compat
- [react-hotkeys-hook official docs](https://react-hotkeys-hook.vercel.app/) - useHotkeys API, scoping, options
- [react-hotkeys-hook useHotkeys API](https://react-hotkeys-hook.vercel.app/docs/api/use-hotkeys) - Full parameter docs, TypeScript types
- Codebase analysis: ui-store.ts, sample-modal.tsx, image-grid.tsx, triage-tag-buttons.tsx, annotation-editor.tsx, filter-store.ts, types/triage.ts

### Secondary (MEDIUM confidence)
- [MDN <dialog> element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) - Native Escape handling behavior
- [Keyboard-navigable JS widgets (MDN)](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Keyboard-navigable_JavaScript_widgets) - tabindex patterns for grid navigation

### Tertiary (LOW confidence)
- WebSearch results for React keyboard shortcut patterns (community patterns, not verified against specific versions)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - react-hotkeys-hook v5 confirmed via GitHub, npm, official docs. React 19 peer dep verified.
- Architecture: HIGH - Patterns derived from existing codebase structure + react-hotkeys-hook official docs. All hooks map directly to existing components and store actions.
- Pitfalls: HIGH - Pitfalls identified from direct codebase analysis (dialog Escape conflict, Konva Stage events, virtualized grid scroll, stale closures) and library documentation (input suppression default).
- Undo implementation: LOW - No existing undo infrastructure; approach is recommended but not verified against codebase complexity.

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (30 days -- stable domain, no fast-moving dependencies)
