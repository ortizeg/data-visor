/**
 * Types for filter facets returned by the backend /samples/filter-facets endpoint.
 */

export interface FacetItem {
  name: string;
  count: number;
}

export interface FilterFacets {
  categories: FacetItem[];
  splits: FacetItem[];
  tags: FacetItem[];
}
