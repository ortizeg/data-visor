---
phase: 09-smart-ingestion
plan: 02
subsystem: frontend
tags: [nextjs, react, zustand, tanstack-query, sse, tailwind, wizard]

# Dependency graph
requires:
  - phase: 09-smart-ingestion
    plan: 01
    provides: POST /ingestion/scan, POST /ingestion/import, ScanResult/ImportRequest models
provides:
  - Three-step ingestion wizard UI at /ingest (path input → scan results → import progress)
  - Zustand store (useIngestStore) for wizard step, scan results, selected splits
  - useScanFolder TanStack Query mutation for POST /ingestion/scan
  - useIngestProgress SSE streaming hook for POST /ingestion/import
  - TypeScript types matching backend scan/import models
  - Landing page Import Dataset button and empty-state import link
  - Local/GCS source toggle on path input
  - File system browser modal (FolderBrowser) with directory navigation
  - Dataset delete button with confirmation on landing page cards
affects: [landing page dataset cards, future ingestion format support]

# Tech tracking
new_deps: []
patterns_introduced:
  - "POST SSE streaming via fetch + ReadableStream (not EventSource)"
  - "Zustand wizard step state machine (input → confirm → importing → done)"
  - "FolderBrowser modal with server-side directory listing"
---

# Summary: Frontend Ingestion Wizard + UI Enhancements

## What was built

Three-step ingestion wizard and supporting UI features:

1. **TypeScript types** (`frontend/src/types/scan.ts`): ScanResult, DetectedSplit, ImportSplit, ImportRequest, IngestProgress — matching backend Pydantic models.

2. **Zustand store** (`frontend/src/stores/ingest-store.ts`): Wizard state machine with step progression, scan result storage, split selection toggles, dataset name editing, and full reset.

3. **Scan hook** (`frontend/src/hooks/use-scan.ts`): TanStack Query mutation wrapping POST /ingestion/scan.

4. **SSE progress hook** (`frontend/src/hooks/use-ingest-progress.ts`): POST-based SSE streaming via fetch + ReadableStream for real-time import progress.

5. **PathInput component** (`frontend/src/components/ingest/path-input.tsx`): Text input with Scan button, Local/GCS source toggle, Browse button opening FolderBrowser modal.

6. **ScanResults component** (`frontend/src/components/ingest/scan-results.tsx`): Detected splits table with checkboxes, image counts, file sizes, editable dataset name, warnings display, Back/Import buttons.

7. **ImportProgress component** (`frontend/src/components/ingest/import-progress.tsx`): Real-time SSE progress with per-split status, progress bar, message log, completion state with View Dataset link.

8. **Wizard page** (`frontend/src/app/ingest/page.tsx`): Step-based routing between PathInput, ScanResults, ImportProgress with step indicator.

9. **Landing page enhancements** (`frontend/src/app/page.tsx`): Import Dataset button in header, import link in empty state, delete button on dataset cards with confirmation dialog.

10. **FolderBrowser modal** (`frontend/src/components/ingest/folder-browser.tsx`): Server-side directory browsing with parent navigation, folder/file listing, and folder selection.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | 1bb4f2a | feat(09-02): create ingestion wizard types, store, hooks, and page shell |
| 2 | 7e73dc6 | feat(09-02): build wizard step components (PathInput, ScanResults, ImportProgress) |
| 3 | f837d6f | feat(09): add dataset delete UI, GCS import support, and file browser |
| 4 | 75ed7e7 | fix(09): split-prefixed IDs for multi-split import and ignore extra env vars |

## Deviations from plan

1. **Added FolderBrowser modal** (not in original plan): File system browser component added for directory navigation, called via POST /ingestion/browse endpoint.
2. **Added Local/GCS toggle** (not in original plan): Source type selector on path input to support GCS bucket paths.
3. **Added dataset delete button** (not in original plan): Trash icon on landing page dataset cards with confirmation dialog.
4. **Split-prefixed IDs**: Sample and annotation IDs are prefixed with split name to avoid collisions during multi-split import.

## Issues

None.
