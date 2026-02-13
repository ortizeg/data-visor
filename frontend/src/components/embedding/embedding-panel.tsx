"use client";

/**
 * Embedding visualization panel managing the full workflow:
 *
 * 1. No embeddings: Empty state with "Generate Embeddings" button
 * 2. Embeddings but no reduction: "Run UMAP" button to trigger UMAP reduction
 * 3. Has reduction: Scatter plot with hover thumbnails
 *
 * Progress bars show real-time feedback during generation and reduction
 * via SSE progress streams.
 */

import { useEffect, useRef, useState } from "react";

import type { DeckGLRef } from "@deck.gl/react";
import { useQueryClient } from "@tanstack/react-query";

import {
  useEmbeddingCoordinates,
  useEmbeddingStatus,
  useGenerateEmbeddings,
  useReduceEmbeddings,
} from "@/hooks/use-embeddings";
import { useEmbeddingProgress } from "@/hooks/use-embedding-progress";
import { thumbnailUrl } from "@/lib/api";
import { EmbeddingScatter } from "@/components/embedding/embedding-scatter";
import { HoverThumbnail } from "@/components/embedding/hover-thumbnail";
import { LassoOverlay } from "@/components/embedding/lasso-overlay";
import { useEmbeddingStore, useLassoSelectedIds } from "@/stores/embedding-store";
import type { EmbeddingPoint } from "@/types/embedding";

interface EmbeddingPanelProps {
  datasetId: string;
}

export function EmbeddingPanel({ datasetId }: EmbeddingPanelProps) {
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading } =
    useEmbeddingStatus(datasetId);

  const generateMutation = useGenerateEmbeddings(datasetId);
  const reduceMutation = useReduceEmbeddings(datasetId);

  // Track whether we're actively monitoring progress
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReducing, setIsReducing] = useState(false);

  // SSE progress hooks
  const genProgress = useEmbeddingProgress(
    `/datasets/${datasetId}/embeddings/progress`,
    isGenerating,
  );
  const reduceProgress = useEmbeddingProgress(
    `/datasets/${datasetId}/embeddings/reduce/progress`,
    isReducing,
  );

  // Fetch coordinates only when reduction exists
  const hasReduction = status?.has_reduction ?? false;
  const { data: coordinates, isLoading: coordsLoading } =
    useEmbeddingCoordinates(datasetId, hasReduction && !isReducing);

  // Lasso selection state
  const [lassoActive, setLassoActive] = useState(false);
  const lassoSelectedIds = useLassoSelectedIds();
  const setLassoSelectedIds = useEmbeddingStore((s) => s.setLassoSelectedIds);
  const clearLasso = useEmbeddingStore((s) => s.clearLasso);
  const deckRef = useRef<DeckGLRef | null>(null);

  // Hover state for thumbnail tooltip
  const [hoveredPoint, setHoveredPoint] = useState<{
    point: EmbeddingPoint;
    screenX: number;
    screenY: number;
  } | null>(null);

  const handleHover = (
    point: EmbeddingPoint | null,
    screenX: number,
    screenY: number,
  ) => {
    if (point) {
      setHoveredPoint({ point, screenX, screenY });
    } else {
      setHoveredPoint(null);
    }
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    generateMutation.mutate(undefined, {
      onError: () => setIsGenerating(false),
    });
  };

  const handleReduce = () => {
    setIsReducing(true);
    reduceMutation.mutate(undefined, {
      onError: () => setIsReducing(false),
    });
  };

  // When generation completes, invalidate status query and wait for it to confirm
  useEffect(() => {
    if (!isGenerating) return;
    if (genProgress.status === "error") {
      setIsGenerating(false);
      return;
    }
    if (genProgress.status === "complete") {
      queryClient.invalidateQueries({
        queryKey: ["embedding-status", datasetId],
      });
    }
  }, [isGenerating, genProgress.status, datasetId, queryClient]);

  // Turn off generating flag once status confirms embeddings exist
  useEffect(() => {
    if (isGenerating && status?.has_embeddings) {
      setIsGenerating(false);
    }
  }, [isGenerating, status?.has_embeddings]);

  // When reduction completes, invalidate status + coordinates and wait for confirmation
  useEffect(() => {
    if (!isReducing) return;
    if (reduceProgress.status === "error") {
      setIsReducing(false);
      return;
    }
    if (reduceProgress.status === "complete") {
      queryClient.invalidateQueries({
        queryKey: ["embedding-status", datasetId],
      });
      queryClient.invalidateQueries({
        queryKey: ["embedding-coordinates", datasetId],
      });
    }
  }, [isReducing, reduceProgress.status, datasetId, queryClient]);

  // Turn off reducing flag once status confirms reduction exists
  useEffect(() => {
    if (isReducing && status?.has_reduction) {
      setIsReducing(false);
    }
  }, [isReducing, status?.has_reduction]);

  // --- Loading state ---
  if (statusLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
      </div>
    );
  }

  // --- Generating embeddings ---
  if (isGenerating) {
    const total = genProgress.total ?? 0;
    const processed = genProgress.processed ?? 0;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Generating Embeddings...
        </div>
        <div className="w-64">
          <div className="mb-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>{genProgress.message}</span>
            <span>
              {processed}/{total}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  // --- Reducing embeddings ---
  if (isReducing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {reduceProgress.message || "Running dimensionality reduction..."}
        </div>
      </div>
    );
  }

  // --- No embeddings: empty state ---
  if (!status?.has_embeddings) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="rounded-lg border border-dashed border-zinc-300 px-8 py-12 text-center dark:border-zinc-600">
          <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300">
            No Embeddings Yet
          </h3>
          <p className="mt-2 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Generate image embeddings using DINOv2 to visualize how your
            dataset clusters in embedding space.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Generate Embeddings
          </button>
        </div>
      </div>
    );
  }

  // --- Embeddings exist but no reduction ---
  if (!status.has_reduction) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <div className="rounded-lg border border-dashed border-zinc-300 px-8 py-12 text-center dark:border-zinc-600">
          <h3 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300">
            Embeddings Ready
          </h3>
          <p className="mt-2 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            {status.embedding_count.toLocaleString()} embeddings generated
            with {status.model_name ?? "DINOv2"}. Run dimensionality
            reduction to create a 2D scatter plot.
          </p>
          <button
            onClick={handleReduce}
            disabled={reduceMutation.isPending}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Run Dimensionality Reduction
          </button>
        </div>
      </div>
    );
  }

  // --- Has reduction: show scatter plot ---
  if (coordsLoading || !coordinates) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {coordinates.length.toLocaleString()} points
        </span>

        {/* Lasso toggle */}
        <button
          onClick={() => setLassoActive((v) => !v)}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            lassoActive
              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          Lasso
        </button>

        {/* Clear selection (visible when lasso has selected points) */}
        {lassoSelectedIds !== null && (
          <>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
              {lassoSelectedIds.length.toLocaleString()} selected
            </span>
            <button
              onClick={() => {
                clearLasso();
                setLassoActive(false);
              }}
              className="rounded px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
            >
              Clear Selection
            </button>
          </>
        )}

        <div className="flex-1" />
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="rounded px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          Re-generate
        </button>
        <button
          onClick={handleReduce}
          disabled={isReducing}
          className="rounded px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          Re-reduce
        </button>
      </div>

      {/* Scatter plot with lasso overlay */}
      <div className="relative flex-1">
        <EmbeddingScatter
          points={coordinates}
          onHover={handleHover}
          selectedIds={lassoSelectedIds}
          deckRef={deckRef}
        />
        <LassoOverlay
          points={coordinates}
          deckRef={deckRef}
          onSelect={(ids) => setLassoSelectedIds(ids)}
          active={lassoActive}
        />
      </div>

      {/* Hover thumbnail tooltip */}
      {hoveredPoint && (
        <HoverThumbnail
          x={hoveredPoint.screenX}
          y={hoveredPoint.screenY}
          fileName={hoveredPoint.point.fileName}
          thumbnailUrl={thumbnailUrl(
            datasetId,
            hoveredPoint.point.sampleId,
            "small",
          )}
        />
      )}
    </div>
  );
}
