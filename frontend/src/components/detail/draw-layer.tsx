"use client";

/**
 * Drawing logic for creating new bounding boxes on the Konva canvas.
 *
 * Provides a custom hook `useDrawLayer` that returns mouse event handlers
 * (for the parent Stage) and a preview Rect node rendered during drawing.
 * Does NOT render its own Stage or Layer -- the parent composes these.
 *
 * Handles right-to-left and bottom-to-top drawing by normalizing negative
 * width/height via `normalizeRect` before calling `onDrawComplete`.
 */

import { useState, type ReactNode } from "react";
import { Rect } from "react-konva";
import Konva from "konva";
import { normalizeRect } from "@/lib/coord-utils";

export interface DrawLayerProps {
  /** Whether draw mode is currently active. */
  active: boolean;
  /** Ref to the parent Stage (used to get pointer position). */
  stageRef: React.RefObject<Konva.Stage | null>;
  /** Called with the normalized rectangle when a valid box is drawn. */
  onDrawComplete: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
}

/** Minimum pixel dimension (in canvas space) to accept a drawn rectangle. */
const MIN_DRAW_SIZE = 10;

interface DrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Hook that provides mouse handlers and a preview rectangle for drawing
 * new bounding boxes on a Konva Stage.
 *
 * @example
 * const { handlers, previewRect } = useDrawLayer({ active, stageRef, onDrawComplete });
 * <Stage {...handlers}>
 *   <Layer>
 *     {previewRect}
 *   </Layer>
 * </Stage>
 */
export function useDrawLayer({ active, stageRef, onDrawComplete }: DrawLayerProps): {
  handlers: {
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void;
    onMouseMove: (e: Konva.KonvaEventObject<MouseEvent>) => void;
    onMouseUp: () => void;
  };
  previewRect: ReactNode;
} {
  const [isDrawing, setIsDrawing] = useState(false);
  const [newRect, setNewRect] = useState<DrawRect | null>(null);

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!active) return;

    // Only start drawing when clicking on empty Stage area (not on shapes)
    const clickedOnEmpty = e.target === e.target.getStage();
    if (!clickedOnEmpty) return;

    const stage = stageRef.current;
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    setIsDrawing(true);
    setNewRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (!isDrawing || !newRect) return;

    const stage = stageRef.current;
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    setNewRect({
      ...newRect,
      width: pos.x - newRect.x,
      height: pos.y - newRect.y,
    });
  }

  function handleMouseUp() {
    if (!isDrawing || !newRect) {
      setIsDrawing(false);
      setNewRect(null);
      return;
    }

    // Only accept rectangles larger than minimum threshold
    if (
      Math.abs(newRect.width) > MIN_DRAW_SIZE &&
      Math.abs(newRect.height) > MIN_DRAW_SIZE
    ) {
      onDrawComplete(normalizeRect(newRect));
    }

    setIsDrawing(false);
    setNewRect(null);
  }

  const previewRect: ReactNode =
    isDrawing && newRect ? (
      <Rect
        x={newRect.x}
        y={newRect.y}
        width={newRect.width}
        height={newRect.height}
        stroke="#00ff00"
        strokeWidth={2}
        dash={[6, 3]}
        fill="rgba(0,255,0,0.1)"
        listening={false}
      />
    ) : null;

  return {
    handlers: {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
    },
    previewRect,
  };
}
