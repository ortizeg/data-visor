"use client";

/**
 * Interactive SVG overlay rendering triage-colored bounding boxes.
 *
 * Unlike AnnotationOverlay (pointer-events-none, used in the grid),
 * this component enables pointer-events on individual boxes so users
 * can click to cycle triage labels. Predictions use dashed strokes,
 * GT uses solid strokes. Override annotations show a "*" indicator.
 */

import {
  ANNOTATION_TRIAGE_COLORS,
  type AnnotationTriageResult,
} from "@/types/annotation-triage";
import type { Annotation } from "@/types/annotation";

interface TriageOverlayProps {
  /** Annotations to render (from useAnnotations). */
  annotations: Annotation[];
  /** Triage classification map (from useAnnotationTriage). */
  triageMap: Record<string, AnnotationTriageResult>;
  /** Original image width (for SVG viewBox). */
  imageWidth: number;
  /** Original image height (for SVG viewBox). */
  imageHeight: number;
  /** Callback when a box is clicked. Receives annotation ID and current label. */
  onClickAnnotation: (annotationId: string, currentLabel: string) => void;
}

/** Default color for annotations not in the triage map. */
const DEFAULT_COLOR = "#a1a1aa"; // zinc-400

/**
 * Render triage-colored, clickable bounding boxes as an SVG overlay.
 *
 * The SVG viewBox matches original image dimensions so annotation
 * coordinates map correctly without manual scaling (same pattern
 * as AnnotationOverlay).
 */
export function TriageOverlay({
  annotations,
  triageMap,
  imageWidth,
  imageHeight,
  onClickAnnotation,
}: TriageOverlayProps) {
  if (annotations.length === 0) return null;

  const strokeWidth = Math.max(imageWidth * 0.003, 2);
  const fontSize = Math.max(imageWidth * 0.015, 10);

  return (
    <svg
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
    >
      {annotations.map((ann) => {
        const triage = triageMap[ann.id];
        // Skip annotations not in the triage map (e.g., GT-only, no predictions)
        if (!triage) return null;

        const color =
          ANNOTATION_TRIAGE_COLORS[triage.label] ?? DEFAULT_COLOR;
        const isPrediction = ann.source !== "ground_truth";
        const dashLen = strokeWidth * 4;
        const gapLen = strokeWidth * 2;
        const labelText = `${ann.category_name} ${triage.label.toUpperCase()}${triage.is_override ? "*" : ""}`;

        return (
          <g
            key={ann.id}
            onClick={() => onClickAnnotation(ann.id, triage.label)}
            className="cursor-pointer"
            style={{ pointerEvents: "auto" }}
          >
            <rect
              x={ann.bbox_x}
              y={ann.bbox_y}
              width={ann.bbox_w}
              height={ann.bbox_h}
              fill="transparent"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={
                isPrediction ? `${dashLen},${gapLen}` : "none"
              }
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
              {labelText}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
