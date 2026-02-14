"""Pydantic AI agent for object detection error pattern analysis.

Pre-computes all data (error summary, per-class counts, tag correlations,
confidence distributions) and passes it directly in the prompt. The agent
produces a structured AnalysisReport without needing tool calls.
"""

from __future__ import annotations

import logging

from duckdb import DuckDBPyConnection
from pydantic_ai import Agent

from app.models.agent import AnalysisReport
from app.services.error_analysis import categorize_errors

logger = logging.getLogger(__name__)

# Agent created lazily to defer model resolution until first call.
_agent: Agent[None, AnalysisReport] | None = None


def _get_agent() -> Agent[None, AnalysisReport]:
    """Create and cache the analysis agent on first call."""
    global _agent
    if _agent is not None:
        return _agent

    from app.config import get_settings

    settings = get_settings()

    _agent = Agent(
        settings.agent_model,
        output_type=AnalysisReport,
        instructions=(
            "You are an ML engineer specializing in object detection error analysis. "
            "You will receive pre-computed error data for a dataset. Analyze it and "
            "produce structured pattern insights and actionable recommendations.\n\n"
            "Be data-driven: cite numbers from the data as evidence for each pattern.\n\n"
            "Focus on actionable insights: which classes need more data, what "
            "confidence thresholds to adjust, and whether labeling quality or "
            "data collection should be prioritized."
        ),
    )
    return _agent


def _format_table(headers: list[str], rows: list[tuple]) -> str:
    """Format query results as a pipe-separated table string for LLM readability."""
    lines = [" | ".join(headers)]
    lines.append(" | ".join(["---"] * len(headers)))
    for row in rows:
        lines.append(" | ".join(str(v) for v in row))
    return "\n".join(lines)


def _build_confidence_table(samples: list, error_type: str) -> str:
    """Build confidence distribution table for an error type."""
    if not samples:
        return f"No samples for '{error_type}'."
    buckets = {"0.0-0.3": 0, "0.3-0.5": 0, "0.5-0.7": 0, "0.7-0.9": 0, "0.9-1.0": 0}
    for s in samples:
        conf = s.confidence
        if conf is None:
            continue
        if conf >= 0.9:
            buckets["0.9-1.0"] += 1
        elif conf >= 0.7:
            buckets["0.7-0.9"] += 1
        elif conf >= 0.5:
            buckets["0.5-0.7"] += 1
        elif conf >= 0.3:
            buckets["0.3-0.5"] += 1
        else:
            buckets["0.0-0.3"] += 1
    rows = [(k, v) for k, v in buckets.items() if v > 0]
    if not rows:
        return f"No confidence data for '{error_type}'."
    return _format_table(["confidence_range", "count"], rows)


def _build_tag_table(cursor: DuckDBPyConnection, dataset_id: str, samples: list, error_type: str) -> str:
    """Build tag correlation table for an error type."""
    if not samples:
        return f"No samples for '{error_type}'."
    sample_ids = list({s.sample_id for s in samples})
    placeholders = ", ".join(["?"] * len(sample_ids))
    rows = cursor.execute(
        f"SELECT tag, COUNT(*) AS cnt "
        f"FROM ("
        f"  SELECT UNNEST(s.tags) AS tag "
        f"  FROM samples s "
        f"  WHERE s.dataset_id = ? "
        f"  AND s.id IN ({placeholders})"
        f") "
        f"GROUP BY tag ORDER BY cnt DESC LIMIT 10",
        [dataset_id, *sample_ids],
    ).fetchall()
    if not rows:
        return "No tag data available."
    return _format_table(["tag", "count"], rows)


def run_analysis(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str = "prediction",
    iou_threshold: float = 0.45,
    conf_threshold: float = 0.25,
) -> AnalysisReport:
    """Run the AI agent to analyze error patterns and produce recommendations.

    1. Computes error categorization via categorize_errors()
    2. Pre-computes all data tables (no tool calls needed)
    3. Runs the Pydantic AI agent with a single prompt
    4. Returns structured AnalysisReport

    Raises:
        ValueError: If the agent model is not configured or the API key is missing.
    """
    try:
        agent = _get_agent()
    except Exception as exc:
        raise ValueError(
            f"Failed to initialize agent. Ensure DATAVISOR_AGENT_MODEL is set "
            f"and the corresponding API key is configured: {exc}"
        ) from exc

    # Pre-compute error analysis
    error_data = categorize_errors(
        cursor, dataset_id, source, iou_threshold, conf_threshold
    )

    # Pre-compute per-class breakdown
    rows = cursor.execute(
        "SELECT category_name, "
        "COUNT(*) FILTER (WHERE source = 'ground_truth') AS gt_count, "
        "COUNT(*) FILTER (WHERE source = ?) AS pred_count "
        "FROM annotations WHERE dataset_id = ? "
        "GROUP BY category_name "
        "ORDER BY gt_count DESC "
        "LIMIT 50",
        [source, dataset_id],
    ).fetchall()
    per_class_table = _format_table(["class", "gt_count", "pred_count"], rows) if rows else "No data."

    # Pre-compute confidence distributions and tag correlations for each error type
    error_types = ["tp", "hard_fp", "false_negative", "label_error"]
    confidence_sections = []
    tag_sections = []
    for et in error_types:
        samples = error_data.samples_by_type.get(et, [])
        confidence_sections.append(f"### {et}\n{_build_confidence_table(samples, et)}")
        tag_sections.append(f"### {et}\n{_build_tag_table(cursor, dataset_id, samples, et)}")

    summary = error_data.summary.model_dump()

    prompt = (
        f"Analyze the error distribution for dataset '{dataset_id}' "
        f"(source='{source}', IoU threshold={iou_threshold}, "
        f"confidence threshold={conf_threshold}).\n\n"
        f"## Error Summary\n{summary}\n\n"
        f"## Per-Class Breakdown\n{per_class_table}\n\n"
        f"## Confidence Distributions\n" + "\n".join(confidence_sections) + "\n\n"
        f"## Tag Correlations\n" + "\n".join(tag_sections) + "\n\n"
        f"Provide specific, actionable recommendations based on this data."
    )

    try:
        result = agent.run_sync(prompt)
        return result.output
    except Exception as exc:
        error_msg = str(exc).lower()
        if any(
            keyword in error_msg
            for keyword in [
                "api key",
                "authentication",
                "unauthorized",
                "401",
                "403",
                "not authenticated",
                "invalid api key",
                "missing api key",
            ]
        ):
            raise ValueError(
                "LLM API key not configured. Set the appropriate API key "
                "environment variable (e.g., GEMINI_API_KEY) "
                "for the model specified in DATAVISOR_AGENT_MODEL."
            ) from exc
        raise RuntimeError(
            f"Agent analysis failed: {exc}"
        ) from exc
