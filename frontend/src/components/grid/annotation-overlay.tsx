"use client";

/**
 * SVG overlay rendering bounding boxes with class labels.
 *
 * Uses SVG viewBox set to original image dimensions so annotation
 * coordinates (in original pixel space) scale correctly to any
 * thumbnail display size. The SVG stretches to fill its container
 * via CSS while preserveAspectRatio handles coordinate mapping.
 */

import { getClassColor } from "@/lib/color-hash";
import type { Annotation } from "@/types/annotation";

interface AnnotationOverlayProps {
  /** Annotations to render as bounding boxes. */
  annotations: Annotation[];
  /** Original image width (for SVG viewBox coordinate space). */
  imageWidth: number;
  /** Original image height (for SVG viewBox coordinate space). */
  imageHeight: number;
}

/**
 * Render bounding box annotations as an SVG overlay.
 *
 * The SVG viewBox matches the original image dimensions, NOT the
 * thumbnail dimensions. This means annotation coordinates (bbox_x,
 * bbox_y, bbox_w, bbox_h) map correctly without any manual scaling.
 * The browser's SVG renderer handles the coordinate transformation.
 */
export function AnnotationOverlay({
  annotations,
  imageWidth,
  imageHeight,
}: AnnotationOverlayProps) {
  if (annotations.length === 0) return null;

  const strokeWidth = Math.max(imageWidth * 0.003, 2);
  const fontSize = Math.max(imageWidth * 0.015, 10);

  return (
    <svg
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full pointer-events-none"
      aria-hidden="true"
    >
      {annotations.map((ann) => {
        const color = getClassColor(ann.category_name);
        return (
          <g key={ann.id}>
            <rect
              x={ann.bbox_x}
              y={ann.bbox_y}
              width={ann.bbox_w}
              height={ann.bbox_h}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
            />
            <text
              x={ann.bbox_x}
              y={ann.bbox_y - 4}
              fill={color}
              fontSize={fontSize}
              fontWeight="bold"
              paintOrder="stroke"
              stroke="rgba(0,0,0,0.7)"
              strokeWidth={fontSize * 0.15}
            >
              {ann.category_name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
