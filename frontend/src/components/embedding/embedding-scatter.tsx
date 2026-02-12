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
}

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
        getFillColor: (d) =>
          selectedSet === null
            ? [100, 120, 220, 200]
            : selectedSet.has(d.sampleId)
              ? [99, 102, 241, 230]
              : [180, 180, 180, 80],
        pickable: true,
        onHover: handleHover,
        autoHighlight: true,
        highlightColor: [255, 200, 0, 200],
        // Force update when selection changes
        updateTriggers: {
          getFillColor: [selectedSet],
        },
      }),
    ],
    [points, handleHover, selectedSet],
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
