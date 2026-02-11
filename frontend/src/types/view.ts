/**
 * TypeScript types for saved view configurations.
 * Matches backend SavedViewResponse and SavedViewListResponse models.
 */

export interface SavedView {
  id: string;
  dataset_id: string;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SavedViewList {
  views: SavedView[];
}
