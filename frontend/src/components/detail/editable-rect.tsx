"use client";

/**
 * Draggable and resizable bounding-box rectangle for annotation editing.
 *
 * Uses Konva Rect + Transformer to provide 8-handle resizing with no
 * rotation. Converts Transformer scaleX/scaleY back to width/height on
 * transformEnd so the rect always stores real pixel dimensions (scale = 1).
 */

import { useRef, useEffect } from "react";
import { Rect, Transformer } from "react-konva";
import Konva from "konva";

export interface EditableRectProps {
  /** Rectangle position and size in canvas display coordinates. */
  shapeProps: { x: number; y: number; width: number; height: number };
  /** Stroke color for this annotation's class. */
  stroke: string;
  /** Whether this rectangle is currently selected (shows Transformer). */
  isSelected: boolean;
  /** Called when the user clicks this rectangle. */
  onSelect: () => void;
  /** Called when the user drags or resizes the rectangle. */
  onChange: (newAttrs: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
}

const MIN_SIZE = 5;

/**
 * Render a Konva Rect that is draggable and has a Transformer when selected.
 *
 * On drag, reports the new position. On transform, converts Transformer's
 * scaleX/scaleY into real width/height and resets scale to 1 so coordinates
 * stay in absolute pixels.
 */
export function EditableRect({
  shapeProps,
  stroke,
  isSelected,
  onSelect,
  onChange,
}: EditableRectProps) {
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
        fill="transparent"
        stroke={stroke}
        strokeWidth={2}
        draggable
        onClick={(e) => {
          e.cancelBubble = true;
          onSelect();
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          onSelect();
        }}
        onDragEnd={(e) => {
          onChange({
            ...shapeProps,
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) return;

          const scaleX = node.scaleX();
          const scaleY = node.scaleY();

          // Reset scale to 1 and store actual dimensions
          node.scaleX(1);
          node.scaleY(1);

          onChange({
            x: node.x(),
            y: node.y(),
            width: Math.max(MIN_SIZE, node.width() * scaleX),
            height: Math.max(MIN_SIZE, node.height() * scaleY),
          });
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          flipEnabled={false}
          rotateEnabled={false}
          anchorSize={8}
          borderStroke={stroke}
          boundBoxFunc={(_oldBox, newBox) => {
            // Prevent tiny boxes
            if (
              Math.abs(newBox.width) < MIN_SIZE ||
              Math.abs(newBox.height) < MIN_SIZE
            ) {
              return _oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
}
