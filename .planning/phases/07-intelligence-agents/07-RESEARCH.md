# Phase 7: Intelligence & Agents - Research

**Researched:** 2026-02-11
**Domain:** AI agent orchestration (Pydantic AI), vision-language models (Moondream2), error pattern analysis
**Confidence:** MEDIUM (Pydantic AI verified via official docs; Moondream2 verified via HuggingFace + official docs; pattern detection is application-specific design)

## Summary

Phase 7 adds two distinct capabilities: (1) an AI agent that analyzes error distributions from Phase 6 and recommends corrective actions, and (2) a VLM auto-tagging pipeline that enriches samples with descriptive tags. These are largely independent subsystems sharing only the DuckDB data layer.

**Pydantic AI** (v1.58.0) is the established framework for building type-safe LLM agents with tool calling. It integrates naturally with the existing FastAPI + Pydantic stack. The agent receives DuckDB query tools and Qdrant search tools, uses error analysis data to detect patterns, and returns structured recommendations via Pydantic BaseModel output types. The official data analyst example demonstrates exactly this pattern (DuckDB SQL tools with dependency injection).

**Moondream2** is a 2B-parameter VLM that runs locally on CPU/MPS/CUDA. The `moondream` PyPI package declares `Python <4.0` (supports up to 3.13), but moondream2 can be loaded directly via the `transformers` library (already installed at v5.1.0) using `AutoModelForCausalLM.from_pretrained("vikhyatk/moondream2", trust_remote_code=True)`, which works on Python 3.14. The model provides `query()` and `caption()` methods for image tagging, producing tags like "dark", "blurry", "indoor", "crowded" via targeted prompts.

**Pattern detection** is best implemented as a rule-based statistical analysis engine that queries error distributions via DuckDB and correlates them with VLM-generated tags. The LLM agent interprets these statistical findings and generates natural-language recommendations. This avoids making the LLM do the math while leveraging it for reasoning and communication.

**Primary recommendation:** Use `pydantic-ai-slim` for the agent (no extra model provider deps needed since the LLM API key is user-configured), load Moondream2 via `transformers` (bypass the `moondream` package for Python 3.14 compatibility), and implement pattern detection as DuckDB SQL queries exposed as agent tools rather than hand-rolled statistical code.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pydantic-ai-slim | 1.58.0 | Agent framework with tool calling, structured output | Official Pydantic team, type-safe, built for FastAPI codebases |
| transformers | 5.1.0 (already installed) | Load Moondream2 for local VLM inference | Already in project; avoids `moondream` package Python 3.14 issue |
| torch | 2.10.0 (already installed) | Moondream2 inference backend | Already in project for DINOv2 |
| duckdb | 1.4.4 (already installed) | Agent tool queries for error/tag statistics | Already the project's data engine |
| qdrant-client | 1.16.2 (already installed) | Agent tool for similarity-based pattern analysis | Already in project for similarity search |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pydantic-graph | 1.58.0 | Included with pydantic-ai-slim | Only if multi-step agent workflows needed |
| Pillow | 12.1.1 (already installed) | Image loading for Moondream2 inference | During VLM tagging pipeline |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pydantic-ai-slim | LangChain | LangChain is heavier, less type-safe, doesn't match existing Pydantic stack |
| pydantic-ai-slim | Direct OpenAI/Anthropic SDK | Loses tool abstraction, structured output validation, dependency injection |
| Moondream2 via transformers | `moondream` PyPI package | `moondream` package requires Python <4.0, incompatible with Python 3.14 |
| Moondream2 | Moondream3 Preview | Moondream3 requires 24GB+ NVIDIA GPU; Moondream2 runs on MPS/CPU |
| Rule-based pattern detection | Pure LLM analysis | LLMs are unreliable at math; statistical queries should be deterministic |

**Installation:**
```bash
uv add pydantic-ai-slim
# transformers, torch, duckdb, qdrant-client already installed
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── services/
│   ├── agent_service.py       # Pydantic AI agent definition, tools, deps
│   ├── vlm_service.py         # Moondream2 model loading and tagging
│   └── (existing services)
├── models/
│   ├── agent.py               # AgentAnalysis, PatternResult, Recommendation models
│   └── (existing models)
├── routers/
│   ├── agent.py               # /datasets/{id}/analyze, /datasets/{id}/auto-tag endpoints
│   └── (existing routers)
```

### Pattern 1: Agent with DuckDB/Qdrant Tools
**What:** Define a Pydantic AI agent with tools that query DuckDB for error statistics and Qdrant for similarity patterns. The agent receives error analysis context and uses tools to investigate further.
**When to use:** For the error pattern detection agent (AGENT-01, AGENT-02)
**Example:**
```python
# Source: https://ai.pydantic.dev/examples/data-analyst/
from dataclasses import dataclass
from pydantic_ai import Agent, RunContext
from pydantic import BaseModel
from duckdb import DuckDBPyConnection

@dataclass
class AnalysisDeps:
    cursor: DuckDBPyConnection
    dataset_id: str
    source: str
    error_summary: dict  # pre-computed from categorize_errors()

class PatternInsight(BaseModel):
    pattern: str          # e.g., "90% of FN occur in 'person' class"
    evidence: str         # Supporting data
    severity: str         # "high", "medium", "low"

class Recommendation(BaseModel):
    action: str           # e.g., "Collect more nighttime training data"
    rationale: str        # Why this helps
    priority: str         # "high", "medium", "low"
    category: str         # "data_collection", "augmentation", "labeling", "architecture"

class AnalysisResult(BaseModel):
    patterns: list[PatternInsight]
    recommendations: list[Recommendation]
    summary: str

analysis_agent = Agent(
    'openai:gpt-4o',  # or anthropic:claude-sonnet-4-5, configurable
    deps_type=AnalysisDeps,
    output_type=AnalysisResult,
    instructions="""You are an ML error analysis expert. Analyze object detection
    error patterns and recommend specific corrective actions.
    Use the provided tools to query error distributions, class-level metrics,
    and tag correlations. Be specific and actionable.""",
)

@analysis_agent.tool
def query_error_distribution(ctx: RunContext[AnalysisDeps]) -> str:
    """Get error type breakdown (TP, FP, FN, Label Error) per class."""
    rows = ctx.deps.cursor.execute(
        "SELECT category_name, source, COUNT(*) as cnt "
        "FROM annotations WHERE dataset_id = ? AND source = ? "
        "GROUP BY category_name, source",
        [ctx.deps.dataset_id, ctx.deps.source],
    ).fetchall()
    # Format as readable table for the LLM
    return format_as_table(rows)

@analysis_agent.tool
def query_tag_correlation(ctx: RunContext[AnalysisDeps], error_type: str) -> str:
    """Find which tags correlate with a specific error type."""
    # Join error samples with sample tags
    rows = ctx.deps.cursor.execute("""
        SELECT tag, COUNT(*) as cnt
        FROM (SELECT UNNEST(s.tags) AS tag
              FROM samples s
              WHERE s.dataset_id = ?
              AND s.id IN (SELECT sample_id FROM error_samples WHERE error_type = ?))
        GROUP BY tag ORDER BY cnt DESC LIMIT 10
    """, [ctx.deps.dataset_id, error_type]).fetchall()
    return format_as_table(rows)
```

### Pattern 2: VLM Auto-Tagging via Transformers
**What:** Load Moondream2 via `transformers` AutoModelForCausalLM, process images in batches with targeted prompts, store tags in DuckDB samples.tags column.
**When to use:** For AGENT-04 VLM auto-tagging
**Example:**
```python
# Source: https://huggingface.co/vikhyatk/moondream2
# Source: https://docs.moondream.ai/transformers/
from transformers import AutoModelForCausalLM
from PIL import Image
import torch

class VLMService:
    def __init__(self, db, storage):
        self.db = db
        self.storage = storage
        self._model = None

    def load_model(self):
        self._model = AutoModelForCausalLM.from_pretrained(
            "vikhyatk/moondream2",
            revision="2025-06-21",
            trust_remote_code=True,
            device_map={"": "mps"},  # or "cuda" / "cpu"
        )

    def tag_image(self, image: Image.Image) -> list[str]:
        """Generate descriptive tags for a single image."""
        # Use targeted queries for each tag dimension
        tags = []
        prompts = {
            "lighting": "Is this image dark, bright, or normal lighting? Answer with one word.",
            "clarity": "Is this image blurry or sharp? Answer with one word.",
            "setting": "Is this scene indoor or outdoor? Answer with one word.",
            "density": "Is this scene crowded or sparse? Answer with one word.",
            "weather": "What is the weather condition? Answer: sunny, cloudy, rainy, night, or unclear.",
        }
        for dimension, prompt in prompts.items():
            result = self._model.query(image, prompt)
            tag = result["answer"].strip().lower()
            if tag and tag != "unclear":
                tags.append(tag)
        return tags

    def encode_and_reuse(self, image: Image.Image) -> list[str]:
        """Encode image once, run multiple queries (performance optimization)."""
        encoded = self._model.encode_image(image)
        tags = []
        for prompt in PROMPTS:
            result = self._model.query(encoded, prompt)
            tags.append(parse_tag(result["answer"]))
        return tags
```

### Pattern 3: Structured Agent Output with Pydantic Models
**What:** Define response models that constrain agent output to actionable structures. The framework validates output and retries if the LLM deviates.
**When to use:** For AGENT-02 recommendation system
**Example:**
```python
# Source: https://ai.pydantic.dev/output/
from pydantic import BaseModel, Field

class Recommendation(BaseModel):
    action: str = Field(description="Specific action to take")
    rationale: str = Field(description="Why this action helps")
    priority: Literal["high", "medium", "low"]
    category: Literal[
        "data_collection",
        "augmentation",
        "labeling",
        "architecture",
        "hyperparameter",
    ]

class AnalysisResult(BaseModel):
    patterns: list[PatternInsight] = Field(
        description="Detected error patterns with evidence"
    )
    recommendations: list[Recommendation] = Field(
        description="Prioritized corrective actions"
    )
    summary: str = Field(
        description="Executive summary of findings"
    )

# Agent validates output matches this schema; retries on failure
agent = Agent(
    model='anthropic:claude-sonnet-4-5',
    output_type=AnalysisResult,
    retries=2,
)
```

### Pattern 4: Background Task with SSE Progress (Existing Pattern)
**What:** VLM tagging follows the same background task + SSE progress pattern used by embedding generation (Phase 5).
**When to use:** For batch VLM auto-tagging endpoint
**Example:**
```python
# Follows existing pattern from app/services/embedding_service.py
class VLMService:
    _tasks: dict[str, TaggingProgress] = {}

    def generate_tags(self, dataset_id: str) -> None:
        """Background task: tag all samples with VLM descriptions."""
        self._tasks[dataset_id] = TaggingProgress(
            status="running", processed=0, total=0
        )
        # Process in batches, update progress, write tags to DuckDB
        # Use existing tag write pattern: UPDATE samples SET tags = list_distinct(...)
```

### Anti-Patterns to Avoid
- **LLM doing math:** Never ask the LLM to count errors or compute percentages. Use DuckDB queries exposed as tools. LLMs are unreliable at arithmetic.
- **Loading entire datasets into agent context:** Use the deps reference pattern (from data analyst example). Store results in deps, pass references to the LLM.
- **Hardcoded model provider:** Make the LLM model configurable via environment variable (e.g., VISIONLENS_AGENT_MODEL). Users may use OpenAI, Anthropic, or local models.
- **Blocking VLM inference on request thread:** VLM tagging is slow (seconds per image). Always use background tasks with progress tracking.
- **Installing `moondream` PyPI package:** It declares Python <4.0 and won't install on Python 3.14. Use `transformers` directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM tool calling + validation | Custom prompt engineering for JSON | Pydantic AI Agent with output_type | Handles schema generation, validation, retries automatically |
| Agent dependency injection | Global state or closures | Pydantic AI RunContext[Deps] | Type-safe, testable, documented pattern |
| Image feature extraction | Custom CNN classifier for dark/blurry | Moondream2 VLM queries | Zero-shot, no training needed, handles edge cases |
| Tag storage and filtering | New tags table or metadata column | Existing `samples.tags VARCHAR[]` | Already built in Phase 3 with DuckDB list functions |
| Background task progress | Custom WebSocket implementation | Existing SSE pattern (EmbeddingService) | Proven pattern from Phase 5, EventSourceResponse |

**Key insight:** The project already has infrastructure for everything except the agent and VLM model. Tags column exists. Background tasks exist. SSE progress exists. DuckDB queries exist. The new code is primarily agent definition (tools + prompts) and VLM model loading.

## Common Pitfalls

### Pitfall 1: Python 3.14 + `moondream` Package
**What goes wrong:** `pip install moondream` fails with "Requires-Python: >=3.10, <4.0" resolver error on Python 3.14.
**Why it happens:** The moondream PyPI package has a restrictive Python version upper bound.
**How to avoid:** Load Moondream2 via `transformers` library directly: `AutoModelForCausalLM.from_pretrained("vikhyatk/moondream2", trust_remote_code=True)`. This is the officially documented alternative approach.
**Warning signs:** Any reference to `import moondream as md` or `pip install moondream` in code or docs.

### Pitfall 2: LLM API Key Not Configured
**What goes wrong:** Agent fails at runtime because no API key is set.
**Why it happens:** Unlike DINOv2/Moondream2 which run locally, the analysis agent calls an external LLM API.
**How to avoid:** Make model provider configurable via `VISIONLENS_AGENT_MODEL` env var (e.g., "openai:gpt-4o" or "anthropic:claude-sonnet-4-5"). Validate at startup or return clear error. Document required env vars (OPENAI_API_KEY or ANTHROPIC_API_KEY).
**Warning signs:** Hardcoded model strings, missing .env documentation.

### Pitfall 3: Agent Tool Functions Returning Too Much Data
**What goes wrong:** A tool returns 10,000 rows of error samples, exceeding LLM context limits and increasing cost.
**Why it happens:** DuckDB queries can return unbounded results.
**How to avoid:** Cap all tool query results (e.g., LIMIT 50 or return aggregated summaries). Use the deps reference pattern from the data analyst example to store large results outside the LLM context. Return statistics (counts, percentages) not raw rows.
**Warning signs:** Tool functions without LIMIT clauses, returning raw DataFrames.

### Pitfall 4: VLM Tagging Without Reusing Encoded Images
**What goes wrong:** Running 5 prompts per image encodes the image 5 times (5x slower).
**Why it happens:** Each `model.query(image, prompt)` call re-encodes the image.
**How to avoid:** Use `encoded = model.encode_image(image)` once, then `model.query(encoded, prompt)` for each tag dimension.
**Warning signs:** Multiple `model.query(image, ...)` calls in a loop on the same image.

### Pitfall 5: Tags Not Correlatable with Error Analysis
**What goes wrong:** Agent detects patterns but can't correlate errors with image attributes because VLM tags haven't been generated yet.
**Why it happens:** The analysis agent and VLM tagging are treated as completely independent.
**How to avoid:** Plan 07-03 (VLM tagging) should run before the agent can fully exploit tag correlations. The agent should gracefully handle datasets without tags and recommend running auto-tagging first.
**Warning signs:** Agent instructions assume tags always exist.

### Pitfall 6: Moondream2 Loading Conflicts with DINOv2
**What goes wrong:** Loading two large models simultaneously causes OOM, especially on MPS with limited unified memory.
**Why it happens:** Both Moondream2 (~4GB) and DINOv2 (~350MB) loaded in GPU memory.
**How to avoid:** Load Moondream2 on-demand (not at startup). Optionally provide a config flag to unload DINOv2 before VLM tagging. Consider CPU fallback for Moondream2 if MPS memory is tight.
**Warning signs:** Both models loaded in lifespan startup, high memory usage.

## Code Examples

### Complete Agent Service Definition
```python
# Source: https://ai.pydantic.dev/tools/ + https://ai.pydantic.dev/agents/
from dataclasses import dataclass
from pydantic_ai import Agent, RunContext
from pydantic import BaseModel, Field
from typing import Literal
from duckdb import DuckDBPyConnection

@dataclass
class AnalysisDeps:
    """Dependencies injected into the error analysis agent."""
    cursor: DuckDBPyConnection
    dataset_id: str
    source: str  # prediction source name

class PatternInsight(BaseModel):
    pattern: str = Field(description="Natural language description of the pattern")
    evidence: str = Field(description="Data supporting this pattern")
    severity: Literal["high", "medium", "low"]
    affected_classes: list[str] = Field(default_factory=list)

class Recommendation(BaseModel):
    action: str = Field(description="Specific corrective action")
    rationale: str = Field(description="Why this addresses the pattern")
    priority: Literal["high", "medium", "low"]
    category: Literal[
        "data_collection", "augmentation", "labeling",
        "architecture", "hyperparameter"
    ]

class AnalysisReport(BaseModel):
    patterns: list[PatternInsight]
    recommendations: list[Recommendation]
    summary: str

error_agent = Agent(
    'openai:gpt-4o',  # configurable via settings
    deps_type=AnalysisDeps,
    output_type=AnalysisReport,
    instructions=(
        "You are an ML engineer specializing in object detection error analysis. "
        "Use the provided tools to query error distributions, per-class metrics, "
        "and tag correlations. Identify actionable patterns and recommend specific "
        "corrective actions. Be data-driven: cite numbers from your tool queries."
    ),
)

@error_agent.tool
def get_error_summary(ctx: RunContext[AnalysisDeps]) -> str:
    """Get overall error type counts (TP, Hard FP, Label Error, FN)."""
    # Uses existing categorize_errors() data pre-loaded in deps
    return str(ctx.deps.error_summary)

@error_agent.tool
def get_per_class_errors(ctx: RunContext[AnalysisDeps]) -> str:
    """Get error breakdown per class (which classes have most FN, FP, etc.)."""
    rows = ctx.deps.cursor.execute("""
        SELECT category_name,
               SUM(CASE WHEN error_type = 'tp' THEN 1 ELSE 0 END) as tp,
               SUM(CASE WHEN error_type = 'hard_fp' THEN 1 ELSE 0 END) as fp,
               SUM(CASE WHEN error_type = 'false_negative' THEN 1 ELSE 0 END) as fn,
               SUM(CASE WHEN error_type = 'label_error' THEN 1 ELSE 0 END) as le
        FROM error_samples
        WHERE dataset_id = ?
        GROUP BY category_name
        ORDER BY fn DESC
    """, [ctx.deps.dataset_id]).fetchall()
    return format_table(["class", "tp", "fp", "fn", "label_error"], rows)

@error_agent.tool
def get_tag_error_correlation(ctx: RunContext[AnalysisDeps], error_type: str) -> str:
    """Find which VLM tags correlate with a specific error type (e.g., 'false_negative').

    Args:
        error_type: One of 'tp', 'hard_fp', 'false_negative', 'label_error'
    """
    # This requires VLM tags to have been generated first
    rows = ctx.deps.cursor.execute("""
        SELECT tag, COUNT(*) as cnt
        FROM (
            SELECT UNNEST(s.tags) AS tag
            FROM samples s
            INNER JOIN error_samples es ON s.id = es.sample_id
            WHERE s.dataset_id = ? AND es.error_type = ?
        )
        GROUP BY tag ORDER BY cnt DESC LIMIT 10
    """, [ctx.deps.dataset_id, error_type]).fetchall()
    if not rows:
        return "No tag data available. VLM auto-tagging may not have been run yet."
    return format_table(["tag", "count"], rows)

@error_agent.tool
def get_confidence_distribution(ctx: RunContext[AnalysisDeps], error_type: str) -> str:
    """Get confidence score distribution for a given error type.

    Args:
        error_type: One of 'tp', 'hard_fp', 'false_negative', 'label_error'
    """
    rows = ctx.deps.cursor.execute("""
        SELECT
            CASE
                WHEN confidence >= 0.9 THEN '0.9-1.0'
                WHEN confidence >= 0.7 THEN '0.7-0.9'
                WHEN confidence >= 0.5 THEN '0.5-0.7'
                WHEN confidence >= 0.3 THEN '0.3-0.5'
                ELSE '0.0-0.3'
            END as conf_range,
            COUNT(*) as cnt
        FROM error_samples
        WHERE dataset_id = ? AND error_type = ?
        GROUP BY conf_range
        ORDER BY conf_range
    """, [ctx.deps.dataset_id, error_type]).fetchall()
    return format_table(["confidence_range", "count"], rows)
```

### Complete VLM Tagging Service
```python
# Source: https://docs.moondream.ai/transformers/
# Source: https://huggingface.co/vikhyatk/moondream2
from transformers import AutoModelForCausalLM
from PIL import Image
import torch
from io import BytesIO

TAG_PROMPTS = {
    "lighting": "Describe the lighting: is this image dark, dim, bright, or normal? One word only.",
    "clarity": "Is this image blurry, sharp, or noisy? One word only.",
    "setting": "Is this scene indoor or outdoor? One word only.",
    "weather": "What weather or time: sunny, cloudy, rainy, foggy, snowy, night, or day? One word.",
    "density": "How crowded is this scene: empty, sparse, moderate, or crowded? One word only.",
}

VALID_TAGS = {
    "lighting": {"dark", "dim", "bright", "normal"},
    "clarity": {"blurry", "sharp", "noisy"},
    "setting": {"indoor", "outdoor"},
    "weather": {"sunny", "cloudy", "rainy", "foggy", "snowy", "night", "day"},
    "density": {"empty", "sparse", "moderate", "crowded"},
}

class VLMService:
    def __init__(self, db, storage):
        self.db = db
        self.storage = storage
        self._model = None
        self._tasks = {}

    def load_model(self):
        device = "mps" if torch.backends.mps.is_available() else (
            "cuda" if torch.cuda.is_available() else "cpu"
        )
        self._model = AutoModelForCausalLM.from_pretrained(
            "vikhyatk/moondream2",
            revision="2025-06-21",
            trust_remote_code=True,
            device_map={"": device},
        )

    def tag_image(self, image: Image.Image) -> list[str]:
        encoded = self._model.encode_image(image)
        tags = []
        for dimension, prompt in TAG_PROMPTS.items():
            result = self._model.query(encoded, prompt)
            raw = result["answer"].strip().lower().rstrip(".")
            if raw in VALID_TAGS.get(dimension, set()):
                tags.append(raw)
        return tags
```

### Agent Router Endpoint
```python
# Source: Pattern from existing routers + Pydantic AI run_sync
from fastapi import APIRouter, Request, HTTPException

router = APIRouter(prefix="/datasets", tags=["agent"])

@router.post("/{dataset_id}/analyze")
async def analyze_errors(
    dataset_id: str,
    request: Request,
    source: str = "prediction",
    iou_threshold: float = 0.5,
    conf_threshold: float = 0.25,
):
    """Run AI agent analysis on error distributions."""
    db = request.app.state.db
    cursor = db.connection.cursor()
    try:
        # Pre-compute error analysis (reuse existing service)
        error_data = categorize_errors(cursor, dataset_id, source, iou_threshold, conf_threshold)

        deps = AnalysisDeps(
            cursor=cursor,
            dataset_id=dataset_id,
            source=source,
            error_summary=error_data.summary.model_dump(),
        )
        result = error_agent.run_sync(
            "Analyze the error distribution for this dataset and recommend corrective actions.",
            deps=deps,
        )
        return result.output
    finally:
        cursor.close()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LangChain for Python agents | Pydantic AI (type-safe, FastAPI-aligned) | 2024-2025 | Simpler, better DX for Pydantic/FastAPI projects |
| Custom VLM fine-tuning for tags | Zero-shot VLM queries (Moondream2) | 2024-2025 | No training needed, flexible prompts |
| Separate `moondream` package | Direct `transformers` loading | 2025-2026 | Better Python version compatibility |
| Rule-based error analysis only | LLM-augmented analysis with tools | 2025-2026 | Natural language insights + structured output |

**Deprecated/outdated:**
- `moondream` PyPI package: Incompatible with Python 3.14 (use `transformers` loading instead)
- LangChain: Over-engineered for this use case; Pydantic AI is more aligned with existing stack
- Moondream1: Superseded by Moondream2 with better accuracy and more features

## Open Questions

1. **LLM API Key Management**
   - What we know: The agent needs an LLM API key (OpenAI or Anthropic). All other models in the project run locally.
   - What's unclear: Should this be a required env var at startup, or should the agent feature gracefully degrade when no key is configured?
   - Recommendation: Make it optional. If no `VISIONLENS_AGENT_MODEL` or API key is set, the `/analyze` endpoint returns a clear "configure API key" error. VLM tagging works independently (local model).

2. **Error Samples Storage for Agent Queries**
   - What we know: `categorize_errors()` returns error data in memory (not persisted). Agent tools need to query this data via SQL.
   - What's unclear: Should error categorization results be persisted to a DuckDB table, or computed on-the-fly before each agent run?
   - Recommendation: Create a lightweight `error_samples` table (or temp table) populated before agent run. This allows the agent's DuckDB tools to join error data with tags, confidence, etc. Alternatively, pass pre-computed error data directly through deps (simpler but limits SQL flexibility).

3. **VLM Model Memory Management**
   - What we know: Moondream2 is ~4GB in memory. DINOv2 is already loaded at startup (~350MB).
   - What's unclear: Can both models coexist on a 16GB MPS machine?
   - Recommendation: Load VLM on-demand (not at startup). If memory is tight, add a `VISIONLENS_VLM_DEVICE` config option defaulting to "cpu" to avoid MPS memory pressure.

4. **Tag Prompt Engineering and Validation**
   - What we know: Moondream2 responds well to "one word" prompts. Tags need to be from a controlled vocabulary.
   - What's unclear: How reliably does Moondream2 produce single-word answers from the valid set? What's the accuracy rate?
   - Recommendation: Validate responses against the allowed tag set. If the response doesn't match, discard it. Track validation rates for calibration. This is the "calibration framework" mentioned in the roadmap.

5. **Agent Tool Design: Pre-computed vs Live Queries**
   - What we know: The data analyst example passes DataFrames via deps references. Our error_analysis.py computes results in memory.
   - What's unclear: Should agent tools call `categorize_errors()` live, or should results be materialized into DuckDB first?
   - Recommendation: Materialize a temporary `error_samples` view/table before the agent run. This enables richer SQL joins (error_type + tags + confidence) that would be difficult with in-memory data structures.

## Sources

### Primary (HIGH confidence)
- [Pydantic AI official docs](https://ai.pydantic.dev/) - Agent, tools, dependencies, output types, installation
- [Pydantic AI data analyst example](https://ai.pydantic.dev/examples/data-analyst/) - DuckDB tool pattern
- [Moondream2 HuggingFace model card](https://huggingface.co/vikhyatk/moondream2) - Model loading, inference API, revision pinning
- [Moondream docs: transformers](https://docs.moondream.ai/transformers/) - Installation, device config, encode_image optimization
- [Moondream docs: quickstart](https://docs.moondream.ai/quickstart/) - API methods (query, caption, detect, point)
- [PyPI: pydantic-ai v1.58.0](https://pypi.org/project/pydantic-ai/) - Version, Python >=3.10 requirement
- [PyPI: moondream v0.2.0](https://pypi.org/project/moondream/) - Version, Python >=3.10 <4.0 constraint

### Secondary (MEDIUM confidence)
- [Encord: Error analysis for object detection](https://encord.com/blog/error-analysis-object-detection-models/) - Error categorization methodology
- [TIDE: General toolbox for identifying detection errors](https://dbolya.github.io/tide/) - Error taxonomy patterns
- [Microsoft: Error analysis for object detection](https://medium.com/data-science-at-microsoft/error-analysis-for-object-detection-models-338cb6534051) - Iterative improvement workflow

### Tertiary (LOW confidence)
- WebSearch results for pattern detection architectures - General guidance, not project-specific

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Pydantic AI and transformers verified via official docs and PyPI; versions confirmed installable on Python 3.14
- Architecture: MEDIUM - Agent tool pattern verified from official example; VLM tagging pattern assembled from docs but not end-to-end tested
- Pitfalls: MEDIUM - Python 3.14 issue verified via PyPI metadata; memory concerns based on model sizes but not tested on target hardware
- Pattern detection approach: MEDIUM - Application-specific design informed by ML engineering best practices but no single authoritative source

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (30 days - pydantic-ai and moondream iterate fast)
