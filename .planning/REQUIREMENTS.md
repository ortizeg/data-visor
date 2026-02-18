# Requirements: DataVisor

**Defined:** 2026-02-18
**Core Value:** A single tool that replaces scattered scripts: load any CV dataset, visually browse with annotation overlays, compare GT vs predictions, cluster via embeddings, and surface mistakes -- all in one workflow.

## v1.2 Requirements

Requirements for classification dataset support. Each maps to roadmap phases.

### Ingestion

- [ ] **INGEST-01**: User can import a classification dataset from a directory containing JSONL annotations and images
- [ ] **INGEST-02**: System auto-detects dataset type (detection vs classification) from annotation format during import
- [ ] **INGEST-03**: User can import multi-split classification datasets (train/valid/test) in a single operation
- [ ] **INGEST-04**: Schema stores dataset_type on the datasets table and handles classification annotations without bbox values

### Display

- [ ] **DISP-01**: User sees class label badges on grid thumbnails for classification datasets
- [ ] **DISP-02**: User sees class label (GT and prediction) prominently in the sample detail modal
- [ ] **DISP-03**: User can edit the GT class label via dropdown in the detail modal
- [ ] **DISP-04**: Statistics dashboard shows classification-appropriate metrics (labeled images, class distribution) and hides detection-only elements (bbox area, IoU slider)

### Evaluation

- [ ] **EVAL-01**: User can import classification predictions in JSONL format with confidence scores
- [ ] **EVAL-02**: User sees accuracy, macro F1, weighted F1, and per-class precision/recall/F1 metrics
- [ ] **EVAL-03**: User sees a confusion matrix for classification with click-to-filter support
- [ ] **EVAL-04**: User sees error analysis categorizing each image as correct, misclassified, or missing prediction
- [ ] **EVAL-05**: User sees GT vs predicted label comparison on grid thumbnails and in the modal

### Polish

- [ ] **POLISH-01**: Confusion matrix scales to 43+ classes with readable rendering
- [ ] **POLISH-02**: User can color embedding scatter by GT class, predicted class, or correct/incorrect status
- [ ] **POLISH-03**: User sees most-confused class pairs summary from the confusion matrix
- [ ] **POLISH-04**: User sees per-class performance sparklines with color-coded thresholds

## Future Requirements

### Multi-label Classification

- **MLABEL-01**: User can import multi-label classification datasets (multiple labels per image)
- **MLABEL-02**: User sees multi-label metrics (hamming loss, subset accuracy)

### Advanced Evaluation

- **ADVEVAL-01**: User can import top-K predictions with full probability distributions
- **ADVEVAL-02**: User sees confidence calibration plot (reliability diagram)
- **ADVEVAL-03**: User can compare performance across train/valid/test splits side-by-side

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-label classification | Different data model, metrics, and UI; scope explosion for v1.2 |
| Top-K evaluation | Requires importing full probability distributions; complicates schema |
| PR curves for classification | Less informative than confusion matrix + per-class metrics for multi-class |
| mAP for classification | Detection metric, not applicable to classification |
| Bbox editing for classification | No bounding boxes in classification datasets |
| IoU threshold controls for classification | No spatial matching in classification |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INGEST-01 | — | Pending |
| INGEST-02 | — | Pending |
| INGEST-03 | — | Pending |
| INGEST-04 | — | Pending |
| DISP-01 | — | Pending |
| DISP-02 | — | Pending |
| DISP-03 | — | Pending |
| DISP-04 | — | Pending |
| EVAL-01 | — | Pending |
| EVAL-02 | — | Pending |
| EVAL-03 | — | Pending |
| EVAL-04 | — | Pending |
| EVAL-05 | — | Pending |
| POLISH-01 | — | Pending |
| POLISH-02 | — | Pending |
| POLISH-03 | — | Pending |
| POLISH-04 | — | Pending |

**Coverage:**
- v1.2 requirements: 17 total
- Mapped to phases: 0
- Unmapped: 17

---
*Requirements defined: 2026-02-18*
*Last updated: 2026-02-18 after initial definition*
