/**
 * Types for filter facets returned by the backend /samples/filter-facets endpoint.
 */

export interface FilterFacets {
  categories: string[];
  splits: string[];
  tags: string[];
}
