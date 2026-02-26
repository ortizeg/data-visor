---
phase: 16-classification-evaluation
verified: 2026-02-19T03:37:08Z
status: gaps_found
score: 4/5 must-haves verified
re_verification: false
gaps:
  - truth: "User sees each image categorized as correct, misclassified, or missing prediction in the error analysis view"
    status: partial
    reason: "The classification error analysis panel references data.samples_by_type.label_error to populate the Misclassified sample grid, but the backend returns samples_by_type with key 'misclassified' (not 'label_error'). The detection model uses 'label_error'; classification uses 'misclassified'. Misclassified sample thumbnails will always be empty due to key mismatch."
    artifacts:
      - path: "frontend/src/components/stats/error-analysis-panel.tsx"
        issue: "Line 286: data.samples_by_type.label_error should be data.samples_by_type.misclassified for the classification branch"
    missing:
      - "Change line 286 in error-analysis-panel.tsx from data.samples_by_type.label_error to data.samples_by_type.misclassified in the isClassification branch"
human_verification:
  - test: "Import a classification JSONL prediction file and verify accuracy/F1 metrics are computed correctly"
    expected: "Evaluation panel shows non-zero accuracy, macro F1, and weighted F1 values that match the actual prediction file's correctness"
    why_human: "Cannot verify metric computation correctness without actual data; requires end-to-end execution"
  - test: "Click a confusion matrix cell for a classification dataset and verify grid filters to matching images"
    expected: "Grid updates to show only images with the selected GT/predicted class pair"
    why_human: "State flow through filter store requires running the UI"
  - test: "Open detail modal for a misclassified image in a classification dataset"
    expected: "Modal shows GT class label and a 'Predicted:' label with the wrong prediction alongside it"
    why_human: "Requires UI interaction to verify layout of the classification section in sample-modal.tsx"
---

# Phase 16: Classification Evaluation Verification Report

**Phase Goal:** Users can import predictions and analyze classification model performance with accuracy, F1, confusion matrix, and error categorization
**Verified:** 2026-02-19T03:37:08Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | User can import classification predictions in JSONL format with confidence scores and see them alongside ground truth | VERIFIED | `ClassificationPredictionParser` in `app/ingestion/classification_prediction_parser.py` is substantive with sentinel bbox values, flexible key lookup, and batch streaming. `app/routers/datasets.py` line 191 routes `format == "classification_jsonl"` to it. `app/models/prediction.py` includes `classification_jsonl` in the Literal type. |
| 2 | User sees accuracy, macro F1, weighted F1, and per-class precision/recall/F1 metrics in the evaluation panel | VERIFIED | `app/services/classification_evaluation.py` computes all metrics from confusion matrix with div-by-zero guards. `app/routers/statistics.py` lines 179-182 route classification datasets to this service. Frontend `evaluation-panel.tsx` has a complete `isClassification` early-return branch with `ClassificationMetricsCards` and `ClassificationPerClassTable` components that render all required fields. |
| 3 | User sees a confusion matrix and can click any cell to filter the grid to images with that GT/predicted class pair | VERIFIED | `get_classification_confusion_cell_samples` in `app/services/classification_evaluation.py` performs direct label JOIN without IoU. Router routes classification datasets to it. Frontend `evaluation-panel.tsx` calls `fetchConfusionCellSamples` in `handleCellClick`, sets `setSampleIdFilter`, and switches to grid tab. |
| 4 | User sees each image categorized as correct, misclassified, or missing prediction in the error analysis view | PARTIAL | Backend `classify_errors` in `app/services/classification_error_analysis.py` correctly returns `samples_by_type` with keys `"correct"`, `"misclassified"`, `"missing_prediction"`. Summary cards (line 115-118) correctly map from `true_positives`/`label_errors`/`false_negatives`. BUT: the `ErrorSamplesGrid` for "Misclassified" samples (line 286) reads `data.samples_by_type.label_error` instead of `data.samples_by_type.misclassified` -- key mismatch means the misclassified sample grid always renders empty. |
| 5 | User sees GT vs predicted label comparison on grid thumbnails and in the detail modal | VERIFIED | `grid-cell.tsx` lines 100-115 render a GT badge (bottom-left via `ClassBadge`) and a prediction badge (bottom-right, green/red) in the classification branch. `sample-modal.tsx` lines 424-463 show a "Class:" dropdown (GT) and a "Predicted:" label with confidence for classification datasets. |

**Score:** 4/5 truths verified

### Required Artifacts (Plan 16-01)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/ingestion/classification_prediction_parser.py` | JSONL prediction parser with sentinel bbox, filename-to-sample_id lookup | VERIFIED | 153 lines, full implementation with `_get_field`, flexible key lookup, `parse_streaming` with batch yielding |
| `app/services/classification_evaluation.py` | compute_classification_evaluation returning accuracy, F1, confusion matrix, per-class metrics | VERIFIED | 205 lines, full implementation including confusion cell lookup function |
| `app/services/classification_error_analysis.py` | classify_errors returning correct/misclassified/missing per sample | VERIFIED | 162 lines, full implementation using `ErrorAnalysisResponse` model |
| `app/models/classification_evaluation.py` | ClassificationEvaluationResponse, ClassificationPerClassMetrics Pydantic models | VERIFIED | Both models present with all required fields |

### Required Artifacts (Plan 16-02)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/types/evaluation.ts` | ClassificationEvaluationResponse type with discriminant field | VERIFIED | Has `ClassificationEvaluationResponse` with `evaluation_type: "classification"`, `ClassificationPerClassMetrics`, and `AnyEvaluationResponse` union |
| `frontend/src/components/stats/evaluation-panel.tsx` | Classification evaluation rendering with metric cards, confusion matrix, per-class table | VERIFIED | Full `isClassification` early-return with `ClassificationMetricsCards`, `ConfusionMatrix`, `ClassificationPerClassTable` |
| `frontend/src/components/stats/error-analysis-panel.tsx` | Classification error analysis with correct/misclassified/missing categories | PARTIAL | Summary cards correct. Bar chart correct. Misclassified sample grid uses wrong key `label_error` instead of `misclassified` |
| `frontend/src/components/grid/grid-cell.tsx` | Predicted class badge alongside GT badge for classification | VERIFIED | Lines 100-115 render green/red predicted badge at bottom-right with GT badge at bottom-left |

### Key Link Verification (Plan 16-01)

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/routers/datasets.py` | `app/ingestion/classification_prediction_parser.py` | `format == 'classification_jsonl'` branch | WIRED | Line 191 branches, imports `ClassificationPredictionParser`, builds `sample_lookup`, streams and inserts |
| `app/routers/statistics.py` | `app/services/classification_evaluation.py` | `dataset_type == 'classification'` check | WIRED | Lines 179-182 call `compute_classification_evaluation`; confusion cell endpoint lines 219-228 call `get_classification_confusion_cell_samples` |
| `app/routers/statistics.py` | `app/services/classification_error_analysis.py` | `dataset_type == 'classification'` check | WIRED | Lines 285-288 call `classify_classification_errors` (aliased import) |

### Key Link Verification (Plan 16-02)

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `frontend/src/components/stats/evaluation-panel.tsx` | `/datasets/{id}/evaluation` | `useEvaluation` hook | WIRED | Hook returns `AnyEvaluationResponse`; panel checks `evaluation_type === "classification"` via `isClassification` prop |
| `frontend/src/components/stats/stats-dashboard.tsx` | `evaluation-panel.tsx` | Evaluation tab visible for classification datasets | WIRED | Tab rendered unconditionally (lines 179-189), `isClassification` not used to gate it; `datasetType` prop passed to `EvaluationPanel` |
| `frontend/src/components/grid/grid-cell.tsx` | annotations | Finding prediction annotation to display predicted label | WIRED | Line 105 `annotations.find(a => a.source !== "ground_truth")` retrieves prediction |

### Requirements Coverage

Not applicable -- requirements are tracked at milestone level, not phase level.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `frontend/src/components/stats/error-analysis-panel.tsx` | 286 | `data.samples_by_type.label_error` in classification branch -- wrong key | BLOCKER | Misclassified sample thumbnails always empty; backend sends key `"misclassified"`, not `"label_error"` |

### Human Verification Required

#### 1. End-to-end prediction import and metric verification

**Test:** Import a classification JSONL file into a classification dataset; navigate to the Evaluation tab, check the accuracy, macro F1, and weighted F1 values
**Expected:** Non-zero metric values matching the actual correctness rate of the predictions
**Why human:** Cannot verify metric computation accuracy without real data and a running backend

#### 2. Confusion matrix click-to-filter

**Test:** In a classification dataset with predictions, click a cell in the confusion matrix
**Expected:** Grid panel activates and shows only images with the clicked GT/predicted class pair
**Why human:** State flow through filter store and tab navigation requires running the UI

#### 3. Detail modal GT vs predicted label

**Test:** Open a misclassified image's detail modal
**Expected:** Modal shows the GT class label (editable dropdown) and "Predicted: X" label below it with confidence percentage
**Why human:** Visual layout requires running UI; testing wiring of `gtAnnotations`/`predAnnotations` split

## Gaps Summary

One gap found. The classification error analysis panel has a key mismatch for the "Misclassified" sample grid. The backend `classify_errors` function in `app/services/classification_error_analysis.py` stores misclassified samples under `samples_by_type["misclassified"]`, but the frontend classification branch reads `data.samples_by_type.label_error` (line 286 of `error-analysis-panel.tsx`). The key `"label_error"` only exists in detection responses; for classification it is `"misclassified"`.

This means: summary cards (counts) display correctly, the bar chart displays correctly, but the misclassified thumbnail grid always shows zero samples even when there are misclassified images. The fix is a one-line change: `data.samples_by_type.label_error` → `data.samples_by_type.misclassified` in the `isClassification` branch.

All other success criteria are fully met with substantive, wired implementations.

---
_Verified: 2026-02-19T03:37:08Z_
_Verifier: Claude (gsd-verifier)_
