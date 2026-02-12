"use client";

/**
 * SVG overlay for freehand lasso polygon drawing on top of deck.gl.
 *
 * When active, captures mouse events to draw a freehand polygon.
 * On mouse-up, performs point-in-polygon testing against all scatter
 * points using robust-point-in-polygon, with a bounding-box pre-filter
 * for performance on large datasets.
 *
 * The overlay is absolutely positioned over the scatter plot container
 * and only intercepts pointer events when the lasso tool is active.
 */

import { useCallback, useRef, useState } from "react";
import classifyPoint from "robust-point-in-polygon";

import type { DeckGLRef } from "@deck.gl/react";
import type { EmbeddingPoint } from "@/types/embedding";

interface LassoOverlayProps {
  /** All scatter points (for hit testing). */
  points: EmbeddingPoint[];
  /** Ref to the DeckGL component for coordinate projection. */
  deckRef: React.RefObject<DeckGLRef | null>;
  /** Callback when lasso selection completes. */
  onSelect: (selectedIds: string[]) => void;
  /** Whether lasso tool is active. */
  active: boolean;
}

export function LassoOverlay({
  points,
  deckRef,
  onSelect,
  active,
}: LassoOverlayProps) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [path, setPath] = useState<[number, number][]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const moveCountRef = useRef(0);

  const getRelativeCoords = useCallback(
    (e: React.MouseEvent): [number, number] => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return [e.clientX, e.clientY];
      return [e.clientX - rect.left, e.clientY - rect.top];
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!active || e.button !== 0) return;
      e.preventDefault();
      const pt = getRelativeCoords(e);
      setIsDrawing(true);
      setPath([pt]);
      moveCountRef.current = 0;
    },
    [active, getRelativeCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing) return;
      // Throttle: only record every 3rd event for performance
      moveCountRef.current += 1;
      if (moveCountRef.current % 3 !== 0) return;
      const pt = getRelativeCoords(e);
      setPath((prev) => [...prev, pt]);
    },
    [isDrawing, getRelativeCoords],
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    // Not enough points for a polygon
    if (path.length < 3) {
      setPath([]);
      return;
    }

    // Get the deck.gl viewport for coordinate projection
    const deck = deckRef.current?.deck;
    if (!deck) {
      setPath([]);
      return;
    }

    const viewports = deck.getViewports();
    if (!viewports || viewports.length === 0) {
      setPath([]);
      return;
    }

    const viewport = viewports[0];

    // Compute bounding box of lasso polygon in screen coords (cheap pre-filter)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [px, py] of path) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }

    const selectedIds: string[] = [];

    for (const point of points) {
      // Project embedding coordinates to screen coordinates
      const [screenX, screenY] = viewport.project([point.x, point.y, 0]);

      // Bounding box pre-filter
      if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY)
        continue;

      // Robust point-in-polygon test
      // classifyPoint returns: -1 (inside), 0 (boundary), 1 (outside)
      const classification = classifyPoint(path, [screenX, screenY]);
      if (classification <= 0) {
        selectedIds.push(point.sampleId);
      }
    }

    onSelect(selectedIds);
    setPath([]);
  }, [isDrawing, path, points, deckRef, onSelect]);

  // Build SVG polyline points string
  const pathStr = path.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 z-10 h-full w-full"
      style={{
        pointerEvents: active ? "all" : "none",
        cursor: active ? "crosshair" : "default",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {path.length > 0 && (
        <polyline
          points={pathStr}
          fill="rgba(99,102,241,0.15)"
          stroke="#6366f1"
          strokeWidth={2}
          strokeDasharray="4,4"
          fillRule="evenodd"
        />
      )}
    </svg>
  );
}
