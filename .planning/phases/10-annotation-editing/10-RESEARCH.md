# Phase 10: Annotation Editing - Research

**Researched:** 2026-02-12
**Domain:** Canvas-based bounding box CRUD with react-konva + FastAPI/DuckDB persistence
**Confidence:** HIGH

## Summary

Phase 10 adds bounding box editing (move, resize, delete, draw) to the sample detail modal using react-konva for the canvas layer while keeping the existing SVG overlay for the grid. The backend needs CRUD endpoints for annotations in DuckDB (currently read-only). The frontend requires replacing the detail modal's image+SVG rendering with a react-konva Stage when in edit mode, plus coordinate conversion utilities to bridge the SVG (original pixel space) and Canvas (display pixel space) coordinate systems.

The locked decision to use react-konva is well-supported: react-konva v19.2.2 is current, supports React 19 (the project uses React 19.2.3), and provides built-in `Transformer` for select/resize and Stage-level mouse events for drawing new boxes. The Konva library handles canvas rendering performantly, and the Transformer component provides drag handles, resize constraints, and bounding box enforcement out of the box.

**Primary recommendation:** Build a Konva-based `AnnotationEditor` component that replaces the SVG overlay in the detail modal when edit mode is active. Use Konva's Transformer for selection/resize, Stage mouse events for drawing new boxes, and sync state to DuckDB on each completed action via REST endpoints.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-konva | 19.2.2 | React bindings for Konva canvas | Official React adapter for Konva; v19 line supports React 19 |
| konva | 10.x | 2D canvas rendering engine | Underlying engine; react-konva 19.x supports konva 10 |
| use-image | 1.1.4 | React hook for loading images into Konva | Official Konva companion; handles image loading states |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tanstack/react-query | 5.90.x (existing) | Server state + mutation | Already used; add useMutation for annotation CRUD |
| zustand | 5.x (existing) | Edit mode UI state | Already used; extend ui-store or create edit-store |
| uuid | 11.x | Generate annotation IDs | ID generation for new annotations client-side |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-konva | fabric.js | More opinionated but heavier; react-konva is the locked decision |
| use-image hook | Manual Image() constructor | use-image handles loading/error states declaratively |
| uuid for IDs | nanoid | Either works; uuid matches existing ID patterns in codebase |

**Installation:**
```bash
cd frontend && npm install react-konva konva use-image uuid && npm install -D @types/uuid
```

Note: `use-image` has no `@types` package needed (ships its own types).

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/
  components/detail/
    sample-modal.tsx          # Modified: conditionally renders editor vs SVG
    annotation-list.tsx       # Modified: add delete button, highlight selected
    annotation-editor.tsx     # NEW: Konva Stage + Image + editable Rects
    editable-rect.tsx         # NEW: Single Rect with Transformer attachment
    draw-layer.tsx            # NEW: Stage mouse handlers for drawing new boxes
    class-picker.tsx          # NEW: Dropdown to assign class to new annotation
  hooks/
    use-annotations.ts        # Modified: add mutation hooks (create, update, delete)
  lib/
    coord-utils.ts            # NEW: SVG<->Canvas coordinate conversion utilities
  types/
    annotation.ts             # Modified: add mutation request types
  stores/
    ui-store.ts               # Modified: add isEditMode, selectedAnnotationId

app/
  routers/
    annotations.py            # NEW: dedicated annotation CRUD router
  models/
    annotation.py             # Modified: add Create/Update request models
```

### Pattern 1: Dual-Mode Rendering (View vs Edit)
**What:** The detail modal renders either the existing SVG overlay (view mode) or a Konva canvas (edit mode), controlled by a toggle button.
**When to use:** Always -- the edit canvas replaces the SVG overlay, never coexists with it.
**Example:**
```typescript
// In sample-modal.tsx
{isEditMode ? (
  <AnnotationEditor
    imageUrl={fullImageUrl(datasetId, sample.id)}
    annotations={annotations.filter(a => a.source === "ground_truth")}
    predictionAnnotations={annotations.filter(a => a.source !== "ground_truth")}
    imageWidth={sample.width}
    imageHeight={sample.height}
    onUpdate={handleUpdate}
    onCreate={handleCreate}
    onDelete={handleDelete}
  />
) : (
  <>
    <img src={fullImageUrl(datasetId, sample.id)} ... />
    <AnnotationOverlay annotations={annotations} ... />
  </>
)}
```

### Pattern 2: Coordinate Space Conversion
**What:** The existing SVG overlay uses original image pixel coordinates (viewBox maps them automatically). Konva operates in display pixel space (Stage width/height). Annotations in DuckDB are stored in original pixel coordinates. A conversion utility bridges these spaces.
**When to use:** Any time coordinates move between Konva canvas and DuckDB storage.
**Example:**
```typescript
// coord-utils.ts
export interface ScaleFactors {
  scaleX: number; // displayWidth / originalWidth
  scaleY: number; // displayHeight / originalHeight
}

export function getScaleFactors(
  originalWidth: number,
  originalHeight: number,
  displayWidth: number,
  displayHeight: number,
): ScaleFactors {
  return {
    scaleX: displayWidth / originalWidth,
    scaleY: displayHeight / originalHeight,
  };
}

/** Convert annotation coords (original pixel space) to canvas display coords */
export function toCanvasCoords(
  bbox: { x: number; y: number; w: number; h: number },
  scale: ScaleFactors,
) {
  return {
    x: bbox.x * scale.scaleX,
    y: bbox.y * scale.scaleY,
    width: bbox.w * scale.scaleX,
    height: bbox.h * scale.scaleY,
  };
}

/** Convert canvas display coords back to original pixel space for storage */
export function toOriginalCoords(
  canvasRect: { x: number; y: number; width: number; height: number },
  scale: ScaleFactors,
) {
  return {
    bbox_x: canvasRect.x / scale.scaleX,
    bbox_y: canvasRect.y / scale.scaleY,
    bbox_w: canvasRect.width / scale.scaleX,
    bbox_h: canvasRect.height / scale.scaleY,
  };
}
```

### Pattern 3: Konva Transformer for Select/Resize
**What:** Each editable Rect gets a Transformer attached via useRef + useEffect when selected. The Transformer provides 8 resize handles. On transformEnd, scaleX/scaleY are converted back to width/height.
**When to use:** For ANNOT-01 (move) and ANNOT-02 (resize).
**Example:**
```typescript
// editable-rect.tsx
// Source: https://konvajs.org/docs/react/Transformer.html
function EditableRect({ shapeProps, isSelected, onSelect, onChange }) {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  return (
    <>
      <Rect
        ref={shapeRef}
        {...shapeProps}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          onChange({ ...shapeProps, x: e.target.x(), y: e.target.y() });
        }}
        onTransformEnd={() => {
          const node = shapeRef.current!;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          // Reset scale, apply to width/height
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...shapeProps,
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(5, node.height() * scaleY),
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          flipEnabled={false}
          rotateEnabled={false}
          boundBoxFunc={(oldBox, newBox) => {
            // Minimum 5px in canvas space
            if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
}
```

### Pattern 4: Drawing New Rectangles via Stage Events
**What:** In "draw mode," mousedown on the Stage records the start point, mousemove updates a preview rectangle, and mouseup finalizes the new annotation and prompts for class assignment.
**When to use:** For ANNOT-04 (draw new bounding box).
**Example:**
```typescript
// Simplified draw-layer pattern
const [isDrawing, setIsDrawing] = useState(false);
const [newRect, setNewRect] = useState<{x:number,y:number,width:number,height:number}|null>(null);

// On the Stage:
onMouseDown={(e) => {
  if (drawMode && e.target === e.target.getStage()) {
    const pos = e.target.getStage()!.getPointerPosition()!;
    setNewRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    setIsDrawing(true);
  }
}}
onMouseMove={(e) => {
  if (!isDrawing || !newRect) return;
  const pos = e.target.getStage()!.getPointerPosition()!;
  setNewRect({
    ...newRect,
    width: pos.x - newRect.x,
    height: pos.y - newRect.y,
  });
}}
onMouseUp={() => {
  if (isDrawing && newRect && Math.abs(newRect.width) > 5 && Math.abs(newRect.height) > 5) {
    // Normalize negative width/height (drag left or up)
    const normalized = normalizeRect(newRect);
    // Show class picker, then create annotation
    openClassPicker(normalized);
  }
  setIsDrawing(false);
}}
```

### Pattern 5: State Sync on Action End Only
**What:** During drag/resize, let Konva handle the visual updates imperatively. Only sync to React state (and trigger API calls) on `onDragEnd` / `onTransformEnd`. This keeps re-renders out of the 60fps render path.
**When to use:** Always -- this is the production-grade pattern for Konva editors.
**Example:** See Pattern 3 above where onChange is called only in onDragEnd/onTransformEnd, not during the continuous events.

### Anti-Patterns to Avoid
- **Rendering SVG and Canvas simultaneously for the same annotations:** The SVG overlay and Konva canvas should never coexist on the same image in the modal. Toggle between them.
- **Updating React state during onDragMove/onTransform:** This causes 60fps re-renders and jitter. Only update on End events.
- **Using Konva Transformer scaleX/scaleY as stored values:** Transformer changes scaleX/scaleY, not width/height. Always convert back to width/height on transformEnd and reset scale to 1.
- **Forgetting to account for aspect-ratio-preserving image fit:** When the display container has a different aspect ratio than the image, the image may letterbox. The coordinate conversion must account for the actual rendered image position and size, not just the container size.
- **Making edit controls visible on prediction annotations:** ANNOT-05 requires predictions to be read-only. Render prediction boxes without draggable/Transformer, using a different visual style (dashed, non-interactive).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resize handles on rectangles | Custom corner-drag logic | Konva Transformer | Handles 8 anchors, min-size constraints, rotation lock, and edge cases |
| Image loading for canvas | Manual `new Image()` + onload | `use-image` hook | Handles loading/error states, caching, CORS crossOrigin |
| Canvas hit detection | Manual point-in-rect math | Konva's built-in event system | Handles overlapping shapes, layer ordering, event bubbling |
| Bounding box constraints | Manual clamping on every move | `boundBoxFunc` on Transformer | Called by Konva before applying transform, prevents invalid states |
| Drag area constraints | Manual position clamping | `dragBoundFunc` on shapes | Called by Konva during drag loop, no jitter |
| UUID generation | Custom ID format | `uuid` or `crypto.randomUUID()` | Standard, collision-free |

**Key insight:** Konva's Transformer handles the hardest part of annotation editing (drag handles, resize, hit detection, z-ordering). The engineering effort should focus on coordinate conversion, state management, and API integration -- not the canvas interaction layer.

## Common Pitfalls

### Pitfall 1: Transformer Scale vs. Width/Height Confusion
**What goes wrong:** After resize, the Rect has `scaleX: 1.5, width: 100` instead of `scaleX: 1, width: 150`. If you read `width()` without accounting for scale, stored coordinates are wrong.
**Why it happens:** Konva's Transformer modifies scaleX/scaleY, not width/height directly.
**How to avoid:** On every `onTransformEnd`, read node.scaleX()/scaleY(), multiply into width/height, then reset scale to 1.
**Warning signs:** Annotations appear at wrong sizes when reloaded, or compound scaling on each edit.

### Pitfall 2: Image Fit Offset Not Accounted For
**What goes wrong:** Annotations are offset from their correct position because the image doesn't fill the entire Stage (letterboxing or pillarboxing due to aspect ratio mismatch).
**Why it happens:** The Stage fills the container but the image may be smaller in one dimension. Click coordinates are relative to Stage, not to the image.
**How to avoid:** Calculate the actual rendered image offset and size within the Stage. Either: (a) scale the Stage to exactly match the image aspect ratio, or (b) offset all coordinate calculations by the image's rendered position. Approach (a) is simpler -- size the Stage to the image's display dimensions.
**Warning signs:** Annotations work correctly for square images but are offset for wide or tall images.

### Pitfall 3: Negative Width/Height During Drawing
**What goes wrong:** Drawing from bottom-right to top-left creates rectangles with negative width/height, which Konva renders but DuckDB stores as negative values, causing downstream issues.
**Why it happens:** mouseMove position minus mouseDown position can be negative.
**How to avoid:** Normalize the rectangle before saving -- swap x/y and negate width/height when negative.
**Warning signs:** Some drawn annotations don't appear after save/reload, or appear in unexpected positions.

### Pitfall 4: React Query Cache Stale After Mutation
**What goes wrong:** After creating/updating/deleting an annotation, the detail modal still shows old data because the annotation query cache is stale.
**Why it happens:** TanStack Query caches results and won't refetch automatically after mutations.
**How to avoid:** Use `queryClient.invalidateQueries({ queryKey: ["annotations", sampleId] })` in the mutation's `onSuccess` callback. Also invalidate `["annotations-batch"]` and `["filter-facets"]` since annotation counts change.
**Warning signs:** User has to close and reopen the modal to see their edits.

### Pitfall 5: Event Propagation Between Konva and React
**What goes wrong:** Clicking a Konva shape also triggers the Stage's click handler (deselecting), or Konva events bubble up to React DOM handlers (closing the modal).
**Why it happens:** Konva has its own event system separate from DOM events. `e.cancelBubble = true` is the Konva way to stop propagation, not `e.stopPropagation()`.
**How to avoid:** Use `e.cancelBubble = true` on shape click handlers to prevent Stage deselection. The `onClick={(e) => e.stopPropagation()}` on the modal content div already prevents modal close on inner clicks.
**Warning signs:** Clicking a bounding box deselects it immediately, or clicking inside the canvas closes the modal.

### Pitfall 6: Forgetting to Recalculate Area on Move/Resize
**What goes wrong:** The `area` field in the annotations table becomes stale after a move or resize.
**Why it happens:** Area is stored in DuckDB but not recalculated client-side after edits.
**How to avoid:** Recalculate `area = bbox_w * bbox_h` before sending to the backend. The backend update endpoint should also compute it server-side as a safety net.
**Warning signs:** Statistics dashboard shows incorrect area distributions after editing.

## Code Examples

### Backend: Annotation CRUD Endpoints
```python
# annotations.py router
# Source: Follows existing pattern from app/routers/samples.py

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from app.dependencies import get_db
from app.repositories.duckdb_repo import DuckDBRepo
import uuid

router = APIRouter(prefix="/annotations", tags=["annotations"])

class AnnotationUpdate(BaseModel):
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float

class AnnotationCreate(BaseModel):
    dataset_id: str
    sample_id: str
    category_name: str
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float

@router.put("/{annotation_id}")
def update_annotation(
    annotation_id: str,
    body: AnnotationUpdate,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Update bounding box position/size for a ground_truth annotation."""
    area = body.bbox_w * body.bbox_h
    cursor = db.connection.cursor()
    try:
        result = cursor.execute(
            "UPDATE annotations SET bbox_x=?, bbox_y=?, bbox_w=?, bbox_h=?, area=? "
            "WHERE id=? AND source='ground_truth' RETURNING id",
            [body.bbox_x, body.bbox_y, body.bbox_w, body.bbox_h, area, annotation_id],
        ).fetchone()
    finally:
        cursor.close()
    if not result:
        raise HTTPException(404, "Annotation not found or not editable")
    return {"updated": annotation_id}

@router.post("")
def create_annotation(
    body: AnnotationCreate,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Create a new ground_truth annotation."""
    ann_id = str(uuid.uuid4())
    area = body.bbox_w * body.bbox_h
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            "INSERT INTO annotations (id, dataset_id, sample_id, category_name, "
            "bbox_x, bbox_y, bbox_w, bbox_h, area, source) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ground_truth')",
            [ann_id, body.dataset_id, body.sample_id, body.category_name,
             body.bbox_x, body.bbox_y, body.bbox_w, body.bbox_h, area],
        )
    finally:
        cursor.close()
    return {"id": ann_id}

@router.delete("/{annotation_id}")
def delete_annotation(
    annotation_id: str,
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Delete a ground_truth annotation."""
    cursor = db.connection.cursor()
    try:
        result = cursor.execute(
            "DELETE FROM annotations WHERE id=? AND source='ground_truth' RETURNING id",
            [annotation_id],
        ).fetchone()
    finally:
        cursor.close()
    if not result:
        raise HTTPException(404, "Annotation not found or not editable")
    return {"deleted": annotation_id}
```

### Frontend: Annotation Editor Konva Stage
```typescript
// annotation-editor.tsx (simplified)
// Source: https://konvajs.org/docs/react/Transformer.html + coord-utils pattern
import { Stage, Layer, Image, Rect } from "react-konva";
import useImage from "use-image";

interface AnnotationEditorProps {
  imageUrl: string;
  annotations: Annotation[];        // ground_truth only
  predictions: Annotation[];        // read-only predictions
  imageWidth: number;               // original pixel width
  imageHeight: number;              // original pixel height
  containerWidth: number;           // display container width
  onUpdate: (id: string, bbox: BBoxUpdate) => void;
  onCreate: (bbox: BBoxCreate) => void;
  onDelete: (id: string) => void;
}

export function AnnotationEditor(props: AnnotationEditorProps) {
  const [image] = useImage(props.imageUrl, "anonymous");

  // Calculate display dimensions preserving aspect ratio
  const aspectRatio = props.imageWidth / props.imageHeight;
  const displayWidth = props.containerWidth;
  const displayHeight = displayWidth / aspectRatio;

  const scale = getScaleFactors(
    props.imageWidth, props.imageHeight,
    displayWidth, displayHeight,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <Stage
      width={displayWidth}
      height={displayHeight}
      onMouseDown={(e) => {
        // Deselect when clicking empty area
        if (e.target === e.target.getStage()) {
          setSelectedId(null);
        }
      }}
    >
      <Layer>
        {/* Background image */}
        <Image image={image} width={displayWidth} height={displayHeight} />
      </Layer>
      <Layer>
        {/* Read-only prediction boxes (dashed, non-interactive) */}
        {props.predictions.map((ann) => {
          const c = toCanvasCoords(ann, scale);
          return (
            <Rect key={ann.id} {...c}
              stroke={getSourceColor(ann.source)}
              strokeWidth={2} dash={[8, 4]}
              fill="transparent" listening={false}
            />
          );
        })}
        {/* Editable ground truth boxes */}
        {props.annotations.map((ann) => (
          <EditableRect
            key={ann.id}
            shapeProps={toCanvasCoords(ann, scale)}
            isSelected={selectedId === ann.id}
            onSelect={() => setSelectedId(ann.id)}
            onChange={(newAttrs) => {
              const original = toOriginalCoords(newAttrs, scale);
              props.onUpdate(ann.id, original);
            }}
          />
        ))}
      </Layer>
    </Stage>
  );
}
```

### Frontend: Mutation Hooks
```typescript
// In use-annotations.ts -- add these alongside existing query hooks
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPatch, apiPost, apiDelete } from "@/lib/api";

export function useUpdateAnnotation(datasetId: string, sampleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...bbox }: { id: string } & AnnotationUpdate) =>
      apiPatch(`/annotations/${id}`, bbox),  // or apiPut
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations", sampleId] });
      qc.invalidateQueries({ queryKey: ["annotations-batch"] });
    },
  });
}

export function useCreateAnnotation(datasetId: string, sampleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AnnotationCreate) =>
      apiPost("/annotations", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations", sampleId] });
      qc.invalidateQueries({ queryKey: ["annotations-batch"] });
      qc.invalidateQueries({ queryKey: ["filter-facets", datasetId] });
    },
  });
}

export function useDeleteAnnotation(datasetId: string, sampleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/annotations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annotations", sampleId] });
      qc.invalidateQueries({ queryKey: ["annotations-batch"] });
      qc.invalidateQueries({ queryKey: ["filter-facets", datasetId] });
    },
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| react-konva 18.x | react-konva 19.2.2 | 2025 | React 19 support, vitest migration, render effect fixes |
| Manual Transformer attachment | Same (still manual useRef+useEffect) | Ongoing | No pure declarative Transformer yet; manual approach is documented standard |
| canvas 2D API + manual hit detection | Konva's declarative shape system | Established | No reason to go lower-level; Konva abstracts canvas well |

**Deprecated/outdated:**
- **react-konva 18.x:** Only works with React 18, not React 19. Must use 19.x line.
- **react-konva-utils:** Older helper package; check compatibility before using. Most utilities (Portal, Html) are edge cases not needed for this phase.

## Open Questions

Things that couldn't be fully resolved:

1. **PUT vs PATCH for annotation updates**
   - What we know: The codebase uses both PATCH (bulk-tag) and PUT would be standard for full-resource replacement. The update only changes bbox fields, not all annotation fields.
   - What's unclear: Whether PUT or PATCH better fits the project's conventions for a partial update.
   - Recommendation: Use PUT since we're providing the complete bbox (all 4 fields), making it a full replacement of the mutable portion. Matches RESTful semantics.

2. **Optimistic updates vs. server-round-trip**
   - What we know: TanStack Query supports optimistic updates via `onMutate`. The annotation data is simple enough for optimistic updates. Latency to localhost is negligible.
   - What's unclear: Whether optimistic updates add unnecessary complexity for a local-first tool.
   - Recommendation: Skip optimistic updates. Use simple invalidation on success. The user is operating locally (or on a single VM), so round-trip latency is minimal. This keeps the code simpler.

3. **Undo/redo support**
   - What we know: Phase 13 includes Ctrl+Z for annotation editing. This phase (10) doesn't list it explicitly.
   - What's unclear: Whether to build undo infrastructure now or defer entirely to Phase 13.
   - Recommendation: Defer undo to Phase 13. Phase 10 focuses on the CRUD operations themselves. Note: if undo is needed later, consider adding an edit history stack (array of {action, before, after} objects) in the edit store.

4. **Dataset annotation_count/category_count update after edits**
   - What we know: The datasets table tracks `annotation_count` and `category_count`. Creating or deleting annotations changes these.
   - What's unclear: Whether to update these counts on every edit or recalculate on demand.
   - Recommendation: Update `annotation_count` via SQL increment/decrement on create/delete. For `category_count`, recalculate with a COUNT(DISTINCT category_name) query since a new annotation might introduce a new category.

## Sources

### Primary (HIGH confidence)
- [Konva Transformer docs](https://konvajs.org/docs/react/Transformer.html) -- official React Transformer pattern with useRef/useEffect
- [Konva Resize Limits](https://konvajs.org/docs/select_and_transform/Resize_Limits.html) -- boundBoxFunc for minimum size constraints
- [Konva Transform Events](https://konvajs.org/docs/select_and_transform/Transform_Events.html) -- transformstart/transform/transformend event API
- [Konva Basic Select/Transform](https://konvajs.org/docs/select_and_transform/Basic_demo.html) -- multi-select with Transformer attachment
- [Konva Limited Drag and Resize](https://konvajs.org/docs/sandbox/Limited_Drag_And_Resize.html) -- confining shapes to Stage bounds
- [Konva Scale Image to Fit](https://konvajs.org/docs/sandbox/Scale_Image_To_Fit.html) -- image fitting with aspect ratio preservation
- [react-konva GitHub releases](https://github.com/konvajs/react-konva/releases) -- v19.2.2 supports React 19, konva 10

### Secondary (MEDIUM confidence)
- [Canvas Editors in React Konva](https://www.alikaraki.me/blog/canvas-editors-konva) -- production patterns: state-sync-on-end, layer separation, performance tips
- [Konva Bounding Box Annotation](https://blog.intzone.com/using-konva-js-to-annotate-image-with-bounding-boxes/) -- coordinate conversion pattern (naturalScaleX/Y)

### Tertiary (LOW confidence)
- [react-konva npm](https://www.npmjs.com/package/react-konva) -- version/peer dependency info (npm was 403, inferred from GitHub releases)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- react-konva 19.2.2 confirmed compatible with React 19, official docs verified
- Architecture: HIGH -- patterns from official Konva docs and verified blog posts, existing codebase patterns well-understood
- Pitfalls: HIGH -- Transformer scale/width confusion and coordinate mapping issues are well-documented in Konva ecosystem
- Backend CRUD: HIGH -- follows exact patterns from existing routers in the codebase

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (30 days -- stable libraries, low churn expected)
