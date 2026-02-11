"""DuckDB connection wrapper with schema initialization."""

from pathlib import Path

import duckdb


class DuckDBRepo:
    """Manages a DuckDB connection and schema lifecycle.

    Opens a single persistent connection at startup.  Callers obtain
    cursors via ``connection.cursor()`` for concurrent read access.
    """

    def __init__(self, db_path: str | Path) -> None:
        db_path = Path(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection: duckdb.DuckDBPyConnection = duckdb.connect(str(db_path))
        self.connection.execute("PRAGMA threads=4")

    def initialize_schema(self) -> None:
        """Create core tables if they do not already exist.

        No PRIMARY KEY or FOREIGN KEY constraints are used -- this
        yields ~3.8x faster bulk inserts (per Phase 1 research).
        """
        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS datasets (
                id              VARCHAR NOT NULL,
                name            VARCHAR NOT NULL,
                format          VARCHAR NOT NULL,
                source_path     VARCHAR NOT NULL,
                image_dir       VARCHAR NOT NULL,
                image_count     INTEGER DEFAULT 0,
                annotation_count INTEGER DEFAULT 0,
                category_count  INTEGER DEFAULT 0,
                created_at      TIMESTAMP DEFAULT current_timestamp,
                metadata        JSON
            )
        """)

        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS samples (
                id              VARCHAR NOT NULL,
                dataset_id      VARCHAR NOT NULL,
                file_name       VARCHAR NOT NULL,
                width           INTEGER NOT NULL,
                height          INTEGER NOT NULL,
                thumbnail_path  VARCHAR,
                split           VARCHAR,
                metadata        JSON
            )
        """)

        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS annotations (
                id              VARCHAR NOT NULL,
                dataset_id      VARCHAR NOT NULL,
                sample_id       VARCHAR NOT NULL,
                category_name   VARCHAR NOT NULL,
                bbox_x          DOUBLE NOT NULL,
                bbox_y          DOUBLE NOT NULL,
                bbox_w          DOUBLE NOT NULL,
                bbox_h          DOUBLE NOT NULL,
                area            DOUBLE DEFAULT 0.0,
                is_crowd        BOOLEAN DEFAULT false,
                source          VARCHAR DEFAULT 'ground_truth',
                confidence      DOUBLE,
                metadata        JSON
            )
        """)

        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                dataset_id      VARCHAR NOT NULL,
                category_id     INTEGER NOT NULL,
                name            VARCHAR NOT NULL,
                supercategory   VARCHAR
            )
        """)

        # Phase 3: Add tags column to samples (idempotent)
        self.connection.execute(
            "ALTER TABLE samples ADD COLUMN IF NOT EXISTS tags VARCHAR[] DEFAULT []"
        )

        # Phase 3: Saved views table for persisted filter configurations
        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS saved_views (
                id              VARCHAR NOT NULL,
                dataset_id      VARCHAR NOT NULL,
                name            VARCHAR NOT NULL,
                filters         JSON NOT NULL,
                created_at      TIMESTAMP DEFAULT current_timestamp,
                updated_at      TIMESTAMP DEFAULT current_timestamp
            )
        """)

    def close(self) -> None:
        """Close the underlying DuckDB connection."""
        self.connection.close()
