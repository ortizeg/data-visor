# Phase 3: Filtering & Search - Research

**Researched:** 2026-02-11
**Domain:** Dynamic SQL query building, filter state management, faceted search, tagging systems, saved views
**Confidence:** HIGH

## Summary

Phase 3 adds filtering, search, sorting, tagging, and saved views to the existing DataVisor application. The backend (FastAPI + DuckDB) already supports basic `category` and `split` filters on `GET /samples`, and the frontend (Next.js 16 + TanStack Query + Zustand) already has an infinite-scroll grid with pagination. This phase extends both layers to support arbitrary metadata filtering, filename search, column sorting, user-defined tags, and persisted filter configurations (saved views).

The standard approach is to build a **dynamic query builder** on the backend that constructs parameterized DuckDB SQL from a structured filter payload, paired with a **Zustand filter store** on the frontend that drives TanStack Query's `queryKey` for automatic refetch-on-filter-change. Tags are stored using a DuckDB `VARCHAR[]` (LIST) column on the `samples` table, which supports `list_contains()` for efficient filtering. Saved views are persisted in a new `saved_views` DuckDB table with the filter configuration serialized as JSON.

The existing `list_samples` endpoint in `app/routers/samples.py` already demonstrates the dynamic WHERE clause pattern (building conditions/params lists and joining them). Phase 3 extends this pattern to handle multiple filter types (equality, search, list-contains, range) while keeping all user input parameterized to prevent SQL injection. On the frontend, the key architectural decision is to create a dedicated `filter-store.ts` (separate from `ui-store.ts`) that holds the active filter state and drives the `useSamples` query key. When filters change, TanStack Query automatically creates a new cache entry with the new key, providing instant results for previously-visited filter combinations.

**Primary recommendation:** Extend the existing `GET /samples` endpoint with additional query parameters (search, sort_by, sort_dir, tags, and a generic `metadata_*` prefix pattern), build a Zustand filter store with atomic selectors, include the full filter state in the TanStack Query key for automatic refetch, and add new endpoints for tags (PATCH bulk), saved views (CRUD), and filter facets (GET distinct values).

## Standard Stack

### Core

No new libraries are needed. Phase 3 uses the existing stack entirely:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| DuckDB | 1.4.4 | Dynamic query building, ILIKE search, LIST column for tags | Already in stack. Parameterized queries prevent SQL injection. `list_contains()` for tag filtering. `ILIKE` for case-insensitive filename search. |
| FastAPI | 0.128.7 | Filter endpoint with Pydantic Query models | Already in stack. Query Parameter Models (v0.115+) enable clean multi-param filter endpoints with validation. |
| Zustand | 5.0.x | Filter state management | Already in stack. Separate `filter-store.ts` following established `create()` pattern from `ui-store.ts`. |
| TanStack Query | 5.90.x | Automatic refetch on filter change | Already in stack. Filter state in `queryKey` triggers automatic refetch. `useInfiniteQuery` handles paginated filtered results. |
| Pydantic | 2.x | Filter request/response models | Already in stack. Query Parameter Models for filter validation. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nuqs | 2.x | Type-safe URL search params state | OPTIONAL. Consider for URL-persisted filter state (shareable links). Can be added later without refactoring -- Zustand filter store is the primary source of truth. |
| use-debounce | 10.x | Search input debouncing | OPTIONAL. A 5-line custom hook suffices. Only add if debounce edge cases arise. React 19's `useDeferredValue` is a built-in alternative. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| VARCHAR[] LIST for tags | Separate `sample_tags` junction table (many-to-many) | Junction table is more normalized and standard for relational DBs. But DuckDB's LIST type with `list_contains()` is more natural for a columnar analytical DB, avoids JOINs on the hot path, and supports bulk update via `list_append`/`list_filter`. Use LIST. |
| DuckDB ILIKE for search | DuckDB FTS extension (full-text search with BM25) | FTS provides ranked results and stemming, but the index does not auto-update when rows change. For filename search (not document search), ILIKE with `%term%` is simpler, auto-consistent, and fast enough for <1M rows. Use ILIKE. Upgrade to FTS only if search becomes a bottleneck. |
| Zustand filter store | URL search params as source of truth (nuqs) | URL-first approach makes filters shareable/bookmarkable but adds complexity (serialization, hydration, SSR). Zustand-first with optional URL sync is simpler for v1. Filters are session-scoped; saved views handle persistence. |
| Multiple GET query params | POST body with filter JSON | POST body is more flexible for complex filters but breaks REST conventions for read operations, defeats browser caching, and can't be bookmarked. GET with query params is correct for filtering. |
| Custom debounce hook | use-debounce npm package | use-debounce is well-maintained but adds a dependency for a 5-line hook. React 19 `useDeferredValue` handles the common case. Use `useDeferredValue` for search rendering, custom `useDebounce` hook for API calls. |
| Pydantic Query model | Individual Query() params | Individual params (current pattern) works but gets unwieldy with 8+ filter params. Pydantic Query model groups related params, adds validation, and is reusable. Use Pydantic Query model for the filter endpoint. |

**Installation:**
```bash
# No new packages required. All libraries already installed.
# Optional (if URL state persistence is desired later):
# cd frontend && npm install nuqs
```

## Architecture Patterns

### Recommended Project Structure

New/modified files for Phase 3:

```
app/
  routers/
    samples.py          # MODIFY: extend list_samples with filter params, add tag endpoints
    views.py            # NEW: saved views CRUD endpoints
  models/
    sample.py           # MODIFY: add SampleFilterParams, tag fields
    view.py             # NEW: SavedView model
  services/
    filter_builder.py   # NEW: dynamic SQL query builder

frontend/src/
  stores/
    filter-store.ts     # NEW: Zustand store for filter state
  hooks/
    use-samples.ts      # MODIFY: include filter state in query key
    use-filter-facets.ts # NEW: fetch distinct values for filter options
    use-saved-views.ts  # NEW: CRUD for saved views
    use-tags.ts         # NEW: tag mutation hooks
  components/
    filters/
      filter-sidebar.tsx     # NEW: sidebar with filter controls
      filter-select.tsx      # NEW: multi-select dropdown for category/split/tags
      search-input.tsx       # NEW: debounced filename search input
      sort-controls.tsx      # NEW: sort by / sort direction controls
      saved-view-picker.tsx  # NEW: saved view selector + save button
    grid/
      image-grid.tsx         # MODIFY: integrate sidebar layout
      grid-cell.tsx          # MODIFY: add tag badge display, selection checkbox
  types/
    filter.ts           # NEW: filter state types
    view.ts             # NEW: saved view types
  lib/
    api.ts              # MODIFY: add POST/PATCH/DELETE helpers
```

### Pattern 1: Dynamic SQL Query Builder (Backend)

**What:** A service that constructs parameterized DuckDB SQL from a structured filter object. Builds WHERE clauses, JOINs, ORDER BY, and pagination dynamically while keeping all user input as parameters.

**When to use:** All filtered sample queries. This replaces the inline SQL building in `list_samples`.

**Example:**

```python
# app/services/filter_builder.py
from dataclasses import dataclass, field

@dataclass
class FilterResult:
    """Result of building a dynamic SQL query."""
    where_clause: str
    params: list
    join_clause: str = ""
    order_clause: str = "ORDER BY s.id"

class SampleFilterBuilder:
    """Build parameterized DuckDB SQL from filter parameters.

    All user input goes through parameterized queries (?) to prevent
    SQL injection. Column names are validated against an allowlist.
    """

    # Columns that can be sorted/filtered -- prevents SQL injection via column names
    SORTABLE_COLUMNS = {"id", "file_name", "width", "height", "split"}
    FILTERABLE_METADATA_KEYS = {"date_captured", "license", "source"}

    def __init__(self):
        self.conditions: list[str] = []
        self.params: list = []
        self.joins: list[str] = []

    def add_dataset(self, dataset_id: str) -> "SampleFilterBuilder":
        self.conditions.append("s.dataset_id = ?")
        self.params.append(dataset_id)
        return self

    def add_split(self, split: str | None) -> "SampleFilterBuilder":
        if split is not None:
            self.conditions.append("s.split = ?")
            self.params.append(split)
        return self

    def add_category(self, category: str | None) -> "SampleFilterBuilder":
        if category is not None:
            self.joins.append(
                "JOIN annotations a ON s.id = a.sample_id "
                "AND a.dataset_id = s.dataset_id"
            )
            self.conditions.append("a.category_name = ?")
            self.params.append(category)
        return self

    def add_search(self, search: str | None) -> "SampleFilterBuilder":
        if search is not None and search.strip():
            self.conditions.append("s.file_name ILIKE ?")
            self.params.append(f"%{search.strip()}%")
        return self

    def add_tags(self, tags: list[str] | None) -> "SampleFilterBuilder":
        if tags:
            for tag in tags:
                self.conditions.append("list_contains(s.tags, ?)")
                self.params.append(tag)
        return self

    def add_has_any_tag(self, tags: list[str] | None) -> "SampleFilterBuilder":
        """Filter samples that have ANY of the given tags (OR logic)."""
        if tags:
            placeholders = ", ".join(["?"] * len(tags))
            self.conditions.append(f"list_has_any(s.tags, [{placeholders}])")
            self.params.extend(tags)
        return self

    def add_metadata_filter(
        self, key: str, value: str
    ) -> "SampleFilterBuilder":
        """Filter by a JSON metadata field. Key is allowlisted."""
        if key in self.FILTERABLE_METADATA_KEYS:
            self.conditions.append("s.metadata ->> ? = ?")
            self.params.extend([f"$.{key}", value])
        return self

    def build_order(
        self, sort_by: str | None, sort_dir: str | None
    ) -> str:
        if sort_by and sort_by in self.SORTABLE_COLUMNS:
            direction = "DESC" if sort_dir == "desc" else "ASC"
            return f"ORDER BY s.{sort_by} {direction}"
        return "ORDER BY s.id ASC"

    def build(
        self, sort_by: str | None = None, sort_dir: str | None = None
    ) -> FilterResult:
        where = " AND ".join(self.conditions) if self.conditions else "TRUE"
        join = " ".join(self.joins)
        order = self.build_order(sort_by, sort_dir)
        return FilterResult(
            where_clause=where,
            params=list(self.params),
            join_clause=join,
            order_clause=order,
        )
```

**Source:** Existing pattern in `app/routers/samples.py` (lines 38-76), [DuckDB Parameterized Queries](https://duckdb.org/docs/stable/guides/python/execute_sql), [DuckDB Pattern Matching](https://duckdb.org/docs/stable/sql/functions/pattern_matching)

**Confidence:** HIGH

### Pattern 2: Zustand Filter Store with TanStack Query Integration

**What:** A dedicated Zustand store for filter state that is included in TanStack Query's `queryKey`. When any filter changes, TanStack Query automatically refetches with the new parameters.

**When to use:** All sample filtering on the frontend. This is the core state management pattern.

**Example:**

```typescript
// frontend/src/stores/filter-store.ts
import { create } from "zustand";

interface FilterState {
  /** Active filters applied to the grid */
  search: string;
  category: string | null;
  split: string | null;
  tags: string[];
  sortBy: string;
  sortDir: "asc" | "desc";

  /** Actions */
  setSearch: (search: string) => void;
  setCategory: (category: string | null) => void;
  setSplit: (split: string | null) => void;
  setTags: (tags: string[]) => void;
  setSortBy: (sortBy: string) => void;
  setSortDir: (sortDir: "asc" | "desc") => void;
  clearFilters: () => void;
  applyView: (filters: Partial<FilterState>) => void;
}

const DEFAULT_FILTERS = {
  search: "",
  category: null,
  split: null,
  tags: [],
  sortBy: "id",
  sortDir: "asc" as const,
};

export const useFilterStore = create<FilterState>((set) => ({
  ...DEFAULT_FILTERS,

  setSearch: (search) => set({ search }),
  setCategory: (category) => set({ category }),
  setSplit: (split) => set({ split }),
  setTags: (tags) => set({ tags }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortDir: (sortDir) => set({ sortDir }),
  clearFilters: () => set(DEFAULT_FILTERS),
  applyView: (filters) => set((state) => ({ ...state, ...filters })),
}));

// Atomic selectors (per TkDodo's Zustand best practices)
export const useSearch = () => useFilterStore((s) => s.search);
export const useCategory = () => useFilterStore((s) => s.category);
export const useSplit = () => useFilterStore((s) => s.split);
export const useTags = () => useFilterStore((s) => s.tags);
export const useSortBy = () => useFilterStore((s) => s.sortBy);
export const useSortDir = () => useFilterStore((s) => s.sortDir);
export const useFilterActions = () =>
  useFilterStore((s) => ({
    setSearch: s.setSearch,
    setCategory: s.setCategory,
    setSplit: s.setSplit,
    setTags: s.setTags,
    setSortBy: s.setSortBy,
    setSortDir: s.setSortDir,
    clearFilters: s.clearFilters,
    applyView: s.applyView,
  }));
```

```typescript
// frontend/src/hooks/use-samples.ts (modified)
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { PAGE_SIZE } from "@/lib/constants";
import { useFilterStore } from "@/stores/filter-store";
import type { PaginatedSamples } from "@/types/sample";

export function useSamples(datasetId: string) {
  // Read filter state -- each change creates a new query key
  const search = useFilterStore((s) => s.search);
  const category = useFilterStore((s) => s.category);
  const split = useFilterStore((s) => s.split);
  const tags = useFilterStore((s) => s.tags);
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortDir = useFilterStore((s) => s.sortDir);

  const filters = { search, category, split, tags, sortBy, sortDir };

  return useInfiniteQuery({
    // Filter state in key = automatic refetch on change
    queryKey: ["samples", datasetId, filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        dataset_id: datasetId,
        offset: String(pageParam),
        limit: String(PAGE_SIZE),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      if (split) params.set("split", split);
      if (tags.length > 0) params.set("tags", tags.join(","));

      return apiFetch<PaginatedSamples>(`/samples?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.limit;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    initialPageParam: 0,
  });
}
```

**Source:** [TkDodo: Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys), [TkDodo: Working with Zustand](https://tkdodo.eu/blog/working-with-zustand), [TanStack Query useInfiniteQuery docs](https://tanstack.com/query/v5/docs/react/reference/useInfiniteQuery)

**Confidence:** HIGH

### Pattern 3: Filter Facet Endpoint (Distinct Values)

**What:** A dedicated endpoint that returns the distinct values for each filterable field, so the frontend can populate dropdown options dynamically.

**When to use:** When building filter sidebar controls that need to show available options.

**Example:**

```python
# Added to app/routers/samples.py
@router.get("/filter-facets")
def get_filter_facets(
    dataset_id: str = Query(...),
    db: DuckDBRepo = Depends(get_db),
) -> dict:
    """Return distinct values for all filterable fields.

    Used by the frontend to populate filter dropdown options.
    Returns categories from annotations table, splits and tags from samples.
    """
    cursor = db.connection.cursor()
    try:
        # Categories (from annotations, not categories table -- captures actual usage)
        categories = [
            row[0] for row in cursor.execute(
                "SELECT DISTINCT category_name FROM annotations "
                "WHERE dataset_id = ? ORDER BY category_name",
                [dataset_id],
            ).fetchall()
        ]

        # Splits
        splits = [
            row[0] for row in cursor.execute(
                "SELECT DISTINCT split FROM samples "
                "WHERE dataset_id = ? AND split IS NOT NULL ORDER BY split",
                [dataset_id],
            ).fetchall()
        ]

        # Tags (unnest the LIST column, then distinct)
        tags = [
            row[0] for row in cursor.execute(
                "SELECT DISTINCT UNNEST(tags) AS tag FROM samples "
                "WHERE dataset_id = ? AND tags IS NOT NULL ORDER BY tag",
                [dataset_id],
            ).fetchall()
        ]
    finally:
        cursor.close()

    return {"categories": categories, "splits": splits, "tags": tags}
```

**Source:** [DuckDB SELECT DISTINCT](https://duckdb.org/docs/stable/sql/query_syntax/select), [DuckDB List Functions (UNNEST)](https://duckdb.org/docs/stable/sql/functions/list)

**Confidence:** HIGH

### Pattern 4: Saved Views (Persisted Filter Configurations)

**What:** A DuckDB table that stores named filter configurations as JSON. Users can save, load, update, and delete views. Each view belongs to a dataset.

**When to use:** FILT-03 requirement -- save and load filter configurations.

**Example:**

```python
# Schema addition to duckdb_repo.py initialize_schema()
"""
CREATE TABLE IF NOT EXISTS saved_views (
    id          VARCHAR NOT NULL,
    dataset_id  VARCHAR NOT NULL,
    name        VARCHAR NOT NULL,
    filters     JSON NOT NULL,
    created_at  TIMESTAMP DEFAULT current_timestamp,
    updated_at  TIMESTAMP DEFAULT current_timestamp
)
"""

# app/models/view.py
from pydantic import BaseModel
from datetime import datetime

class SavedViewCreate(BaseModel):
    dataset_id: str
    name: str
    filters: dict  # Serialized filter state

class SavedViewResponse(BaseModel):
    id: str
    dataset_id: str
    name: str
    filters: dict
    created_at: datetime
    updated_at: datetime

class SavedViewListResponse(BaseModel):
    views: list[SavedViewResponse]
```

```python
# app/routers/views.py
@router.post("", response_model=SavedViewResponse, status_code=201)
def create_view(request: SavedViewCreate, db=Depends(get_db)):
    """Save a named filter configuration."""
    view_id = str(uuid.uuid4())
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            "INSERT INTO saved_views (id, dataset_id, name, filters) "
            "VALUES (?, ?, ?, ?::JSON)",
            [view_id, request.dataset_id, request.name, json.dumps(request.filters)],
        )
    finally:
        cursor.close()
    # ... return the created view

@router.get("", response_model=SavedViewListResponse)
def list_views(dataset_id: str = Query(...), db=Depends(get_db)):
    """List all saved views for a dataset."""
    # SELECT from saved_views WHERE dataset_id = ?

@router.delete("/{view_id}", status_code=204)
def delete_view(view_id: str, db=Depends(get_db)):
    """Delete a saved view."""
    # DELETE FROM saved_views WHERE id = ?
```

**Source:** [DuckDB JSON Overview](https://duckdb.org/docs/stable/data/json/overview), existing CRUD patterns from `app/routers/datasets.py`

**Confidence:** HIGH

### Pattern 5: Tags on Samples (LIST Column + Bulk Operations)

**What:** Add a `tags VARCHAR[]` column to the `samples` table. Tags are stored as a DuckDB LIST, enabling `list_contains()` filtering. Bulk tagging uses a single UPDATE with an IN clause.

**When to use:** FILT-04 requirement -- add/remove tags on individual samples or bulk selections.

**Example:**

```python
# Schema migration: add tags column
"""
ALTER TABLE samples ADD COLUMN IF NOT EXISTS tags VARCHAR[] DEFAULT [];
"""

# Bulk add tag
@router.patch("/bulk-tag")
def bulk_add_tag(
    request: BulkTagRequest,  # { dataset_id, sample_ids, tag }
    db=Depends(get_db),
):
    """Add a tag to multiple samples."""
    placeholders = ", ".join(["?"] * len(request.sample_ids))
    cursor = db.connection.cursor()
    try:
        # Only add if not already present
        cursor.execute(
            f"UPDATE samples SET tags = list_distinct(list_append(COALESCE(tags, []), ?)) "
            f"WHERE dataset_id = ? AND id IN ({placeholders})",
            [request.tag, request.dataset_id] + request.sample_ids,
        )
    finally:
        cursor.close()
    return {"tagged": len(request.sample_ids)}

# Bulk remove tag
@router.patch("/bulk-untag")
def bulk_remove_tag(
    request: BulkTagRequest,
    db=Depends(get_db),
):
    """Remove a tag from multiple samples."""
    placeholders = ", ".join(["?"] * len(request.sample_ids))
    cursor = db.connection.cursor()
    try:
        cursor.execute(
            f"UPDATE samples SET tags = list_filter(COALESCE(tags, []), x -> x != ?) "
            f"WHERE dataset_id = ? AND id IN ({placeholders})",
            [request.tag, request.dataset_id] + request.sample_ids,
        )
    finally:
        cursor.close()
    return {"untagged": len(request.sample_ids)}
```

**Source:** [DuckDB List Functions](https://duckdb.org/docs/stable/sql/functions/list) (`list_contains`, `list_append`, `list_filter`, `list_distinct`), [DuckDB List Type](https://duckdb.org/docs/stable/sql/data_types/list)

**Confidence:** HIGH

### Pattern 6: Debounced Search Input

**What:** A search input component that debounces user keystrokes before updating the filter store, preventing excessive API calls. Uses React 19's `useDeferredValue` for rendering and a custom debounce for the store update.

**When to use:** The filename search input in the filter sidebar.

**Example:**

```typescript
// frontend/src/components/filters/search-input.tsx
"use client";

import { useState, useEffect, useDeferredValue } from "react";
import { useFilterStore } from "@/stores/filter-store";

const DEBOUNCE_MS = 300;

export function SearchInput() {
  const setSearch = useFilterStore((s) => s.setSearch);
  const storeSearch = useFilterStore((s) => s.search);

  // Local state for immediate input feedback
  const [localValue, setLocalValue] = useState(storeSearch);

  // Debounce: update store after user stops typing
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(localValue);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [localValue, setSearch]);

  // Sync when store changes externally (e.g., loading a saved view)
  useEffect(() => {
    setLocalValue(storeSearch);
  }, [storeSearch]);

  return (
    <input
      type="search"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      placeholder="Search by filename..."
      className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm
                 dark:border-zinc-600 dark:bg-zinc-800"
    />
  );
}
```

**Source:** [React useDeferredValue](https://react.dev/reference/react/useDeferredValue), standard debounce pattern

**Confidence:** HIGH

### Anti-Patterns to Avoid

- **String concatenation in SQL queries:** Never build SQL by concatenating user input. Always use parameterized queries (`?` placeholders). The existing `list_samples` correctly uses params -- the filter builder must continue this pattern.
- **User-provided column names in ORDER BY without allowlist:** `ORDER BY user_input` is a SQL injection vector even with parameterized queries (you can't parameterize column names). Always validate against an allowlist (`SORTABLE_COLUMNS`).
- **Fetching all samples then filtering client-side:** With 100K+ samples, client-side filtering is impossible. All filtering must happen via DuckDB SQL on the backend.
- **Creating a new Zustand store per filter change:** Use a single filter store with individual setters. Each setter call triggers a re-render only for subscribers of that specific field (atomic selectors).
- **Using `useEffect` to sync filter store to TanStack Query:** Don't manually call `refetch()` in an effect. Include filter state in the `queryKey` and TanStack Query handles refetch automatically. This is the "declarative queries" principle from TkDodo.
- **Storing filter state in URL from the start:** URL state adds complexity (serialization, SSR hydration, back-button handling). Start with Zustand store, add URL sync later via nuqs if needed. Saved views handle persistence.
- **Re-indexing FTS on every tag change:** DuckDB's FTS index does not auto-update. For filename search, use ILIKE instead -- it's consistent, requires no index maintenance, and performs well for <1M rows.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL injection prevention | Custom string escaping | DuckDB parameterized queries (`?` and `$name`) | Escaping is error-prone and incomplete. Parameterized queries are the only safe approach. |
| Tag list operations | Custom string splitting/joining (comma-separated tags) | DuckDB `VARCHAR[]` LIST column with `list_contains()`, `list_append()`, `list_filter()` | DuckDB's native LIST type handles all array operations efficiently. String-based tags require parsing, are prone to delimiter conflicts, and can't be indexed. |
| Debounced search | Complex debounce library with cancellation | `setTimeout`/`clearTimeout` in `useEffect` (5 lines) + `useDeferredValue` for render | The search debounce use case is simple: delay store update by 300ms. No need for a library. `useDeferredValue` handles the rendering side natively in React 19. |
| Filter facet computation | Client-side unique value extraction | DuckDB `SELECT DISTINCT` + `UNNEST` | DuckDB computes distinct values orders of magnitude faster than JavaScript for 100K+ rows. The facet endpoint returns pre-computed options. |
| Saved view serialization | Custom file-based persistence | DuckDB `JSON` column type | DuckDB natively stores and retrieves JSON. No file I/O, no serialization code, no migration concerns. Transactional with the rest of the data. |
| Multi-select filter dropdown | Custom checkbox list with scroll | HTML `<select multiple>` or a simple checkbox list component with Tailwind | A custom multi-select is UI complexity. Simple checkboxes with `max-h` + overflow-auto work well for filter dropdowns with <50 options. |

**Key insight:** The most complex part of this phase is the dynamic SQL query builder, but the pattern already exists in `list_samples`. The challenge is extending it cleanly (builder class) rather than adding more inline SQL. On the frontend, the key insight is that TanStack Query's query key mechanism eliminates the need for manual refetch orchestration -- include filter state in the key and everything "just works."

## Common Pitfalls

### Pitfall 1: Query Key Object Comparison Causes Infinite Refetch

**What goes wrong:** Including a filter object in the TanStack Query `queryKey` that creates a new reference on every render. This causes infinite refetches because TanStack Query uses structural comparison on the key.

**Why it happens:** Creating the filter object inline in the component body:
```typescript
// BAD: new object reference every render
queryKey: ["samples", datasetId, { search, category, split }]
```
This is actually fine because TanStack Query v5 uses deep structural comparison (not referential equality) for query keys. However, the pitfall arises if you include **unstable references** like unsorted arrays or functions.

**How to avoid:** Ensure arrays in the query key are sorted or use primitives. The filter store pattern above works because primitive values and sorted arrays are structurally stable:
```typescript
// GOOD: stable primitives + sorted array
queryKey: ["samples", datasetId, { search, category, split, tags: [...tags].sort(), sortBy, sortDir }]
```

**Warning signs:** Network tab shows repeated identical requests. TanStack Query DevTools shows the same query being refetched continuously.

**Confidence:** HIGH -- [TkDodo: Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys)

### Pitfall 2: ILIKE Performance Degradation on Very Large Datasets

**What goes wrong:** `ILIKE '%search_term%'` with a leading wildcard cannot use indexes and requires a full table scan. For 1M+ rows, this may cause noticeable latency (100ms+).

**Why it happens:** Leading wildcards (`%term`) prevent index utilization in any database. DuckDB's columnar storage helps (only the `file_name` column is scanned), but it's still O(n).

**How to avoid:** For Phase 3 (datasets typically <100K samples), ILIKE is fast enough (<50ms). If search becomes slow:
1. Add a DuckDB FTS index on `file_name` (but remember: FTS index doesn't auto-update)
2. Pre-compute a lowercase `file_name_lower` column and use `LIKE` instead of `ILIKE`
3. Consider prefix-only search (`LIKE 'term%'`) which can use indexes

**Warning signs:** Search response time exceeds 200ms. Users report lag when typing in the search box.

**Confidence:** HIGH -- [DuckDB Pattern Matching docs](https://duckdb.org/docs/stable/sql/functions/pattern_matching)

### Pitfall 3: Stale Infinite Query Pages After Filter Change

**What goes wrong:** After changing a filter, the grid shows old data from previous pages mixed with new filtered data, or the total count is wrong.

**Why it happens:** TanStack Query's `useInfiniteQuery` stores multiple pages in a single cache entry. If the filter is part of the query key, changing it creates a new cache entry (correct). But if the filter is NOT in the key and you manually refetch, you get stale pages.

**How to avoid:** Always include the complete filter state in the `queryKey`. Never use `refetch()` to handle filter changes. When the key changes, TanStack Query starts fresh with `initialPageParam: 0` -- this is the correct behavior.

```typescript
// CORRECT: filter in key = fresh start on filter change
queryKey: ["samples", datasetId, filters]

// WRONG: refetch() with same key = stale pages mixed with new data
useEffect(() => { refetch(); }, [filters]);
```

**Warning signs:** Grid shows inconsistent data after filter change. Total count doesn't match visible items. Scrolling after filter change loads old unfiltered pages.

**Confidence:** HIGH -- [TanStack Query Discussion #5692](https://github.com/TanStack/query/discussions/5692), [Discussion #2156](https://github.com/TanStack/query/discussions/2156)

### Pitfall 4: Tag UPDATE Without COALESCE Fails on NULL Lists

**What goes wrong:** Updating tags with `list_append(tags, 'new_tag')` fails or produces unexpected results when `tags` is NULL (not yet initialized).

**Why it happens:** DuckDB's `list_append(NULL, value)` returns NULL, not `[value]`. New samples have `tags = NULL` (not `tags = []`).

**How to avoid:** Always use `COALESCE(tags, [])` before list operations:
```sql
-- CORRECT
UPDATE samples SET tags = list_distinct(list_append(COALESCE(tags, []), ?))

-- WRONG: returns NULL if tags is NULL
UPDATE samples SET tags = list_distinct(list_append(tags, ?))
```

**Warning signs:** Tags fail to appear on samples that have never been tagged. Bulk tag operations silently skip some samples.

**Confidence:** HIGH -- verified via DuckDB LIST semantics

### Pitfall 5: SQL Injection via Column Name in ORDER BY

**What goes wrong:** A user-controlled `sort_by` parameter is interpolated directly into the SQL `ORDER BY` clause, enabling SQL injection (column names cannot be parameterized).

**Why it happens:** DuckDB (like all SQL databases) does not support parameterized column names:
```python
# CANNOT DO THIS -- ? is not allowed in ORDER BY column position
cursor.execute("SELECT * FROM samples ORDER BY ?", [user_column])
```

**How to avoid:** Validate column names against an allowlist before string interpolation:
```python
SORTABLE_COLUMNS = {"id", "file_name", "width", "height", "split"}
if sort_by not in SORTABLE_COLUMNS:
    sort_by = "id"  # default fallback
# Now safe to interpolate
sql = f"ORDER BY s.{sort_by} ASC"
```

**Warning signs:** Unvalidated user input appears in SQL strings. Security audit flags string interpolation in SQL queries.

**Confidence:** HIGH -- standard SQL security practice

### Pitfall 6: N+1 Query for Filter Facets on Every Filter Change

**What goes wrong:** Every time a filter changes, the frontend re-fetches the facet options (distinct categories, splits, tags). This creates unnecessary load when the facet values haven't changed.

**Why it happens:** Including the current filter state in the facet query key causes refetch on every filter change. But facet options should reflect the full dataset, not the current filter (otherwise selecting a category hides all other categories from the dropdown).

**How to avoid:** Facet query key should only include `dataset_id`, NOT the current filters:
```typescript
// CORRECT: facets are per-dataset, not per-filter-state
queryKey: ["filter-facets", datasetId]
// With long staleTime since facets rarely change mid-session
staleTime: 5 * 60 * 1000  // 5 minutes
```

The exception is tags -- new tags added via bulk tagging should invalidate the facet cache. Use `queryClient.invalidateQueries(["filter-facets", datasetId])` after a tag mutation.

**Warning signs:** Changing a filter causes two API calls (samples + facets). Filter dropdowns flicker when switching filters.

**Confidence:** HIGH

## Code Examples

### DuckDB Schema Migration for Tags and Saved Views

```sql
-- Source: DuckDB List Type docs + existing schema from duckdb_repo.py

-- Add tags column to existing samples table
ALTER TABLE samples ADD COLUMN IF NOT EXISTS tags VARCHAR[] DEFAULT [];

-- Saved views table
CREATE TABLE IF NOT EXISTS saved_views (
    id          VARCHAR NOT NULL,
    dataset_id  VARCHAR NOT NULL,
    name        VARCHAR NOT NULL,
    filters     JSON NOT NULL,
    created_at  TIMESTAMP DEFAULT current_timestamp,
    updated_at  TIMESTAMP DEFAULT current_timestamp
);
```

### Extended Samples Endpoint with Pydantic Query Model

```python
# app/models/sample.py (additions)
from pydantic import BaseModel, Field
from typing import Annotated, Literal

class SampleFilterParams(BaseModel):
    """Query parameters for filtered sample listing.

    Uses FastAPI's Query Parameter Models (v0.115+) for clean validation.
    """
    dataset_id: str
    category: str | None = None
    split: str | None = None
    search: str | None = None
    tags: str | None = None  # Comma-separated tag list
    sort_by: str = "id"
    sort_dir: Literal["asc", "desc"] = "asc"
    offset: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=200)

    model_config = {"extra": "forbid"}
```

```python
# app/routers/samples.py (modified list_samples)
from app.models.sample import SampleFilterParams

@router.get("", response_model=PaginatedSamples)
def list_samples(
    params: Annotated[SampleFilterParams, Query()],
    db: DuckDBRepo = Depends(get_db),
) -> PaginatedSamples:
    """Return paginated samples with dynamic filtering."""
    tag_list = (
        [t.strip() for t in params.tags.split(",") if t.strip()]
        if params.tags
        else None
    )

    builder = SampleFilterBuilder()
    result = (
        builder
        .add_dataset(params.dataset_id)
        .add_split(params.split)
        .add_category(params.category)
        .add_search(params.search)
        .add_tags(tag_list)
        .build(sort_by=params.sort_by, sort_dir=params.sort_dir)
    )

    distinct = "DISTINCT " if result.join_clause else ""
    cursor = db.connection.cursor()
    try:
        count_sql = (
            f"SELECT COUNT({distinct}s.id) FROM samples s "
            f"{result.join_clause} WHERE {result.where_clause}"
        )
        total = cursor.execute(count_sql, result.params).fetchone()[0]

        data_sql = (
            f"SELECT {distinct}s.id, s.dataset_id, s.file_name, "
            f"s.width, s.height, s.thumbnail_path, s.split, s.tags "
            f"FROM samples s {result.join_clause} "
            f"WHERE {result.where_clause} "
            f"{result.order_clause} LIMIT ? OFFSET ?"
        )
        rows = cursor.execute(
            data_sql, result.params + [params.limit, params.offset]
        ).fetchall()
    finally:
        cursor.close()

    items = [
        SampleResponse(
            id=row[0], dataset_id=row[1], file_name=row[2],
            width=row[3], height=row[4], thumbnail_path=row[5],
            split=row[6], tags=row[7] or [],
        )
        for row in rows
    ]
    return PaginatedSamples(items=items, total=total, offset=params.offset, limit=params.limit)
```

**Source:** [FastAPI Query Parameter Models](https://fastapi.tiangolo.com/tutorial/query-param-models/), [DuckDB Parameterized Queries](https://duckdb.org/docs/stable/guides/python/execute_sql)

**Confidence:** HIGH

### Filter Sidebar Component Structure

```typescript
// frontend/src/components/filters/filter-sidebar.tsx
"use client";

import { SearchInput } from "./search-input";
import { FilterSelect } from "./filter-select";
import { SortControls } from "./sort-controls";
import { SavedViewPicker } from "./saved-view-picker";
import { useFilterFacets } from "@/hooks/use-filter-facets";
import { useFilterStore } from "@/stores/filter-store";

interface FilterSidebarProps {
  datasetId: string;
}

export function FilterSidebar({ datasetId }: FilterSidebarProps) {
  const { data: facets } = useFilterFacets(datasetId);
  const { clearFilters } = useFilterStore((s) => ({
    clearFilters: s.clearFilters,
  }));

  return (
    <aside className="flex w-64 flex-col gap-4 border-r border-zinc-200 p-4
                       dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Filters
        </h2>
        <button
          onClick={clearFilters}
          className="text-xs text-zinc-500 hover:text-zinc-900
                     dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Clear all
        </button>
      </div>

      <SearchInput />

      <FilterSelect
        label="Category"
        options={facets?.categories ?? []}
        storeKey="category"
      />

      <FilterSelect
        label="Split"
        options={facets?.splits ?? []}
        storeKey="split"
      />

      <FilterSelect
        label="Tags"
        options={facets?.tags ?? []}
        storeKey="tags"
        multiple
      />

      <SortControls />

      <SavedViewPicker datasetId={datasetId} />
    </aside>
  );
}
```

**Confidence:** HIGH

### API Fetch Helpers for Mutations

```typescript
// frontend/src/lib/api.ts (additions)
import { API_BASE } from "./constants";

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
}
```

**Confidence:** HIGH

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Comma-separated tag strings in VARCHAR column | DuckDB `VARCHAR[]` LIST column with `list_contains()` | DuckDB native LIST support | First-class array operations, no parsing, no delimiter conflicts |
| Manual `refetch()` calls in useEffect on filter change | Filter state in TanStack Query `queryKey` for automatic refetch | TanStack Query v4+ (2022+) | Declarative data fetching, no manual synchronization, better caching |
| Individual FastAPI `Query()` params for each filter | Pydantic Query Parameter Models | FastAPI 0.115.0 (2024) | Grouped validation, reusable filter schemas, cleaner endpoint signatures |
| Client-side filtering of fetched data | Server-side SQL filtering via DuckDB | Always for large datasets | Required for 100K+ samples. DuckDB handles filtering in milliseconds. |
| Hand-rolled debounce with `useRef` + `setTimeout` | React 19 `useDeferredValue` + simple `useEffect` debounce | React 18+ (2022+) | Built-in transition-aware deferral. Custom debounce only needed for API calls, not rendering. |

**Deprecated/outdated:**
- `@app.on_event("startup")`: Already deprecated per Phase 1 research. Continue using lifespan.
- Client-side tag manipulation with string splitting: Use DuckDB LIST operations server-side.
- `useQuery` with `enabled: false` + manual `refetch()` for filtering: Use declarative query keys instead.

## Open Questions

1. **Faceted filter counts: should filters show match counts?**
   - What we know: E-commerce-style filters show "(42)" next to each option. This requires a COUNT query per facet value, potentially expensive.
   - What's unclear: Whether match counts are needed for v1 or are a nice-to-have.
   - Recommendation: Skip counts for v1. Just show the option list. Add counts in a future enhancement if users request them. The SQL is straightforward (`SELECT category_name, COUNT(DISTINCT sample_id) FROM annotations GROUP BY category_name`) but adds latency to facet endpoint.

2. **Cross-filter dependency: should selecting a category filter the split options?**
   - What we know: "Independent facets" show all options regardless of other filters. "Dependent facets" filter options based on current filter state (e.g., selecting category "dog" hides splits that have no dogs).
   - What's unclear: Which UX is expected.
   - Recommendation: Independent facets for v1. Simpler implementation, avoids the confusing UX where options disappear as you filter. Users can always clear filters to see all options.

3. **Bulk selection mechanism: checkbox-based or lasso/rectangle select?**
   - What we know: FILT-04 requires bulk tagging. This needs a selection mechanism. Checkboxes are simple and accessible. Lasso/rectangle select is more intuitive for image grids but complex to implement.
   - What's unclear: Expected interaction pattern.
   - Recommendation: Checkbox-based selection for v1. Add a checkbox overlay to each grid cell, with "Select All" / "Select None" controls. Add Shift+click for range selection. Lasso selection is a future enhancement.

4. **Tag creation flow: free-form or pre-defined tag list?**
   - What we know: Free-form tags (user types any string) are more flexible. Pre-defined tags (admin creates tag vocabulary) are more controlled.
   - What's unclear: Expected workflow.
   - Recommendation: Free-form tags for v1. Users can type any tag when adding tags. The tag list for filtering is dynamically computed from existing tags (`SELECT DISTINCT UNNEST(tags)`). No admin tag management needed.

5. **Schema migration strategy: ALTER TABLE vs recreate**
   - What we know: DuckDB supports `ALTER TABLE ADD COLUMN`. But the existing data has no tags.
   - What's unclear: Whether to run ALTER TABLE on app startup or require a manual migration step.
   - Recommendation: Add the ALTER TABLE statement to `initialize_schema()` in `duckdb_repo.py`, guarded by `IF NOT EXISTS`. This is idempotent and runs on every startup. For `saved_views`, `CREATE TABLE IF NOT EXISTS` in the same method. No manual migration needed.

## Sources

### Primary (HIGH confidence)
- [DuckDB Parameterized Queries](https://duckdb.org/docs/stable/guides/python/execute_sql) -- `?` and `$name` syntax, SQL injection prevention
- [DuckDB Pattern Matching](https://duckdb.org/docs/stable/sql/functions/pattern_matching) -- LIKE, ILIKE, SIMILAR TO operators
- [DuckDB List Type](https://duckdb.org/docs/stable/sql/data_types/list) -- VARCHAR[] column, list creation, indexing
- [DuckDB List Functions](https://duckdb.org/docs/stable/sql/functions/list) -- `list_contains`, `list_has_any`, `list_has_all`, `list_append`, `list_filter`, `list_distinct`, `UNNEST`
- [DuckDB JSON Overview](https://duckdb.org/docs/stable/data/json/overview) -- JSON column type, `->>`  operator, `json_extract_string`
- [DuckDB Full-Text Search Extension](https://duckdb.org/docs/stable/core_extensions/full_text_search) -- FTS index, BM25 scoring, limitations (no auto-update)
- [FastAPI Query Parameter Models](https://fastapi.tiangolo.com/tutorial/query-param-models/) -- Pydantic model for grouped query params (v0.115+)
- [TkDodo: Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys) -- Key factory pattern, hierarchical keys, invalidation strategies
- [TkDodo: Working with Zustand](https://tkdodo.eu/blog/working-with-zustand) -- Atomic selectors, action organization, store composition with TanStack Query
- [TanStack Query v5: useInfiniteQuery](https://tanstack.com/query/v5/docs/react/reference/useInfiniteQuery) -- infinite queries, maxPages, filter in key pattern
- [React useDeferredValue](https://react.dev/reference/react/useDeferredValue) -- built-in deferred rendering for search

### Secondary (MEDIUM confidence)
- [TanStack Query Discussion #7093](https://github.com/TanStack/query/discussions/7093) -- useInfiniteQuery with server-side filtering
- [TanStack Query Discussion #5692](https://github.com/TanStack/query/discussions/5692) -- infinite query refetch with pagination reset
- [nuqs GitHub](https://github.com/47ng/nuqs) -- type-safe URL search params state manager for React
- [Charles Leifer: Tagging Schemas](https://charlesleifer.com/blog/a-tour-of-tagging-schemas-many-to-many-bitmaps-and-more/) -- many-to-many vs LIST vs bitmap approaches
- [DuckDB Text Analytics](https://duckdb.org/2025/06/13/text-analytics) -- ILIKE performance for keyword search

### Tertiary (LOW confidence)
- [fastapi-filter library](https://fastapi-filter.netlify.app/) -- third-party filter library (not needed, but referenced for pattern inspiration)
- [react-admin FilterList](https://marmelab.com/react-admin/FilterList.html) -- sidebar filter UI pattern reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed, all patterns verified with existing codebase + official docs
- Architecture patterns: HIGH -- filter builder extends existing `list_samples` pattern, Zustand + TanStack Query integration verified with TkDodo's authoritative blog posts and official docs
- DuckDB LIST/tags: HIGH -- `list_contains`, `list_append`, `list_filter` verified with official DuckDB docs
- Pitfalls: HIGH -- query key stability, ILIKE performance, NULL list handling all verified with official sources
- Code examples: HIGH -- patterns follow existing codebase conventions (cursor-per-request, Pydantic models, Zustand create pattern)

**Research date:** 2026-02-11
**Valid until:** 2026-04-11 (stable stack, 60-day window)
