"use client";

/**
 * Tooltip showing an image thumbnail when hovering over a scatter plot point.
 *
 * Absolutely positioned at (x + 16, y + 16) offset from cursor position.
 * Uses pointer-events-none to avoid interfering with deck.gl hover detection.
 */

interface HoverThumbnailProps {
  /** Screen X coordinate of the hovered point. */
  x: number;
  /** Screen Y coordinate of the hovered point. */
  y: number;
  /** File name to display below the thumbnail. */
  fileName: string;
  /** URL for the thumbnail image. */
  thumbnailUrl: string;
}

export function HoverThumbnail({
  x,
  y,
  fileName,
  thumbnailUrl,
}: HoverThumbnailProps) {
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg bg-zinc-900 p-1.5 shadow-xl"
      style={{
        left: x + 16,
        top: y + 16,
      }}
    >
      <img
        src={thumbnailUrl}
        alt={fileName}
        className="h-[120px] w-[120px] rounded object-cover"
      />
      <p className="mt-1 max-w-[120px] truncate text-center text-xs text-zinc-300">
        {fileName}
      </p>
    </div>
  );
}
