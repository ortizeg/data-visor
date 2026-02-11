/**
 * Deterministic class-to-color mapping using color-hash.
 *
 * Same class name always produces the same hex color across sessions.
 * Uses BKDRHash internally with configured saturation and lightness
 * ranges for vibrant, readable colors on both light and dark backgrounds.
 */

import ColorHash from "color-hash";

const colorHash = new ColorHash({
  saturation: [0.6, 0.7, 0.8],
  lightness: [0.45, 0.55, 0.65],
});

/**
 * Get a deterministic hex color for a class/category name.
 *
 * @example
 * getClassColor("person")  // always returns the same hex like "#a34f2d"
 * getClassColor("car")     // always returns the same hex like "#2d7fa3"
 */
export function getClassColor(className: string): string {
  return colorHash.hex(className);
}
