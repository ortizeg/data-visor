"use client";

/**
 * Konva-based annotation editor for the sample detail modal.
 *
 * Composes EditableRect (drag/resize ground-truth boxes), draw layer
 * (create new boxes), read-only prediction overlays (dashed), and a
 * class picker (assign category to newly drawn boxes).
 *
 * Replaces the SVG AnnotationOverlay when edit mode is active.
 * All coordinates convert between original pixel space (DuckDB) and
 * canvas display space via coord-utils.
 */

import { useRef, useState, useEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Rect } from "react-konva";
import useImage from "use-image";
import Konva from "konva";

import {
  getScaleFactors,
  toCanvasCoords,
  toOriginalCoords,
} from "@/lib/coord-utils";
import { getClassColor, getSourceColor } from "@/lib/color-hash";
import { useUIStore } from "@/stores/ui-store";
import { EditableRect } from "./editable-rect";
import { useDrawLayer } from "./draw-layer";
import { ClassPicker } from "./class-picker";
import type { Annotation } from "@/types/annotation";

export interface AnnotationEditorProps {
  /** Full-resolution image URL. */
  imageUrl: string;
  /** Ground-truth annotations (editable). */
  annotations: Annotation[];
  /** Non-ground-truth annotations (read-only dashed overlay). */
  predictions: Annotation[];
  /** Original image width in pixels. */
  imageWidth: number;
  /** Original image height in pixels. */
  imageHeight: number;
  /** Available category names for the class picker. */
  categories: string[];
  /** Callback to update an annotation's bbox (original pixel space). */
  onUpdate: (
    id: string,
    bbox: { bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number },
  ) => void;
  /** Callback to create a new annotation (original pixel space). */
  onCreate: (
    bbox: { bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number },
    categoryName: string,
  ) => void;
}

/**
 * Annotation editing canvas using react-konva.
 *
 * Renders the full image as a background, ground-truth boxes as
 * draggable/resizable EditableRects, prediction boxes as dashed
 * non-interactive overlays, and a draw layer for creating new boxes.
 */
export function AnnotationEditor({
  imageUrl,
  annotations,
  predictions,
  imageWidth,
  imageHeight,
  categories,
  onUpdate,
  onCreate,
}: AnnotationEditorProps) {
  const [image, imageStatus] = useImage(imageUrl, "anonymous");
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Track container width via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) setContainerWidth(width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Calculate display dimensions preserving aspect ratio
  const aspectRatio = imageWidth / imageHeight;
  const displayWidth = containerWidth;
  const displayHeight = displayWidth / aspectRatio;
  const scale = getScaleFactors(imageWidth, imageHeight, displayWidth, displayHeight);

  // UI store selectors
  const selectedAnnotationId = useUIStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = useUIStore((s) => s.setSelectedAnnotationId);
  const isDrawMode = useUIStore((s) => s.isDrawMode);

  // Pending rect waiting for class assignment (set after draw completes)
  const [pendingRect, setPendingRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Draw layer hook
  const { handlers: drawHandlers, previewRect } = useDrawLayer({
    active: isDrawMode,
    stageRef,
    onDrawComplete: (rect) => {
      setPendingRect(rect);
    },
  });

  return (
    <div ref={containerRef} className="relative">
      {imageStatus === "loading" && (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-blue-600" />
        </div>
      )}
      <Stage
        ref={stageRef}
        width={displayWidth}
        height={displayHeight}
        style={{ cursor: isDrawMode ? "crosshair" : "default" }}
        onMouseDown={(e) => {
          if (isDrawMode) {
            drawHandlers.onMouseDown(e);
            return;
          }
          // Deselect on empty area click
          if (e.target === e.target.getStage()) {
            setSelectedAnnotationId(null);
          }
        }}
        onMouseMove={isDrawMode ? drawHandlers.onMouseMove : undefined}
        onMouseUp={isDrawMode ? drawHandlers.onMouseUp : undefined}
      >
        {/* Background image layer */}
        <Layer>
          <KonvaImage
            image={image}
            width={displayWidth}
            height={displayHeight}
          />
        </Layer>

        {/* Annotations layer */}
        <Layer>
          {/* Read-only prediction boxes (dashed, non-interactive) */}
          {predictions.map((ann) => {
            const c = toCanvasCoords(ann, scale);
            return (
              <Rect
                key={ann.id}
                x={c.x}
                y={c.y}
                width={c.width}
                height={c.height}
                stroke={getSourceColor(ann.source)}
                strokeWidth={2}
                dash={[8, 4]}
                fill="transparent"
                listening={false}
              />
            );
          })}

          {/* Editable ground truth boxes */}
          {annotations.map((ann) => (
            <EditableRect
              key={ann.id}
              shapeProps={toCanvasCoords(ann, scale)}
              stroke={getClassColor(ann.category_name)}
              isSelected={selectedAnnotationId === ann.id}
              onSelect={() => setSelectedAnnotationId(ann.id)}
              onChange={(newAttrs) => {
                const original = toOriginalCoords(newAttrs, scale);
                onUpdate(ann.id, original);
              }}
            />
          ))}

          {/* Draw preview rect */}
          {previewRect}
        </Layer>
      </Stage>

      {/* Class picker popup when a new box was just drawn */}
      {pendingRect && (
        <ClassPicker
          categories={categories}
          position={{ x: pendingRect.x, y: pendingRect.y }}
          onSelect={(categoryName) => {
            const original = toOriginalCoords(pendingRect, scale);
            onCreate(original, categoryName);
            setPendingRect(null);
          }}
          onCancel={() => setPendingRect(null)}
        />
      )}
    </div>
  );
}
