"use client";

/**
 * deck.gl 2D scatter plot for embedding coordinates.
 *
 * Uses OrthographicView (not MapView) since embedding coordinates are
 * non-geographic abstract 2D data. ScatterplotLayer renders each point
 * with zoom, pan, hover highlighting, and picking.
 *
 * WebGL context loss recovery: Listens for "webglcontextlost" on the
 * canvas element. On context loss, increments a React key to force
 * DeckGL remount, restoring the visualization automatically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import type { DeckGLRef } from "@deck.gl/react";
import { OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";

import type { EmbeddingPoint } from "@/types/embedding";

export type ColorMode = "default" | "gt_class" | "pred_class" | "correctness";

interface EmbeddingScatterProps {
  /** 2D coordinate points to render. */
  points: EmbeddingPoint[];
  /** Callback when a point is hovered (null when hover leaves). */
  onHover?: (
    point: EmbeddingPoint | null,
    screenX: number,
    screenY: number,
  ) => void;
  /** Sample IDs selected via lasso. null = no selection (default colors). */
  selectedIds?: string[] | null;
  /** Ref forwarded to the DeckGL component for lasso coordinate projection. */
  deckRef?: React.RefObject<DeckGLRef | null>;
  /** Color mode for scatter point fill colors. */
  colorMode?: ColorMode;
}

const CATEGORICAL_PALETTE: [number, number, number, number][] = [
  [31, 119, 180, 200], [255, 127, 14, 200], [44, 160, 44, 200], [214, 39, 40, 200],
  [148, 103, 189, 200], [140, 86, 75, 200], [227, 119, 194, 200], [127, 127, 127, 200],
  [188, 189, 34, 200], [23, 190, 207, 200], [174, 199, 232, 200], [255, 187, 120, 200],
  [152, 223, 138, 200], [255, 152, 150, 200], [197, 176, 213, 200], [196, 156, 148, 200],
  [247, 182, 210, 200], [199, 199, 199, 200], [219, 219, 141, 200], [158, 218, 229, 200],
];

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0] as [number, number, number],
  zoom: 1,
  minZoom: -2,
  maxZoom: 10,
};

const ORTHO_VIEW = new OrthographicView({
  id: "ortho",
  controller: true,
});

export function EmbeddingScatter({
  points,
  onHover,
  selectedIds = null,
  deckRef,
  colorMode = "default",
}: EmbeddingScatterProps) {
  const [deckKey, setDeckKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // O(1) lookup set for selected points
  const selectedSet = useMemo(
    () => (selectedIds ? new Set(selectedIds) : null),
    [selectedIds],
  );

  // WebGL context loss recovery (Pitfall 4 from research)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      // Increment key to force DeckGL remount
      setDeckKey((k) => k + 1);
    };

    // deck.gl creates the canvas inside the container div
    const observer = new MutationObserver(() => {
      const canvas = container.querySelector("canvas");
      if (canvas) {
        canvas.addEventListener("webglcontextlost", handleContextLost);
        observer.disconnect();
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    // Also check if canvas already exists
    const canvas = container.querySelector("canvas");
    if (canvas) {
      canvas.addEventListener("webglcontextlost", handleContextLost);
      observer.disconnect();
    }

    return () => {
      observer.disconnect();
      const c = container.querySelector("canvas");
      if (c) {
        c.removeEventListener("webglcontextlost", handleContextLost);
      }
    };
  }, [deckKey]);

  const handleHover = useCallback(
    (info: { object?: EmbeddingPoint; x: number; y: number }) => {
      onHover?.(
        (info.object as EmbeddingPoint | undefined) ?? null,
        info.x,
        info.y,
      );
    },
    [onHover],
  );

  // Build stable label-to-index map for categorical coloring
  const labelIndex = useMemo(() => {
    const labels = new Set<string>();
    for (const p of points) {
      if (p.gtLabel) labels.add(p.gtLabel);
      if (p.predLabel) labels.add(p.predLabel);
    }
    const sorted = [...labels].sort();
    const map = new Map<string, number>();
    sorted.forEach((l, i) => map.set(l, i));
    return map;
  }, [points]);

  // Memoize layer to avoid recreating on every render (anti-pattern from research)
  const layers = useMemo(
    () => [
      new ScatterplotLayer<EmbeddingPoint>({
        id: "embedding-scatter",
        data: points,
        getPosition: (d) => [d.x, d.y, 0],
        getRadius: 3,
        radiusMinPixels: 2,
        radiusMaxPixels: 8,
        getFillColor: (d) => {
          // Lasso selection overrides color mode
          if (selectedSet !== null) {
            return selectedSet.has(d.sampleId)
              ? [99, 102, 241, 230]
              : [180, 180, 180, 80];
          }
          if (colorMode === "gt_class" && d.gtLabel) {
            return CATEGORICAL_PALETTE[labelIndex.get(d.gtLabel)! % CATEGORICAL_PALETTE.length];
          }
          if (colorMode === "pred_class" && d.predLabel) {
            return CATEGORICAL_PALETTE[labelIndex.get(d.predLabel)! % CATEGORICAL_PALETTE.length];
          }
          if (colorMode === "correctness") {
            if (!d.predLabel) return [180, 180, 180, 100] as [number, number, number, number];
            return d.gtLabel === d.predLabel
              ? [44, 160, 44, 200] as [number, number, number, number]
              : [214, 39, 40, 200] as [number, number, number, number];
          }
          return [100, 120, 220, 200];
        },
        pickable: true,
        onHover: handleHover,
        autoHighlight: true,
        highlightColor: [255, 200, 0, 200],
        // Force update when selection or color mode changes
        updateTriggers: {
          getFillColor: [selectedSet, colorMode],
        },
      }),
    ],
    [points, handleHover, selectedSet, colorMode, labelIndex],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <DeckGL
        ref={deckRef}
        key={deckKey}
        views={ORTHO_VIEW}
        initialViewState={INITIAL_VIEW_STATE}
        layers={layers}
        controller={true}
      />
    </div>
  );
}
