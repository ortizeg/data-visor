"""Pydantic AI agent for object detection error pattern analysis.

Defines an LLM agent with DuckDB query tools that analyzes error
distributions from categorize_errors() and produces structured
pattern insights and recommendations.

The agent uses 4 tools:
1. get_error_summary - Pre-computed error counts (no SQL)
2. get_per_class_errors - Per-class annotation counts from DuckDB
3. get_tag_error_correlation - Tags correlated with error types
4. get_confidence_distribution - Confidence score distribution by error type
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from duckdb import DuckDBPyConnection
from pydantic_ai import Agent, RunContext

from app.models.agent import AnalysisReport
from app.models.error_analysis import ErrorSample
from app.services.error_analysis import categorize_errors

logger = logging.getLogger(__name__)


@dataclass
class AnalysisDeps:
    """Dependencies injected into the error analysis agent."""

    cursor: DuckDBPyConnection
    dataset_id: str
    source: str
    error_summary: dict
    error_samples: dict[str, list[ErrorSample]] = field(default_factory=dict)


# Agent created lazily to defer model resolution until first call.
_agent: Agent[AnalysisDeps, AnalysisReport] | None = None


def _get_agent() -> Agent[AnalysisDeps, AnalysisReport]:
    """Create and cache the analysis agent on first call."""
    global _agent
    if _agent is not None:
        return _agent

    from app.config import get_settings

    settings = get_settings()

    agent = Agent(
        settings.agent_model,
        deps_type=AnalysisDeps,
        output_type=AnalysisReport,
        instructions=(
            "You are an ML engineer specializing in object detection error analysis. "
            "Analyze the error distribution for this dataset and recommend specific "
            "corrective actions to improve model performance.\n\n"
            "Use the provided tools to query error distributions, per-class metrics, "
            "tag correlations, and confidence distributions. Be data-driven: cite "
            "numbers from your tool queries as evidence for each pattern.\n\n"
            "Focus on actionable insights: which classes need more data, what "
            "confidence thresholds to adjust, and whether labeling quality or "
            "data collection should be prioritized."
        ),
    )

    @agent.tool
    def get_error_summary(ctx: RunContext[AnalysisDeps]) -> str:
        """Get overall error type counts (True Positives, Hard False Positives, Label Errors, False Negatives)."""
        return str(ctx.deps.error_summary)

    @agent.tool
    def get_per_class_errors(ctx: RunContext[AnalysisDeps]) -> str:
        """Get annotation counts per class, broken down by ground truth vs predictions. Shows which classes have the most annotations and potential imbalances."""
        rows = ctx.deps.cursor.execute(
            "SELECT category_name, "
            "COUNT(*) FILTER (WHERE source = 'ground_truth') AS gt_count, "
            "COUNT(*) FILTER (WHERE source = ?) AS pred_count "
            "FROM annotations WHERE dataset_id = ? "
            "GROUP BY category_name "
            "ORDER BY gt_count DESC "
            "LIMIT 50",
            [ctx.deps.source, ctx.deps.dataset_id],
        ).fetchall()
        if not rows:
            return "No annotation data available."
        return _format_table(["class", "gt_count", "pred_count"], rows)

    @agent.tool
    def get_tag_error_correlation(
        ctx: RunContext[AnalysisDeps], error_type: str
    ) -> str:
        """Find which VLM-generated tags correlate with a specific error type. Helps identify environmental conditions (dark, blurry, crowded) that cause errors.

        Args:
            error_type: One of 'tp', 'hard_fp', 'false_negative', 'label_error'
        """
        samples = ctx.deps.error_samples.get(error_type, [])
        if not samples:
            return f"No samples found for error type '{error_type}'."

        sample_ids = list({s.sample_id for s in samples})

        # Build parameterized IN clause
        placeholders = ", ".join(["?"] * len(sample_ids))
        rows = ctx.deps.cursor.execute(
            f"SELECT tag, COUNT(*) AS cnt "
            f"FROM ("
            f"  SELECT UNNEST(s.tags) AS tag "
            f"  FROM samples s "
            f"  WHERE s.dataset_id = ? "
            f"  AND s.id IN ({placeholders})"
            f") "
            f"GROUP BY tag ORDER BY cnt DESC LIMIT 10",
            [ctx.deps.dataset_id, *sample_ids],
        ).fetchall()
        if not rows:
            return "No tag data available. VLM auto-tagging may not have been run yet."
        return _format_table(["tag", "count"], rows)

    @agent.tool
    def get_confidence_distribution(
        ctx: RunContext[AnalysisDeps], error_type: str
    ) -> str:
        """Get confidence score distribution for a given error type. Shows whether errors cluster at high or low confidence.

        Args:
            error_type: One of 'tp', 'hard_fp', 'false_negative', 'label_error'
        """
        samples = ctx.deps.error_samples.get(error_type, [])
        if not samples:
            return f"No samples found for error type '{error_type}'."

        # Bucket confidence values in-memory (data comes from categorize_errors)
        buckets = {
            "0.0-0.3": 0,
            "0.3-0.5": 0,
            "0.5-0.7": 0,
            "0.7-0.9": 0,
            "0.9-1.0": 0,
        }
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
            return f"No confidence data available for error type '{error_type}' (e.g., false negatives have no confidence)."
        return _format_table(["confidence_range", "count"], rows)

    _agent = agent
    return _agent


def _format_table(headers: list[str], rows: list[tuple]) -> str:
    """Format query results as a pipe-separated table string for LLM readability."""
    lines = [" | ".join(headers)]
    lines.append(" | ".join(["---"] * len(headers)))
    for row in rows:
        lines.append(" | ".join(str(v) for v in row))
    return "\n".join(lines)


def run_analysis(
    cursor: DuckDBPyConnection,
    dataset_id: str,
    source: str = "prediction",
    iou_threshold: float = 0.5,
    conf_threshold: float = 0.25,
) -> AnalysisReport:
    """Run the AI agent to analyze error patterns and produce recommendations.

    1. Computes error categorization via categorize_errors()
    2. Builds agent dependencies with error data
    3. Runs the Pydantic AI agent with DuckDB query tools
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

    deps = AnalysisDeps(
        cursor=cursor,
        dataset_id=dataset_id,
        source=source,
        error_summary=error_data.summary.model_dump(),
        error_samples=error_data.samples_by_type,
    )

    prompt = (
        f"Analyze the error distribution for dataset '{dataset_id}' "
        f"(source='{source}', IoU threshold={iou_threshold}, "
        f"confidence threshold={conf_threshold}). "
        f"Use the available tools to investigate error patterns, "
        f"per-class breakdowns, tag correlations, and confidence distributions. "
        f"Provide specific, actionable recommendations."
    )

    try:
        result = agent.run_sync(prompt, deps=deps)
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
                "environment variable (e.g., OPENAI_API_KEY or ANTHROPIC_API_KEY) "
                "for the model specified in DATAVISOR_AGENT_MODEL."
            ) from exc
        raise ValueError(
            f"Agent analysis failed: {exc}"
        ) from exc
