# Phase 6: Error Analysis & Similarity - Research

**Researched:** 2026-02-11
**Domain:** Object detection error categorization, vector similarity search
**Confidence:** HIGH (error categorization is well-understood; Qdrant is verified)

## Summary

Phase 6 adds two capabilities: (1) per-detection error categorization classifying each prediction as a True Positive, Hard False Positive, Label Error, or False Negative; and (2) Qdrant-powered similarity search allowing users to select any image and find visually similar images ranked by embedding distance.

The error categorization is a custom computation building on the existing evaluation service's IoU matching logic. The three error categories map well to established TIDE-style definitions: Hard False Positives are high-confidence predictions with no matching ground truth (background detections), Label Errors are predictions that localize an object correctly but disagree on class (suggesting either the model or the annotation is wrong), and False Negatives are ground truth objects with no matching prediction.

For similarity search, Qdrant's Python client supports a local mode (disk-persisted, no Docker server required) that can be initialized alongside DuckDB at startup. The existing 768-dim DINOv2 embeddings stored in DuckDB can be synced to a Qdrant collection, and similarity queries return ranked results with cosine distance scores.

**Primary recommendation:** Build error categorization as a custom numpy service extending the existing evaluation code pattern. Add Qdrant via `qdrant-client` in local/disk mode (no Docker dependency) as a sidecar to DuckDB for similarity search only.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| qdrant-client | >=1.16.2 | Vector similarity search (local mode) | Official Python client; supports local disk persistence without Docker; Python 3.14 compatible; cosine distance built-in |
| numpy | (already installed via supervision) | IoU computation, error categorization | Already used in evaluation.py for vectorized box matching |
| supervision | >=0.27.0 (already installed) | Detections data structure | Already used in evaluation.py; provides Detections class |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| recharts | ^3.7.0 (already installed) | Error distribution charts (bar/pie) | Frontend error breakdown visualization |
| @tanstack/react-query | ^5.90.20 (already installed) | Data fetching for error and similarity APIs | All new API endpoints |
| zustand | ^5.0.11 (already installed) | UI state for similarity panel, error filters | Cross-component state sharing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Qdrant local mode | DuckDB array_cosine_similarity() | DuckDB has no ANN index; linear scan O(N) per query works for <100K but won't scale. Qdrant provides HNSW index out of box. Qdrant also decouples vector search from relational queries. |
| Qdrant local mode | Qdrant Docker container | Docker adds operational complexity. Local mode provides same API without server process. Good enough for single-user desktop tool. |
| Custom error categorization | tidecv library | tidecv has 6 TIDE categories but requires pycocotools, uncertain Python 3.14 compat, and the 3 categories in the spec (Hard FP, Label Error, FN) don't directly map to TIDE's 6. Custom code is simpler and aligns with existing evaluation.py patterns. |
| Custom error categorization | FiftyOne mistakenness | FiftyOne is a heavyweight dependency (~500MB+) with its own MongoDB, overkill for this feature. The project already has the matching logic. |

**Installation:**
```bash
# Backend
uv add qdrant-client

# Frontend: no new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── services/
│   ├── evaluation.py          # EXISTING - PR curves, mAP, confusion matrix
│   ├── error_analysis.py      # NEW - Per-detection error categorization
│   └── similarity_service.py  # NEW - Qdrant lifecycle + similarity queries
├── routers/
│   ├── statistics.py          # EXISTING - Add error analysis endpoint
│   └── similarity.py          # NEW - Similarity search endpoint
├── models/
│   ├── evaluation.py          # EXISTING - Extend with error models
│   └── similarity.py          # NEW - Similarity request/response models
└── main.py                    # MODIFY - Add Qdrant service to lifespan

frontend/src/
├── components/
│   ├── stats/
│   │   ├── error-analysis-panel.tsx   # NEW - Error breakdown visualization
│   │   └── error-samples-grid.tsx     # NEW - Grid of error samples
│   └── similarity/
│       └── similarity-panel.tsx       # NEW - Similar images panel
├── hooks/
│   ├── use-error-analysis.ts          # NEW - Error analysis API hook
│   └── use-similarity.ts             # NEW - Similarity search API hook
├── types/
│   ├── error-analysis.ts             # NEW - Error analysis types
│   └── similarity.ts                 # NEW - Similarity types
└── stores/
    └── ui-store.ts                    # MODIFY - Add error/similarity tab
```

### Pattern 1: Error Categorization Algorithm
**What:** Classify each prediction and ground truth detection into error categories using IoU matching.
**When to use:** When the user requests error analysis for a dataset's predictions.

The algorithm processes predictions per-sample, matching each prediction against ground truth using IoU:

```python
# Pseudocode for per-detection error categorization
def categorize_errors(gt_detections, pred_detections, iou_threshold, conf_threshold):
    """
    For each sample:
    1. Filter predictions by confidence >= conf_threshold
    2. Sort predictions by confidence descending
    3. For each prediction, compute IoU with all GT boxes
    4. Categorize based on best IoU match:

    CATEGORIES:
    - True Positive (TP):
      IoU >= iou_threshold AND class matches AND GT not already matched

    - Label Error (classification mismatch):
      IoU >= iou_threshold AND class does NOT match
      (Object correctly localized but class disagrees - could be model error or annotation error)

    - Hard False Positive (background detection):
      IoU < iou_threshold for ALL GT boxes (or no GT exists)
      (Model hallucinated a detection where nothing exists)

    - False Negative (missed detection):
      GT box has no matching prediction after all predictions processed
      (Object exists but model failed to detect it)
    """
```

**Key insight:** This is an extension of the matching logic already in `_compute_pr_curves()` in evaluation.py. The same IoU matrix computation and greedy matching can be reused, but instead of just tracking `is_tp`, we record the specific error category per detection.

### Pattern 2: Qdrant Local Mode Lifecycle
**What:** Initialize Qdrant with disk persistence at app startup, sync embeddings from DuckDB on demand.
**When to use:** For all similarity search operations.

```python
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, PointStruct

class SimilarityService:
    def __init__(self, qdrant_path: str, db: DuckDBRepo):
        self.client = QdrantClient(path=qdrant_path)
        self.db = db

    def ensure_collection(self, dataset_id: str):
        """Create collection if not exists, sync from DuckDB."""
        collection_name = f"embeddings_{dataset_id}"
        if not self.client.collection_exists(collection_name):
            self.client.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=768,  # DINOv2-base dimension
                    distance=Distance.COSINE,
                ),
            )
            self._sync_from_duckdb(dataset_id, collection_name)

    def _sync_from_duckdb(self, dataset_id: str, collection_name: str):
        """Load embeddings from DuckDB and upsert to Qdrant."""
        cursor = self.db.connection.cursor()
        try:
            rows = cursor.execute(
                "SELECT sample_id, vector FROM embeddings "
                "WHERE dataset_id = ? AND vector IS NOT NULL",
                [dataset_id],
            ).fetchall()

            # Batch upsert (Qdrant handles batching internally)
            points = [
                PointStruct(
                    id=idx,
                    vector=row[1],  # FLOAT[768] from DuckDB
                    payload={"sample_id": row[0], "dataset_id": dataset_id},
                )
                for idx, row in enumerate(rows)
            ]

            BATCH_SIZE = 500
            for i in range(0, len(points), BATCH_SIZE):
                self.client.upsert(
                    collection_name=collection_name,
                    points=points[i:i + BATCH_SIZE],
                )
        finally:
            cursor.close()

    def find_similar(self, dataset_id: str, sample_id: str, limit: int = 20):
        """Find similar images by embedding distance."""
        collection_name = f"embeddings_{dataset_id}"
        self.ensure_collection(dataset_id)

        # Get the query vector from DuckDB
        cursor = self.db.connection.cursor()
        try:
            row = cursor.execute(
                "SELECT vector FROM embeddings "
                "WHERE dataset_id = ? AND sample_id = ?",
                [dataset_id, sample_id],
            ).fetchone()
        finally:
            cursor.close()

        if not row:
            return []

        results = self.client.query_points(
            collection_name=collection_name,
            query=row[0],  # vector as list[float]
            limit=limit + 1,  # +1 to exclude self
            with_payload=True,
        ).points

        # Filter out the query sample itself
        return [
            {"sample_id": r.payload["sample_id"], "score": r.score}
            for r in results
            if r.payload["sample_id"] != sample_id
        ][:limit]
```

### Pattern 3: Error Analysis as Sub-Tab of Evaluation
**What:** Add "Error Analysis" as a sub-tab alongside the existing "Evaluation" tab in the Statistics dashboard.
**When to use:** When predictions exist and the user navigates to error analysis.

The existing `StatsDashboard` uses sub-tabs ("Overview" / "Evaluation"). Error analysis should be a third sub-tab ("Error Analysis") that shows:
1. Summary cards: counts of TP, Hard FP, Label Error, FN
2. Bar chart: error distribution per class
3. Filterable grid of error samples (click to view in detail modal)

### Pattern 4: Similarity as Action on Sample Detail
**What:** Add a "Find Similar" button to the SampleModal that opens a side panel of similar images.
**When to use:** When user is viewing a sample and wants to find similar images.

The `SampleModal` component already shows full sample detail. Adding a "Find Similar" button triggers the similarity API call and shows results as a thumbnail grid within the modal or as a drawer panel.

### Anti-Patterns to Avoid
- **Running Qdrant as a separate Docker service:** For this desktop tool, local mode eliminates operational complexity. Don't add Docker as a dependency.
- **Recomputing error categorization on every request:** The computation is O(N * M) per sample where N=predictions, M=GT. Cache results in DuckDB or return from endpoint directly with reasonable response times for typical dataset sizes.
- **Storing error categories in a new table:** These are derived from annotations at given thresholds. Store ephemerally or cache them, not in a persistent table, since they change with IoU/confidence thresholds.
- **Using Qdrant for everything:** DuckDB remains the source of truth for embeddings. Qdrant is a derived index for fast ANN search only. If embeddings are re-generated, the Qdrant collection must be dropped and re-synced.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom brute-force cosine similarity in numpy | Qdrant local mode with HNSW index | HNSW provides sub-linear query time; brute force is O(N) per query. For 50K+ embeddings, the difference is significant. |
| IoU computation | New IoU matrix function | Reuse existing `_compute_iou_matrix()` from evaluation.py | Already tested, vectorized numpy implementation. Extract to shared utility. |
| Distance metrics | Custom cosine distance | Qdrant's built-in Distance.COSINE | Qdrant normalizes and indexes automatically. |
| Error categorization | TIDE/tidecv library | Custom numpy code following TIDE-inspired definitions | tidecv has uncertain Python 3.14 compat, requires pycocotools, and maps to 6 categories instead of the 3 specified. Custom code is < 100 lines. |

**Key insight:** The error categorization is conceptually simple (IoU matching + thresholding), and the codebase already has the matching infrastructure. Don't introduce heavy dependencies for something that's an extension of existing code.

## Common Pitfalls

### Pitfall 1: Qdrant Collection Stale After Re-embedding
**What goes wrong:** User re-generates embeddings (Phase 5 "Re-generate" button), but the Qdrant collection still has the old vectors. Similarity search returns wrong results.
**Why it happens:** Qdrant collection is a derived index, not the source of truth. Re-embedding updates DuckDB but not Qdrant.
**How to avoid:** When embeddings are re-generated, drop and re-create the Qdrant collection. Add a "staleness check" by comparing embedding count in DuckDB vs Qdrant collection size. Or: delete the collection after re-embedding and re-sync lazily on next similarity query.
**Warning signs:** Similarity results that don't make visual sense; Qdrant collection size differs from DuckDB embedding count.

### Pitfall 2: Greedy Matching Order Matters for Error Categorization
**What goes wrong:** Different sorting orders for prediction matching produce different error counts. A low-confidence prediction might "steal" a GT match from a higher-confidence prediction.
**Why it happens:** The matching is greedy (each GT can only be matched once). Predictions must be processed in descending confidence order.
**How to avoid:** Always sort predictions by confidence descending before matching. This is already the pattern in `_compute_pr_curves()`. Follow the same approach.
**Warning signs:** Error counts that change unexpectedly; high-confidence predictions categorized as FP when matching GT exists.

### Pitfall 3: Threshold Sensitivity in Error Categories
**What goes wrong:** A tiny change in IoU threshold (0.49 vs 0.51) flips a detection from "Label Error" (IoU >= threshold) to "Hard FP" (IoU < threshold), making results feel unstable.
**Why it happens:** IoU threshold is a sharp boundary. Detections near the boundary are inherently ambiguous.
**How to avoid:** Use the same threshold controls (IoU slider, confidence slider) already in the EvaluationPanel. The user can adjust and see the effect. Document that these are threshold-dependent categories. Consider showing the IoU value alongside each detection in the UI so users understand why a detection was categorized that way.
**Warning signs:** Users confused about why a visually-matching detection is labeled as "Hard FP".

### Pitfall 4: Memory Usage with Large Qdrant Collections in Local Mode
**What goes wrong:** Loading 100K+ 768-dim vectors into Qdrant local mode consumes significant memory (~300MB for 100K vectors at 768 dims * 4 bytes/float).
**Why it happens:** Qdrant local mode loads the HNSW index into memory.
**How to avoid:** Qdrant local mode with disk persistence (`path=` parameter) manages memory reasonably. For the expected dataset sizes (1K-50K images), this is fine. If needed, Qdrant supports on-disk storage with memory-mapped files.
**Warning signs:** High memory usage on app startup; slow similarity queries.

### Pitfall 5: Error Analysis Response Payload Size
**What goes wrong:** Returning per-detection error info for every detection in a dataset creates very large API responses (tens of thousands of detections).
**Why it happens:** Naive approach returns everything at once.
**How to avoid:** Return aggregated summary (counts per category per class) in the main endpoint. Add a separate paginated endpoint for browsing individual error detections (filtered by error type, class, etc.). Follow the existing pattern of summary + detail endpoints.
**Warning signs:** Slow API responses; frontend freezing when rendering large error lists.

### Pitfall 6: Qdrant Point IDs Must Be Integers or UUIDs
**What goes wrong:** Trying to use DuckDB sample_id strings as Qdrant point IDs fails because Qdrant requires integer or UUID IDs.
**Why it happens:** Qdrant's ID system is typed. The existing sample IDs in DuckDB are VARCHAR strings (like "img_0001").
**How to avoid:** Use sequential integer IDs for Qdrant points and store `sample_id` in the payload. Build a lookup from sample_id to Qdrant point ID during sync, or use UUID conversion. The payload approach is simpler.
**Warning signs:** Upsert errors; type mismatch exceptions.

## Code Examples

### Error Categorization Service (Backend)

```python
# app/services/error_analysis.py
"""Per-detection error categorization for object detection evaluation.

Extends the IoU matching logic from evaluation.py to classify each
detection into: True Positive, Hard False Positive, Label Error,
or False Negative.
"""

import numpy as np
import supervision as sv
from dataclasses import dataclass

@dataclass
class DetectionError:
    """A single detection with its error category."""
    sample_id: str
    category_name: str  # predicted or GT class
    bbox: tuple[float, float, float, float]  # x, y, w, h
    confidence: float | None
    error_type: str  # "tp", "hard_fp", "label_error", "false_negative"
    iou: float | None  # IoU with best matching box (None for FN)
    matched_class: str | None  # GT class for label errors

@dataclass
class ErrorSummary:
    """Aggregated error counts."""
    true_positives: int
    hard_false_positives: int
    label_errors: int
    false_negatives: int
    per_class: dict[str, dict[str, int]]  # class -> {tp, hard_fp, label_error, fn}

def categorize_errors(
    gt_by_sample: dict[str, list],
    pred_by_sample: dict[str, list],
    class_name_to_id: dict[str, int],
    iou_threshold: float,
    conf_threshold: float,
) -> tuple[ErrorSummary, list[DetectionError]]:
    """Categorize all detections into error types."""
    errors: list[DetectionError] = []
    summary_counts = {"tp": 0, "hard_fp": 0, "label_error": 0, "fn": 0}
    per_class: dict[str, dict[str, int]] = {}

    sample_ids = sorted(set(gt_by_sample) | set(pred_by_sample))

    for sid in sample_ids:
        gt_rows = gt_by_sample.get(sid, [])
        pred_rows = pred_by_sample.get(sid, [])

        # Filter predictions by confidence
        pred_rows = [r for r in pred_rows if (r[4] or 1.0) >= conf_threshold]

        # Sort by confidence descending
        pred_rows.sort(key=lambda r: -(r[4] or 1.0))

        # Build GT boxes array
        gt_boxes = np.array([[r[1], r[2], r[1]+r[3], r[2]+r[4]] for r in gt_rows]) if gt_rows else np.empty((0, 4))
        gt_classes = [r[0] for r in gt_rows]
        matched_gt = set()

        for pred in pred_rows:
            pred_class, px, py, pw, ph, conf = pred[0], pred[1], pred[2], pred[3], pred[4], pred[4]
            pred_box = np.array([[px, py, px+pw, py+ph]])

            if len(gt_boxes) > 0:
                ious = _compute_iou_matrix(pred_box, gt_boxes)[0]
                best_idx = int(np.argmax(ious))
                best_iou = float(ious[best_idx])
            else:
                best_iou = 0.0
                best_idx = -1

            if best_iou >= iou_threshold and best_idx not in matched_gt:
                if gt_classes[best_idx] == pred_class:
                    # TRUE POSITIVE
                    error_type = "tp"
                    matched_gt.add(best_idx)
                else:
                    # LABEL ERROR (localized correctly, class mismatch)
                    error_type = "label_error"
                    matched_gt.add(best_idx)
            else:
                # HARD FALSE POSITIVE (no matching GT)
                error_type = "hard_fp"

            errors.append(DetectionError(
                sample_id=sid, category_name=pred_class,
                bbox=(px, py, pw, ph), confidence=conf,
                error_type=error_type, iou=best_iou if best_idx >= 0 else None,
                matched_class=gt_classes[best_idx] if best_idx >= 0 and best_iou >= iou_threshold else None,
            ))
            summary_counts[error_type] += 1

        # FALSE NEGATIVES: unmatched GT
        for gi, gt in enumerate(gt_rows):
            if gi not in matched_gt:
                errors.append(DetectionError(
                    sample_id=sid, category_name=gt[0],
                    bbox=(gt[1], gt[2], gt[3], gt[4]), confidence=None,
                    error_type="false_negative", iou=None, matched_class=None,
                ))
                summary_counts["fn"] += 1

    return ErrorSummary(
        true_positives=summary_counts["tp"],
        hard_false_positives=summary_counts["hard_fp"],
        label_errors=summary_counts["label_error"],
        false_negatives=summary_counts["fn"],
        per_class=per_class,
    ), errors
```

### Similarity Search Endpoint (Backend)

```python
# app/routers/similarity.py
from fastapi import APIRouter, Depends, HTTPException, Query
from app.dependencies import get_db, get_similarity_service

router = APIRouter(prefix="/datasets/{dataset_id}/similarity", tags=["similarity"])

@router.get("/search")
def search_similar(
    dataset_id: str,
    sample_id: str = Query(..., description="Source sample to find similar images for"),
    limit: int = Query(20, ge=1, le=100),
    similarity_service = Depends(get_similarity_service),
    db = Depends(get_db),
):
    """Find visually similar images ranked by embedding distance."""
    results = similarity_service.find_similar(dataset_id, sample_id, limit)

    if not results:
        raise HTTPException(
            status_code=404,
            detail="No embeddings found for this sample. Generate embeddings first.",
        )

    # Enrich with sample metadata (file_name, thumbnail_path)
    cursor = db.connection.cursor()
    try:
        sample_ids = [r["sample_id"] for r in results]
        placeholders = ",".join(["?"] * len(sample_ids))
        rows = cursor.execute(
            f"SELECT id, file_name, thumbnail_path FROM samples "
            f"WHERE dataset_id = ? AND id IN ({placeholders})",
            [dataset_id] + sample_ids,
        ).fetchall()
        meta = {r[0]: {"file_name": r[1], "thumbnail_path": r[2]} for r in rows}
    finally:
        cursor.close()

    return [
        {
            "sample_id": r["sample_id"],
            "score": r["score"],
            "file_name": meta.get(r["sample_id"], {}).get("file_name"),
            "thumbnail_path": meta.get(r["sample_id"], {}).get("thumbnail_path"),
        }
        for r in results
    ]
```

### Error Analysis Sub-Tab (Frontend)

```typescript
// frontend/src/components/stats/error-analysis-panel.tsx
// Pattern: follows existing EvaluationPanel structure with controls + visualization

interface ErrorAnalysisPanelProps {
  datasetId: string;
}

// Uses same debounced IoU/confidence controls as EvaluationPanel
// Shows: summary cards (TP/FP/LE/FN counts), error distribution bar chart,
// per-class error breakdown table, and clickable sample grid for each error type

// Hook pattern:
// const { data } = useErrorAnalysis(datasetId, source, iouThreshold, confThreshold);
// Returns: { summary: ErrorSummary, per_class: PerClassErrors[], samples_by_type: {...} }
```

### Find Similar Button (Frontend)

```typescript
// Added to SampleModal component
// Pattern: button triggers query, results shown inline

function SimilarityResults({ datasetId, sampleId }: { datasetId: string; sampleId: string }) {
  const { data, isLoading } = useSimilarity(datasetId, sampleId, 20);

  if (isLoading) return <Spinner />;
  if (!data?.length) return <p>No similar images found</p>;

  return (
    <div className="grid grid-cols-4 gap-2">
      {data.map((item) => (
        <div key={item.sample_id} className="relative">
          <img src={thumbnailUrl(datasetId, item.sample_id, "small")} />
          <span className="absolute bottom-0 right-0 text-xs bg-black/60 text-white px-1">
            {(item.score * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual inspection of FP/FN images | Automated error categorization with IoU-based taxonomy (TIDE, FiftyOne) | 2020+ (TIDE ECCV 2020) | Users can systematically analyze failure modes instead of random browsing |
| Brute-force cosine similarity in numpy | HNSW-indexed ANN search (Qdrant, FAISS, etc.) | 2019+ | Sub-linear query time for similarity search; makes interactive search feasible |
| Qdrant requires Docker server | qdrant-client local mode (disk persistence) | 2023 (qdrant-client 1.6+) | No server process needed; same API as remote mode |
| UMAP for embedding visualization | t-SNE (project constraint: Python 3.14 numba incompatibility) | Phase 5 decision | t-SNE is already used; Qdrant's cosine distance is independent of the 2D reduction |

**Deprecated/outdated:**
- `tidecv` library: Last release v1.0.1, uncertain Python 3.14 support, depends on pycocotools. Use custom implementation instead.
- Qdrant `search()` method: Still works but `query_points()` is the newer, more flexible API (supports dense, sparse, and multi-vector queries).

## Open Questions

1. **Should error analysis results be cached/stored?**
   - What we know: Error categories depend on IoU + confidence thresholds. Different thresholds produce different results.
   - What's unclear: Whether to cache results per (dataset, source, iou, conf) tuple in a temporary DuckDB table or recompute on each request.
   - Recommendation: Start with recomputing on each request (same as current evaluation endpoint). If response time is too slow for large datasets (>10K samples), add caching with a hash key of parameters.

2. **When to sync DuckDB embeddings to Qdrant?**
   - What we know: Embeddings are generated as a background task. Qdrant needs the same vectors.
   - What's unclear: Should sync happen automatically after embedding generation completes, or lazily on first similarity query?
   - Recommendation: Lazy sync on first query (ensure_collection pattern). Drop collection when embeddings are re-generated. This avoids wasted work if user never uses similarity search.

3. **How to handle "Label Error" vs "Model Error" distinction?**
   - What we know: When IoU is high but classes disagree, it could be either a model classification error OR a ground truth annotation error.
   - What's unclear: Can we distinguish between these without a third reference?
   - Recommendation: Label them uniformly as "Label Error" in the UI with a tooltip explaining the ambiguity. The user's domain knowledge determines which it is. Showing the predicted class AND the GT class lets the user judge.

4. **Error analysis endpoint: summary-only or per-detection?**
   - What we know: Large datasets have thousands of detections. Returning all per-detection data is expensive.
   - What's unclear: What granularity the UI needs.
   - Recommendation: Two endpoints: (1) summary endpoint returning aggregate counts per class per error type (fast, always used); (2) samples endpoint returning sample_ids grouped by error type with pagination (used when user clicks an error category to drill down). This follows the existing pattern of summary + detail.

## Sources

### Primary (HIGH confidence)
- [Qdrant Python Client Quickstart](https://python-client.qdrant.tech/quickstart) - Local mode, collection creation, upsert, query_points API
- [Qdrant Official Quickstart](https://qdrant.tech/documentation/quickstart/) - Docker setup, distance metrics, filtered search
- [qdrant-client PyPI](https://pypi.org/project/qdrant-client/) - v1.16.2, Python >=3.10 (includes 3.14), features
- [Supervision Detection Metrics](https://supervision.roboflow.com/metrics/detection/) - ConfusionMatrix, MeanAveragePrecision, TP/FP/FN matching
- Existing codebase: `app/services/evaluation.py` - IoU matching, PR curves, `_compute_iou_matrix()`
- Existing codebase: `app/services/embedding_service.py` - DINOv2 768-dim embedding generation
- Existing codebase: `app/repositories/duckdb_repo.py` - embeddings table schema (FLOAT[768])

### Secondary (MEDIUM confidence)
- [TIDE Error Categories](https://documentation.picsellia.com/docs/tide-errors) - Six error types with IoU thresholds (t_b=0.1, t_f=0.5)
- [FiftyOne Detection Mistakes](https://docs.voxel51.com/tutorials/detection_mistakes.html) - Mistakenness, possible_spurious, possible_missing patterns
- [TIDE GitHub](https://github.com/dbolya/tide) - tidecv library, 6 error categories, Python 3.6+ (v1.0.1)
- [Qdrant Client API Reference](https://python-client.qdrant.tech/qdrant_client.qdrant_client) - Full method signatures

### Tertiary (LOW confidence)
- WebSearch results for "hard false positive" terminology - general consensus on definitions but not from a single authoritative source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - qdrant-client verified on PyPI with Python 3.14 support; numpy/supervision already in use
- Architecture: HIGH - follows established patterns from Phase 4/5; error categorization is well-understood CV concept
- Pitfalls: HIGH - based on direct codebase analysis (IoU matching, Qdrant ID types, embedding re-generation)
- Error categories: MEDIUM - the 3 categories (Hard FP, Label Error, FN) are a simplified version of TIDE's 6. The mapping is clear but the "Label Error" category conflates model error and annotation error by design.
- Qdrant local mode performance: MEDIUM - verified API but not benchmarked with 768-dim vectors at scale in this project

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (30 days - stable domain, libraries unlikely to change)
