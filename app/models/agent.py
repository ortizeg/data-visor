"""Pydantic models for the AI agent error analysis endpoint."""

from typing import Literal

from pydantic import BaseModel, Field


class PatternInsight(BaseModel):
    """A detected error pattern with supporting evidence."""

    pattern: str = Field(description="Natural language description of the error pattern")
    evidence: str = Field(description="Data or statistics supporting this pattern")
    severity: Literal["high", "medium", "low"] = Field(
        description="Impact severity of this pattern"
    )
    affected_classes: list[str] = Field(
        default_factory=list,
        description="Object detection classes affected by this pattern",
    )


class Recommendation(BaseModel):
    """A specific corrective action to improve model performance."""

    action: str = Field(description="Specific corrective action to take")
    rationale: str = Field(description="Why this action addresses the identified pattern")
    priority: Literal["high", "medium", "low"] = Field(
        description="Implementation priority"
    )
    category: Literal[
        "data_collection",
        "augmentation",
        "labeling",
        "architecture",
        "hyperparameter",
    ] = Field(description="Category of corrective action")


class AnalysisReport(BaseModel):
    """Structured output from the AI agent error analysis."""

    patterns: list[PatternInsight] = Field(
        description="Detected error patterns with evidence"
    )
    recommendations: list[Recommendation] = Field(
        description="Prioritized corrective actions"
    )
    summary: str = Field(description="Executive summary of the analysis findings")


class AnalysisRequest(BaseModel):
    """Request body for the /analyze endpoint."""

    source: str = Field(
        default="prediction",
        description="Prediction source name to analyze against ground truth",
    )
    iou_threshold: float = Field(
        default=0.5,
        ge=0.1,
        le=1.0,
        description="IoU threshold for matching predictions to ground truth",
    )
    conf_threshold: float = Field(
        default=0.25,
        ge=0.0,
        le=1.0,
        description="Minimum confidence threshold for predictions",
    )
