# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-18)

**Core value:** A single tool that replaces scattered scripts: load any CV dataset, visually browse with annotation overlays, compare GT vs predictions, cluster via embeddings, and surface mistakes -- all in one workflow.
**Current focus:** Phase 16 - Classification Evaluation

## Current Position

Phase: 16 of 17 (Classification Evaluation)
Plan: 1 of 2 in current phase
Status: In Progress
Last activity: 2026-02-18 -- Completed 16-01 (Classification Evaluation Backend)

Progress: [#############################] 95% (v1.0 + v1.1 complete, v1.2 phase 16 plan 1 done)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 21
- Average duration: 3.9 min
- Total execution time: 82 min

**Velocity (v1.1):**
- Total plans completed: 20
- Average duration: 3.7 min
- Total execution time: 73 min

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Schema approach: sentinel bbox values (0.0) over nullable columns -- avoids 30+ null guards
- Separate classification evaluation function (~50 lines) vs modifying 560-line detection eval
- Thread `datasetType` prop from page level, branch at component boundaries
- Parser registry in IngestionService for format dispatch
- Classification JSONL layouts checked before COCO (more specific first)
- Classification gt_annotations = COUNT(DISTINCT sample_id) for labeled images
- [Phase 15]: Thread datasetType from page level, branch at component boundaries with isClassification flag
- [Phase 15]: Hide detection-only stats tabs for classification (Evaluation, Error Analysis, Worst Images, Intelligence)
- [Phase 16]: Reuse ErrorAnalysisResponse model from detection for classification error analysis
- [Phase 16]: Route by dataset_type at endpoint level, keeping classification/detection services separate
- [Phase 16]: Remove response_model on evaluation endpoint for union return type support

### Pending Todos

None.

### Blockers/Concerns

- Confirm Roboflow JSONL format against actual export before finalizing parser
- Confusion matrix at 43+ classes may need canvas rendering -- prototype early in Phase 17

### Roadmap Evolution

- v1.0: 7 phases (1-7), 21 plans -- shipped 2026-02-12
- v1.1: 7 phases (8-14), 20 plans -- shipped 2026-02-13
- v1.2: 3 phases (15-17), TBD plans -- in progress

## Session Continuity

Last session: 2026-02-18
Stopped at: Completed 16-01-PLAN.md (Classification Evaluation Backend)
Resume file: None
