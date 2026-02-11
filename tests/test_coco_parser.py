"""Tests for the streaming COCO parser."""

from pathlib import Path

import pytest

from app.ingestion.coco_parser import COCOParser

FIXTURES = Path(__file__).parent / "fixtures"
SMALL_COCO = FIXTURES / "small_coco.json"
MALFORMED_COCO = FIXTURES / "malformed_coco.json"


@pytest.fixture()
def parser() -> COCOParser:
    return COCOParser(batch_size=1000)


# ------------------------------------------------------------------
# Category parsing
# ------------------------------------------------------------------


def test_parse_categories(parser: COCOParser) -> None:
    cats = parser.parse_categories(SMALL_COCO)
    assert len(cats) == 3
    assert cats[1] == "person"
    assert cats[2] == "car"
    assert cats[3] == "dog"


def test_malformed_missing_categories(parser: COCOParser) -> None:
    """Malformed file without 'categories' key returns empty dict."""
    cats = parser.parse_categories(MALFORMED_COCO)
    assert cats == {}


# ------------------------------------------------------------------
# Streaming helpers
# ------------------------------------------------------------------


def test_parse_images_streaming(parser: COCOParser) -> None:
    images = list(parser.parse_images_streaming(SMALL_COCO))
    assert len(images) == 10


def test_parse_annotations_streaming(parser: COCOParser) -> None:
    annotations = list(parser.parse_annotations_streaming(SMALL_COCO))
    assert len(annotations) == 17


# ------------------------------------------------------------------
# DataFrame batch builders -- images
# ------------------------------------------------------------------


def test_build_image_batches_columns(parser: COCOParser) -> None:
    """Verify DataFrame columns match the DuckDB samples table."""
    batches = list(parser.build_image_batches(SMALL_COCO, "ds-1"))
    assert len(batches) >= 1
    expected_cols = [
        "id", "dataset_id", "file_name", "width", "height",
        "thumbnail_path", "split", "metadata",
    ]
    assert list(batches[0].columns) == expected_cols


def test_build_image_batches_row_count(parser: COCOParser) -> None:
    batches = list(parser.build_image_batches(SMALL_COCO, "ds-1"))
    total = sum(len(b) for b in batches)
    assert total == 10


def test_batch_size_respected() -> None:
    small_parser = COCOParser(batch_size=3)
    batches = list(small_parser.build_image_batches(SMALL_COCO, "ds-1"))
    for batch in batches[:-1]:  # all but last may be smaller
        assert len(batch) == 3
    assert len(batches[-1]) <= 3


# ------------------------------------------------------------------
# DataFrame batch builders -- annotations
# ------------------------------------------------------------------


def test_build_annotation_batches_columns(parser: COCOParser) -> None:
    """Verify DataFrame columns match the DuckDB annotations table."""
    cats = parser.parse_categories(SMALL_COCO)
    batches = list(parser.build_annotation_batches(SMALL_COCO, "ds-1", cats))
    assert len(batches) >= 1
    expected_cols = [
        "id", "dataset_id", "sample_id", "category_name",
        "bbox_x", "bbox_y", "bbox_w", "bbox_h",
        "area", "is_crowd", "source", "confidence", "metadata",
    ]
    assert list(batches[0].columns) == expected_cols


def test_build_annotation_batches_row_count(parser: COCOParser) -> None:
    cats = parser.parse_categories(SMALL_COCO)
    batches = list(parser.build_annotation_batches(SMALL_COCO, "ds-1", cats))
    total = sum(len(b) for b in batches)
    assert total == 17


def test_iscrowd_handled(parser: COCOParser) -> None:
    """iscrowd=1 should produce is_crowd=True in the DataFrame."""
    cats = parser.parse_categories(SMALL_COCO)
    batches = list(parser.build_annotation_batches(SMALL_COCO, "ds-1", cats))
    all_rows = batches[0]  # single batch since batch_size=1000
    crowd_rows = all_rows[all_rows["is_crowd"] == True]  # noqa: E712
    assert len(crowd_rows) == 1
    assert crowd_rows.iloc[0]["id"] == "10"


def test_unknown_category_id(parser: COCOParser) -> None:
    """Annotation with unknown category_id gets 'unknown' as category_name."""
    # malformed_coco.json has category_id=999 which maps to no category
    cats = parser.parse_categories(MALFORMED_COCO)  # empty dict
    batches = list(parser.build_annotation_batches(MALFORMED_COCO, "ds-1", cats))
    all_rows = batches[0]
    # All annotations should have "unknown" since there are no categories
    assert (all_rows["category_name"] == "unknown").all()


def test_malformed_missing_width() -> None:
    """Image with missing width defaults to 0."""
    parser = COCOParser(batch_size=1000)
    batches = list(parser.build_image_batches(MALFORMED_COCO, "ds-1"))
    all_rows = batches[0]
    # Image id=2 has no width
    row = all_rows[all_rows["id"] == "2"].iloc[0]
    assert row["width"] == 0


def test_malformed_missing_bbox() -> None:
    """Annotation with missing bbox defaults to zeros."""
    parser = COCOParser(batch_size=1000)
    cats: dict[int, str] = {}
    batches = list(parser.build_annotation_batches(MALFORMED_COCO, "ds-1", cats))
    all_rows = batches[0]
    # Annotation id=3 has no bbox key
    row = all_rows[all_rows["id"] == "3"].iloc[0]
    assert row["bbox_x"] == 0.0
    assert row["bbox_y"] == 0.0
    assert row["bbox_w"] == 0.0
    assert row["bbox_h"] == 0.0
