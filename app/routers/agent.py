"""Agent API router.

Endpoints:
- POST /datasets/{dataset_id}/analyze -- run AI agent error pattern analysis
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_db
from app.models.agent import AnalysisReport, AnalysisRequest
from app.repositories.duckdb_repo import DuckDBRepo
from app.services.agent_service import run_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/datasets", tags=["agent"])


@router.post("/{dataset_id}/analyze", response_model=AnalysisReport)
def analyze_errors(
    dataset_id: str,
    body: AnalysisRequest | None = None,
    db: DuckDBRepo = Depends(get_db),
) -> AnalysisReport:
    """Run AI agent analysis on error distributions.

    The agent uses DuckDB query tools to investigate error patterns,
    per-class breakdowns, tag correlations, and confidence distributions,
    then returns structured pattern insights and recommendations.

    Requires an LLM API key to be configured (e.g., OPENAI_API_KEY)
    for the model specified in DATAVISOR_AGENT_MODEL.
    """
    request = body or AnalysisRequest()
    cursor = db.connection.cursor()
    try:
        # Verify dataset exists
        row = cursor.execute(
            "SELECT id FROM datasets WHERE id = ?", [dataset_id]
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Verify prediction source has annotations
        source_count = cursor.execute(
            "SELECT COUNT(*) FROM annotations WHERE dataset_id = ? AND source = ?",
            [dataset_id, request.source],
        ).fetchone()[0]
        if source_count == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No annotations found for source '{request.source}'",
            )

        return run_analysis(
            cursor,
            dataset_id,
            source=request.source,
            iou_threshold=request.iou_threshold,
            conf_threshold=request.conf_threshold,
        )
    except ValueError as exc:
        # Auth / config errors (missing API key)
        raise HTTPException(
            status_code=503,
            detail=(
                f"{exc}. Configure DATAVISOR_AGENT_MODEL and the "
                f"corresponding API key (e.g., GEMINI_API_KEY)."
            ),
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        # Runtime errors (rate limits, model errors, etc.)
        logger.exception("Agent analysis failed for dataset %s", dataset_id)
        raise HTTPException(
            status_code=500,
            detail=f"Agent analysis failed: {exc}",
        ) from exc
    finally:
        cursor.close()
