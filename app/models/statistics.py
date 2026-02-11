"""Response models for dataset statistics endpoint."""

from pydantic import BaseModel


class ClassDistribution(BaseModel):
    """Per-category annotation counts split by source (GT vs prediction)."""

    category_name: str
    gt_count: int
    pred_count: int


class SplitBreakdown(BaseModel):
    """Sample count per dataset split (train/val/test/unassigned)."""

    split_name: str
    count: int


class SummaryStats(BaseModel):
    """Aggregate counts across the entire dataset."""

    total_images: int
    gt_annotations: int
    pred_annotations: int
    total_categories: int


class DatasetStatistics(BaseModel):
    """Combined statistics payload for a single dataset."""

    class_distribution: list[ClassDistribution]
    split_breakdown: list[SplitBreakdown]
    summary: SummaryStats
