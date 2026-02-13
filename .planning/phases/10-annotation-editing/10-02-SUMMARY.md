---
phase: 10-annotation-editing
plan: 02
subsystem: annotation-canvas
tags: [react-konva, konva, canvas, coordinate-utils, bounding-box]
dependency-graph:
  requires: []
  provides:
    - "Coordinate conversion utilities (original pixel space <-> canvas display space)"
    - "EditableRect component with Konva Transformer for drag/resize"
    - "useDrawLayer hook for new bounding box drawing"
    - "ClassPicker dropdown for category assignment"
  affects:
    - "10-03: AnnotationEditor composes these primitives"
tech-stack:
  added: ["react-konva@19.2.2", "konva@10.2.0", "use-image@1.1.4", "uuid@13.0.0"]
  patterns: ["Konva Transformer scale-to-width reset", "custom hook for draw logic"]
key-files:
  created:
    - frontend/src/lib/coord-utils.ts
    - frontend/src/components/detail/editable-rect.tsx
    - frontend/src/components/detail/draw-layer.tsx
    - frontend/src/components/detail/class-picker.tsx
  modified:
    - frontend/package.json
    - frontend/package-lock.json
decisions:
  - key: "useDrawLayer hook pattern"
    choice: "Custom hook returning handlers + ReactNode instead of separate component"
    reason: "Parent Stage composes handlers directly; avoids unnecessary Layer nesting"
  - key: "Transformer scale reset"
    choice: "Reset scaleX/scaleY to 1 on transformEnd, store actual pixel dimensions"
    reason: "Konva best practice -- keeps coordinates in absolute pixels for consistent storage"
metrics:
  duration: "~3 min"
  completed: "2026-02-12"
---

# Phase 10 Plan 02: Konva Canvas Building Blocks Summary

**Konva primitives for annotation editing: coord-utils, EditableRect (drag+resize), useDrawLayer (new box drawing), ClassPicker (category dropdown) -- all compile with zero TS errors**

## What Was Done

### Task 1: Install Konva dependencies and create coordinate utilities
**Commit:** `4605d93`

Installed react-konva 19.2.2 (React 19 compatible), konva 10.2.0, use-image 1.1.4, and uuid 13.0.0. Created `coord-utils.ts` with four pure functions:

- `getScaleFactors(original, display)` -- computes scale ratios
- `toCanvasCoords(bbox, scale)` -- annotation pixel coords to Konva display coords
- `toOriginalCoords(canvasRect, scale)` -- Konva display coords back to pixel space for DuckDB
- `normalizeRect(rect)` -- handles negative width/height from right-to-left drawing

### Task 2: Create EditableRect, DrawLayer, and ClassPicker components
**Commit:** `2d65696`

**EditableRect** (`editable-rect.tsx`):
- Renders a Konva `Rect` that is draggable with `Transformer` when selected
- 8 resize handles, no rotation, 5px minimum size via `boundBoxFunc`
- `onTransformEnd` converts `scaleX`/`scaleY` back to `width`/`height` and resets scale to 1
- `cancelBubble = true` on click/tap prevents Stage deselection

**useDrawLayer** (`draw-layer.tsx`):
- Custom hook returning `{ handlers, previewRect }` for the parent Stage
- `mousedown` starts drawing only on empty Stage area (not on existing shapes)
- `mousemove` updates preview rectangle in real-time
- `mouseup` normalizes negative rects and calls `onDrawComplete` if > 10px in both dimensions
- Preview rect: green dashed stroke with transparent green fill

**ClassPicker** (`class-picker.tsx`):
- Absolute-positioned dropdown with text input for filtering categories
- Colored dots via `getClassColor` for each category row
- Supports creating new categories (type + Enter)
- Dismisses on Escape or click outside via `mousedown` document listener
- Tailwind dark mode support

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass (zero errors) |
| `npm ls react-konva konva use-image uuid` | All four packages installed |
| coord-utils exports | getScaleFactors, toCanvasCoords, toOriginalCoords, normalizeRect |
| Transformer attachment | `trRef.current.nodes([shapeRef.current])` pattern confirmed |
| normalizeRect usage | Called in useDrawLayer mouseup handler |
| ClassPicker filtering | Filter input + new category creation confirmed |

## Next Phase Readiness

Plan 10-03 can now compose these primitives into the full AnnotationEditor component and wire it into the sample modal. All building blocks are ready:
- Coordinate conversion for mapping between DuckDB pixel coords and canvas display
- EditableRect for editing existing annotations
- useDrawLayer for creating new annotations
- ClassPicker for category assignment on new boxes
