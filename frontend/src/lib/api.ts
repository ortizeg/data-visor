/**
 * API fetch wrapper and URL helpers for the backend API.
 */

import { API_BASE } from "./constants";

/**
 * Fetch JSON from the backend API.
 * Throws on non-OK responses.
 */
export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Build a thumbnail URL for a sample image.
 * Returns a URL string (no fetch). The browser loads the image directly.
 */
export function thumbnailUrl(
  datasetId: string,
  sampleId: string,
  size = "medium",
): string {
  return `${API_BASE}/images/${datasetId}/${sampleId}?size=${size}`;
}

/**
 * Build a full-resolution image URL for a sample.
 */
export function fullImageUrl(
  datasetId: string,
  sampleId: string,
): string {
  return `${API_BASE}/images/${datasetId}/${sampleId}?size=original`;
}
