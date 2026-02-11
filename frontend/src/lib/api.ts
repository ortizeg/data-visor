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
 * POST JSON to the backend API.
 * Returns parsed JSON response. Throws on non-OK responses.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * PATCH JSON to the backend API.
 * Returns parsed JSON response. Throws on non-OK responses.
 */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * DELETE a resource via the backend API.
 * Throws on non-OK responses.
 */
export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
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
