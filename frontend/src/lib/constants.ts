/**
 * Application constants for API configuration and grid layout.
 */

/** Base URL for the backend API. */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Number of samples per page (matches backend default limit). */
export const PAGE_SIZE = 50;

/** Default number of columns in the image grid. */
export const DEFAULT_COLUMNS = 6;

/** Minimum cell width in pixels -- used to compute responsive column count. */
export const MIN_CELL_WIDTH = 200;

/** Maximum number of grid columns. */
export const MAX_COLUMNS = 10;

/** Minimum number of grid columns. */
export const MIN_COLUMNS = 3;
