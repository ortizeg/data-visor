/**
 * Coordinate conversion utilities for annotation editing.
 *
 * Annotations are stored in original pixel space (matching the source image
 * dimensions). The Konva canvas may display the image at a different size,
 * so we need bidirectional conversion between the two coordinate systems.
 *
 * Also provides rectangle normalization for handling negative width/height
 * produced when drawing from right-to-left or bottom-to-top.
 */

/** Scale factors between original image space and canvas display space. */
export interface ScaleFactors {
  scaleX: number;
  scaleY: number;
}

/**
 * Compute scale factors from original image dimensions to canvas display
 * dimensions.
 *
 * @example
 * getScaleFactors(1920, 1080, 960, 540) // { scaleX: 0.5, scaleY: 0.5 }
 */
export function getScaleFactors(
  originalWidth: number,
  originalHeight: number,
  displayWidth: number,
  displayHeight: number,
): ScaleFactors {
  return {
    scaleX: displayWidth / originalWidth,
    scaleY: displayHeight / originalHeight,
  };
}

/**
 * Convert annotation coordinates from original pixel space to Konva canvas
 * display coordinates.
 *
 * @example
 * toCanvasCoords({ bbox_x: 100, bbox_y: 50, bbox_w: 200, bbox_h: 150 }, { scaleX: 0.5, scaleY: 0.5 })
 * // { x: 50, y: 25, width: 100, height: 75 }
 */
export function toCanvasCoords(
  bbox: { bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number },
  scale: ScaleFactors,
): { x: number; y: number; width: number; height: number } {
  return {
    x: bbox.bbox_x * scale.scaleX,
    y: bbox.bbox_y * scale.scaleY,
    width: bbox.bbox_w * scale.scaleX,
    height: bbox.bbox_h * scale.scaleY,
  };
}

/**
 * Convert Konva canvas display coordinates back to original pixel space
 * for storage in DuckDB.
 *
 * @example
 * toOriginalCoords({ x: 50, y: 25, width: 100, height: 75 }, { scaleX: 0.5, scaleY: 0.5 })
 * // { bbox_x: 100, bbox_y: 50, bbox_w: 200, bbox_h: 150 }
 */
export function toOriginalCoords(
  canvasRect: { x: number; y: number; width: number; height: number },
  scale: ScaleFactors,
): { bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number } {
  return {
    bbox_x: canvasRect.x / scale.scaleX,
    bbox_y: canvasRect.y / scale.scaleY,
    bbox_w: canvasRect.width / scale.scaleX,
    bbox_h: canvasRect.height / scale.scaleY,
  };
}

/**
 * Normalize a rectangle that may have negative width or height.
 *
 * When drawing from right-to-left or bottom-to-top, width/height become
 * negative. This function flips the origin and makes dimensions positive.
 *
 * @example
 * normalizeRect({ x: 300, y: 200, width: -100, height: -50 })
 * // { x: 200, y: 150, width: 100, height: 50 }
 */
export function normalizeRect(
  rect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = rect;

  if (width < 0) {
    x = x + width;
    width = Math.abs(width);
  }

  if (height < 0) {
    y = y + height;
    height = Math.abs(height);
  }

  return { x, y, width, height };
}
