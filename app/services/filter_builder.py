"""Dynamic SQL query builder for sample filtering.

Constructs parameterized DuckDB SQL from filter parameters.
All user input goes through parameterized queries (?) to prevent
SQL injection. Column names are validated against an allowlist.
"""

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

    Usage::

        builder = SampleFilterBuilder()
        result = (
            builder
            .add_dataset(dataset_id)
            .add_split(split)
            .add_category(category)
            .add_search(search)
            .add_tags(tag_list)
            .build(sort_by=sort_by, sort_dir=sort_dir)
        )
    """

    # Columns that can be sorted -- prevents SQL injection via column names
    SORTABLE_COLUMNS = {"id", "file_name", "width", "height", "split"}

    def __init__(self) -> None:
        self.conditions: list[str] = []
        self.params: list = []
        self.joins: list[str] = []

    def add_dataset(self, dataset_id: str) -> "SampleFilterBuilder":
        """Filter by dataset ID (required)."""
        self.conditions.append("s.dataset_id = ?")
        self.params.append(dataset_id)
        return self

    def add_split(self, split: str | None) -> "SampleFilterBuilder":
        """Filter by split (train/val/test). Skipped if None."""
        if split is not None:
            self.conditions.append("s.split = ?")
            self.params.append(split)
        return self

    def add_category(self, category: str | None) -> "SampleFilterBuilder":
        """Filter by annotation category. Adds JOIN to annotations table."""
        if category is not None:
            self.joins.append(
                "JOIN annotations a ON s.id = a.sample_id "
                "AND a.dataset_id = s.dataset_id"
            )
            self.conditions.append("a.category_name = ?")
            self.params.append(category)
        return self

    def add_search(self, search: str | None) -> "SampleFilterBuilder":
        """Filter by filename search (case-insensitive ILIKE)."""
        if search is not None and search.strip():
            self.conditions.append("s.file_name ILIKE ?")
            self.params.append(f"%{search.strip()}%")
        return self

    def add_tags(self, tags: list[str] | None) -> "SampleFilterBuilder":
        """Filter samples that have ALL of the given tags (AND logic)."""
        if tags:
            for tag in tags:
                self.conditions.append("list_contains(s.tags, ?)")
                self.params.append(tag)
        return self

    def build_order(
        self, sort_by: str | None, sort_dir: str | None
    ) -> str:
        """Build ORDER BY clause with allowlisted column validation."""
        if sort_by and sort_by in self.SORTABLE_COLUMNS:
            direction = "DESC" if sort_dir == "desc" else "ASC"
            return f"ORDER BY s.{sort_by} {direction}"
        return "ORDER BY s.id ASC"

    def build(
        self, sort_by: str | None = None, sort_dir: str | None = None
    ) -> FilterResult:
        """Build the final FilterResult with WHERE, JOIN, and ORDER clauses."""
        where = " AND ".join(self.conditions) if self.conditions else "TRUE"
        join = " ".join(self.joins)
        order = self.build_order(sort_by, sort_dir)
        return FilterResult(
            where_clause=where,
            params=list(self.params),
            join_clause=join,
            order_clause=order,
        )
