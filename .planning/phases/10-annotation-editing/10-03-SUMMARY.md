---
phase: 10-annotation-editing
plan: 03
subsystem: annotation-editor-integration
tags: [react-konva, zustand, dynamic-import, annotation-editing, crud]

dependency_graph:
  requires: ["10-01", "10-02"]
  provides: ["End-to-end annotation editing in sample detail modal"]
  affects: ["11-error-triage"]

tech_stack:
  added: []
  patterns: ["dynamic import for SSR-safe Konva", "Zustand edit mode state", "conditional canvas/SVG rendering"]

key_files:
  created:
    - frontend/src/components/detail/annotation-editor.tsx
  modified:
    - frontend/src/stores/ui-store.ts
    - frontend/src/components/detail/sample-modal.tsx
    - frontend/src/components/detail/annotation-list.tsx

decisions:
  - id: "10-03-dynamic-import"
    description: "AnnotationEditor loaded via next/dynamic with ssr:false to avoid Konva SSR errors"
  - id: "10-03-class-picker-on-draw"
    description: "Draw completion shows ClassPicker before creating annotation (requires category selection)"
  - id: "10-03-delete-in-edit-mode"
    description: "Delete buttons only appear on ground_truth rows when edit mode is active"

metrics:
  duration: "3 min"
  completed: "2026-02-12"
---

# Phase 10 Plan 03: AnnotationEditor Integration Summary

Composed the AnnotationEditor from Konva building blocks (Plan 02), wired it into the sample detail modal with edit mode toggle, connected mutation hooks (Plan 01) for DuckDB persistence, and added delete buttons to the annotation list.

## What Was Done

### Task 1: Extend UI store and build AnnotationEditor composition component

**UI Store Extensions (ui-store.ts):**
- Added `isEditMode` (boolean), `selectedAnnotationId` (string | null), `isDrawMode` (boolean)
- Added `toggleEditMode()` -- resets selection and draw mode when turning OFF
- Added `setSelectedAnnotationId()` and `toggleDrawMode()` -- draw mode deselects any selected annotation
- `closeDetailModal()` now also resets all edit state

**AnnotationEditor Component (annotation-editor.tsx):**
- Konva Stage with two layers: background image + annotations
- Uses `useImage` for async image loading with spinner
- ResizeObserver tracks container width for responsive aspect-ratio-preserving display
- Ground-truth boxes rendered as `EditableRect` (draggable, resizable with Transformer)
- Prediction boxes rendered as dashed `Rect` with `listening={false}` (non-interactive)
- Draw layer via `useDrawLayer` hook with crosshair cursor in draw mode
- ClassPicker popup appears after drawing a new box for category assignment
- All coordinates converted between canvas display space and original pixel space via `coord-utils`

### Task 2: Wire AnnotationEditor into sample modal and add delete to annotation list

**Sample Modal Integration (sample-modal.tsx):**
- AnnotationEditor loaded via `next/dynamic` with `ssr: false` (prevents Konva SSR errors)
- Edit toolbar between image and metadata: Edit/Done toggle + Draw New Box button
- Conditional rendering: Konva canvas in edit mode, SVG overlay in view mode
- Mutation hooks connected: `useUpdateAnnotation` (drag/resize), `useCreateAnnotation` (draw), `useDeleteAnnotation` (delete)
- Categories fetched from `useFilterFacets` for the class picker dropdown
- Annotations split by source: ground_truth (editable) vs predictions (read-only)

**Annotation List Enhancement (annotation-list.tsx):**
- Added optional `onDelete` prop
- Actions column with delete X button appears only when `onDelete` provided (edit mode)
- Delete button only on `ground_truth` rows; prediction rows show em-dash
- Red styling with hover state for delete button

## ANNOT Requirements Coverage

| Requirement | Description | Implementation |
|-------------|-------------|----------------|
| ANNOT-01 | Drag GT box to reposition | EditableRect `onDragEnd` -> `toOriginalCoords` -> PUT `/annotations/{id}` |
| ANNOT-02 | Resize GT box via handles | EditableRect `onTransformEnd` -> `toOriginalCoords` -> PUT `/annotations/{id}` |
| ANNOT-03 | Delete annotation | AnnotationList delete button -> DELETE `/annotations/{id}` |
| ANNOT-04 | Draw new box + pick class | useDrawLayer -> ClassPicker -> POST `/annotations` |
| ANNOT-05 | Predictions non-interactive | Dashed Rect with `listening={false}`, no Transformer, no delete button |

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- `npx tsc --noEmit` passes
- `npm run build` succeeds (no SSR issues with dynamic Konva import)
- All ANNOT requirements satisfied by the component wiring

## Next Phase Readiness

Phase 10 (Annotation Editing) is complete. All 3 plans delivered:
- Plan 01: Backend CRUD endpoints + frontend mutation hooks
- Plan 02: Konva building blocks (EditableRect, DrawLayer, ClassPicker, coord-utils)
- Plan 03: Integration into sample modal with full end-to-end editing

Ready for Phase 11 (Error Triage).
