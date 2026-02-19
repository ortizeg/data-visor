---
phase: 16-classification-evaluation
plan: 01
subsystem: api
tags: [classification, evaluation, confusion-matrix, f1, error-analysis, jsonl]

requires:
  - phase: 15-classification-ingestion-display
    provides: classification JSONL GT parser, sentinel bbox pattern, dataset_type column
provides:
  - Classification prediction JSONL import via existing POST /datasets/{id}/predictions endpoint
  - Classification evaluation service (accuracy, F1, confusion matrix, per-class P/R/F1)
  - Classification confusion cell sample drill-down without IoU matching
  - Classification error analysis (correct/misclassified/missing categorization)
  - Dataset-type-aware routing in evaluation, confusion-cell, and error-analysis endpoints
affects: [16-02, frontend-evaluation-tabs]

tech-stack:
  added: []
  patterns: [dataset-type routing in statistics endpoints, sentinel bbox for classification predictions]

key-files:
  created:
    - app/ingestion/classification_prediction_parser.py
    - app/models/classification_evaluation.py
    - app/services/classification_evaluation.py
    - app/services/classification_error_analysis.py
  modified:
    - app/models/prediction.py
    - app/routers/datasets.py
    - app/routers/_run_name.py
    - app/routers/statistics.py

key-decisions:
  - "Reuse ErrorAnalysisResponse model from detection for classification error analysis (same shape works)"
  - "Route by dataset_type at endpoint level rather than service level -- keeps services focused"
  - "Remove response_model constraint on evaluation endpoint to support union return type"

patterns-established:
  - "Dataset-type routing: fetch dataset_type in endpoint, branch to classification vs detection service"
  - "Classification prediction parser: flexible key lookup matching GT parser pattern"

duration: 3min
completed: 2026-02-18
---

# Phase 16 Plan 01: Classification Evaluation Backend Summary

**Classification prediction import, evaluation metrics (accuracy/F1/confusion matrix), and error analysis services with dataset-type-aware endpoint routing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-19T03:25:01Z
- **Completed:** 2026-02-19T03:28:16Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Classification predictions importable via POST /datasets/{id}/predictions with format=classification_jsonl
- Evaluation endpoint returns accuracy, macro/weighted F1, per-class P/R/F1, and confusion matrix for classification datasets
- Confusion cell drill-down works without IoU matching for classification
- Error analysis categorizes samples as correct/misclassified/missing_prediction
- All existing detection evaluation paths remain completely untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Classification prediction parser and import endpoint** - `76bda2a` (feat)
2. **Task 2: Classification evaluation and error analysis services with endpoint routing** - `9f38741` (feat)

## Files Created/Modified
- `app/ingestion/classification_prediction_parser.py` - Streaming JSONL prediction parser with flexible key lookup and sentinel bbox values
- `app/models/classification_evaluation.py` - ClassificationEvaluationResponse and ClassificationPerClassMetrics Pydantic models
- `app/services/classification_evaluation.py` - Accuracy, F1, confusion matrix computation and confusion cell sample lookup
- `app/services/classification_error_analysis.py` - Correct/misclassified/missing categorization reusing ErrorAnalysisResponse model
- `app/models/prediction.py` - Added classification_jsonl to format Literal type
- `app/routers/datasets.py` - Added classification_jsonl branch in import_predictions
- `app/routers/_run_name.py` - Added classification_jsonl run name derivation
- `app/routers/statistics.py` - Dataset-type routing for evaluation, confusion-cell-samples, and error-analysis endpoints

## Decisions Made
- Reused ErrorAnalysisResponse model from detection for classification error analysis -- same shape (summary + per_class + samples_by_type) works for both
- Route by dataset_type at endpoint level rather than service level -- keeps classification and detection services cleanly separated
- Removed response_model constraint on evaluation endpoint to support EvaluationResponse | ClassificationEvaluationResponse union return

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All backend services ready for classification evaluation frontend (Plan 16-02)
- Endpoints return correct response shapes for classification datasets
- Detection datasets continue working exactly as before

---
*Phase: 16-classification-evaluation*
*Completed: 2026-02-18*
