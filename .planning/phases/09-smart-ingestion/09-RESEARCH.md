# Phase 9: Smart Ingestion - Research

**Researched:** 2026-02-12
**Domain:** Dataset import UX, folder structure auto-detection, COCO format parsing, SSE streaming
**Confidence:** HIGH

## Summary

Smart Ingestion transforms dataset loading from a CLI/API-only operation into a guided UI workflow: the user enters a folder path, the backend scans it for COCO annotation files and image directories, detects train/val/test splits, and presents the detected structure for confirmation before import begins. Import progress is streamed via SSE.

The existing codebase already has almost all the building blocks. The v1.0 ingestion pipeline (`IngestionService.ingest_with_progress()`) is a synchronous generator that yields `IngestionProgress` events consumed as SSE by the datasets router. The `samples` table already has a `split VARCHAR` column (currently always `NULL`). The frontend has two proven SSE hook patterns (`useEmbeddingProgress`, `useVLMProgress`) and a trigger-then-monitor component pattern (`AutoTagButton`). What's needed is: (1) a new `FolderScanner` service, (2) a scan API endpoint, (3) minor extension to the existing ingestion service to accept a `split` parameter, and (4) a new frontend ingestion wizard page.

**Primary recommendation:** Build a thin `FolderScanner` service with heuristic-based COCO detection (look for JSON files with `"images"` key, pair with image directories, detect split subdirectories by name). Create a `POST /ingestion/scan` endpoint and a new `/ingest` page with a 3-step wizard (path input, structure confirmation, import progress). Reuse the existing `POST /datasets/ingest` endpoint with a new optional `split` field. Use the existing SSE patterns (EventSource + auto-close on terminal status). No new libraries required.

## Standard Stack

### Core

No new libraries are needed for this phase. Everything builds on the existing stack.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | >=0.128.7 | New scan endpoint + extended ingest endpoint | Already in project |
| Pydantic | >=2.12.5 | Request/response models for scan API | Already in project |
| ijson | >=3.4.0 | Peek inside JSON files to detect COCO format (read only `"images"` key) | Already used by COCOParser |
| sse-starlette | >=3.2.0 | SSE streaming for import progress | Already used by embeddings and VLM routers |
| Next.js | 16.1.6 | New ingestion wizard page | Already in project |
| TanStack Query | >=5.90.20 | Mutation for scan endpoint, query invalidation after import | Already in project |
| Zustand | >=5.0.11 | Ingestion wizard state (current step, scan results, import config) | Already in project |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pathlib (stdlib) | Python 3.14 | Directory walking, path resolution | Folder scanning |
| `os.scandir` (stdlib) | Python 3.14 | Efficient directory listing (faster than `os.listdir` for large dirs) | Image counting in directories |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom folder scanner | FiftyOne's `from_dir()` | FiftyOne is a 500MB+ dependency; it requires explicit format specification anyway (no auto-detection). Our scanner is <200 lines of code for COCO-only detection. |
| Synchronous StreamingResponse for import SSE | EventSourceResponse (sse-starlette) | The existing ingest endpoint uses sync `StreamingResponse` because `IngestionService` is synchronous. This works fine. No need to change to async `EventSourceResponse` unless we refactor the ingestion service to be async. |
| Wizard state in Zustand | URL query params or React state | Zustand is the project standard for UI state. A dedicated ingestion store keeps wizard state (step, scan results, selected splits) cleanly separated. |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure

```
app/
├── services/
│   └── folder_scanner.py       # NEW: FolderScanner class
├── models/
│   └── scan.py                 # NEW: ScanRequest, ScanResult, DetectedSplit
├── routers/
│   └── ingestion.py            # NEW: POST /ingestion/scan endpoint
├── ingestion/
│   └── coco_parser.py          # MODIFY: accept optional split parameter
├── services/
│   └── ingestion.py            # MODIFY: pass split to parser
└── models/
    └── dataset.py              # MODIFY: add split field to IngestRequest

frontend/src/
├── app/
│   └── ingest/
│       └── page.tsx            # NEW: Ingestion wizard page
├── components/
│   └── ingest/
│       ├── path-input.tsx      # NEW: Folder path input step
│       ├── scan-results.tsx    # NEW: Detected structure confirmation step
│       └── import-progress.tsx # NEW: SSE progress display step
├── hooks/
│   ├── use-scan.ts             # NEW: TanStack Query mutation for scan
│   └── use-ingest-progress.ts  # NEW: SSE hook for import progress
├── stores/
│   └── ingest-store.ts         # NEW: Zustand store for wizard state
└── types/
    └── scan.ts                 # NEW: TypeScript types for scan API
```

### Pattern 1: Three-Step Wizard Flow

**What:** A linear wizard with three steps: (1) Path Input, (2) Structure Confirmation, (3) Import Progress. Each step is a component that renders conditionally based on the wizard step stored in Zustand.

**When to use:** Any multi-step user workflow where each step depends on the previous.

**Example:**
```tsx
// frontend/src/app/ingest/page.tsx
// Source: Follows existing project patterns (ui-store.ts, auto-tag-button.tsx)

export default function IngestPage() {
  const { step } = useIngestStore();

  return (
    <div className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Import Dataset</h1>
        <StepIndicator current={step} steps={["Select Folder", "Review Structure", "Importing"]} />
      </header>

      {step === "input" && <PathInput />}
      {step === "confirm" && <ScanResults />}
      {step === "importing" && <ImportProgress />}
    </div>
  );
}
```

### Pattern 2: FolderScanner Heuristic Detection

**What:** A service class that walks a directory tree and identifies COCO datasets using file-system heuristics, without opening/parsing large files.

**When to use:** Detecting dataset structure from a user-provided root path.

**Example:**
```python
# app/services/folder_scanner.py
# Source: Architecture patterns from .planning/research/ARCHITECTURE.md

from dataclasses import dataclass, field
from pathlib import Path
import ijson

@dataclass
class DetectedSplit:
    name: str                    # "train", "val", "test"
    annotation_path: str         # Path to COCO JSON file
    image_dir: str               # Path to images directory
    image_count: int             # Number of images found in directory
    annotation_file_size: int    # File size in bytes (for UI display)

@dataclass
class ScanResult:
    root_path: str
    dataset_name: str            # Inferred from root directory name
    format: str                  # "coco" (future: "yolo", "voc")
    splits: list[DetectedSplit]
    warnings: list[str] = field(default_factory=list)

class FolderScanner:
    """Walk a directory tree and detect importable COCO datasets."""

    # Recognized split directory names
    SPLIT_NAMES = {"train", "val", "validation", "test", "train2017", "val2017", "test2017"}
    IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}

    def scan(self, root_path: str) -> ScanResult:
        root = Path(root_path)
        if not root.is_dir():
            raise ValueError(f"Path is not a directory: {root_path}")

        splits = []
        warnings = []

        # Strategy 1: Look for annotations/ + images/ at root (standard COCO layout)
        # Strategy 2: Look for split subdirs (train/, val/, test/) with per-split annotations
        # Strategy 3: Single annotation file + single image dir (flat layout)
        ...
```

### Pattern 3: SSE Import Progress with Per-Split Status

**What:** Extend the existing ingestion to import multiple splits sequentially, yielding per-split progress events via SSE.

**When to use:** Importing a dataset with detected train/val/test splits as a single operation.

**Example:**
```python
# Extended ingestion pattern (app/services/ingestion.py)
# Source: Existing IngestionService.ingest_with_progress()

def ingest_splits_with_progress(
    self,
    splits: list[dict],          # [{annotation_path, image_dir, split_name, dataset_name}]
    dataset_name: str,
) -> Iterator[IngestionProgress]:
    """Ingest multiple splits as a single dataset, yielding per-split progress."""
    for i, split_config in enumerate(splits):
        yield IngestionProgress(
            stage="split_start",
            current=i,
            total=len(splits),
            message=f"Starting split: {split_config['split_name']}",
        )
        # Delegate to existing single-split ingestion
        yield from self.ingest_with_progress(
            annotation_path=split_config["annotation_path"],
            image_dir=split_config["image_dir"],
            dataset_name=dataset_name,
            split=split_config["split_name"],
        )
```

### Pattern 4: POST-Triggered SSE for Import (Existing Pattern)

**What:** The ingestion endpoint uses `POST` (not `GET`) to trigger the SSE stream, because it receives request parameters and initiates a state change. The frontend uses `fetch()` to POST, then reads the response body as a stream.

**When to use:** When the SSE stream is triggered by a POST request (as opposed to polling a GET endpoint).

**Critical note:** The existing `POST /datasets/ingest` endpoint returns a `StreamingResponse` directly from the POST handler. This is different from the embedding/VLM pattern (POST to trigger background task, GET to poll progress). The ingestion pattern is simpler but means the POST request stays open for the entire duration of the import. For the smart ingestion use case, this same pattern works because:
1. The user is already on the import page watching progress
2. The import is the final step of the wizard
3. Connection drop = import stops (acceptable for local tool)

**Frontend consumption of POST SSE:**
```typescript
// Unlike EventSource (GET-only), POST SSE uses fetch() with a ReadableStream
// Source: Existing datasets.py:37-73 and SSE patterns in the project

async function startImport(config: ImportConfig, onProgress: (p: IngestProgress) => void) {
  const response = await fetch(`${API_BASE}/datasets/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const chunk of lines) {
      if (chunk.startsWith("data: ")) {
        const data = JSON.parse(chunk.slice(6));
        onProgress(data);
      }
    }
  }
}
```

### Anti-Patterns to Avoid

- **Don't parse the entire annotation JSON to detect format:** Use `ijson` to read only the first few keys. Checking for `"images"`, `"annotations"`, `"categories"` top-level keys confirms COCO format without loading the entire file. For large annotation files (1GB+), reading the whole file just to detect format is unacceptable.
- **Don't create one dataset per split:** The existing schema stores `split` as a column on `samples`. All splits belong to the same dataset. Creating separate datasets per split would break the existing filtering/statistics UI which operates on a single dataset.
- **Don't use `EventSource` for POST-triggered SSE:** The browser's `EventSource` API only supports GET requests. The existing ingestion endpoint uses POST with `StreamingResponse`. Use `fetch()` + `ReadableStream` on the frontend instead.
- **Don't validate paths on the frontend:** The frontend runs in the browser and has no filesystem access. Path validation (exists, is directory, is readable) must happen on the backend.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| COCO format detection | Regex on filenames | `ijson.items(f, "images.item")` peek | File naming is unreliable; content inspection catches all valid COCO files regardless of naming convention |
| Image file counting in dirs | `glob("*.jpg") + glob("*.png")` | `os.scandir()` with extension filter | `os.scandir()` returns `DirEntry` objects without `stat()` calls per file, 2-20x faster than `glob` for large directories |
| SSE event parsing (frontend) | Custom parser | Existing `data:` line splitting pattern | The project already has this pattern in the test file (`test_ingestion.py:222`) and the SSE hooks |
| Multi-split ingestion progress | New progress tracking system | Extended `IngestionProgress` with split context | Adding `split` to the existing `IngestionProgress` dataclass preserves the entire SSE infrastructure |
| Path security validation | Manual checks | `Path.resolve()` + allowlist | Path traversal attacks (e.g., `../../etc/passwd`) must be blocked by resolving to absolute path and checking against allowed roots |

**Key insight:** This phase is primarily a UX feature (wizard UI + folder scanning), not a new capability. The core ingestion infrastructure already exists and works. The scanner is heuristic-based glue code (<200 lines). The biggest engineering effort is the frontend wizard, not the backend.

## Common Pitfalls

### Pitfall 1: Path Traversal / Security

**What goes wrong:** User enters a path like `../../etc/` or `/etc/passwd` and the backend reads arbitrary files from the host filesystem.
**Why it happens:** The scan endpoint accepts a user-provided string path and walks it. Without validation, any path the backend process can access is exposed.
**How to avoid:**
- Resolve the path to absolute (`Path(root).resolve()`)
- In Docker: the container filesystem is already sandboxed -- only mounted volumes are accessible. The default volume mount is `./data:/app/data`, so only paths under `/app/data` are reachable
- In local dev: optionally restrict to configured allowed roots, but this is less critical since the user IS the developer
- Never return file contents through the scan endpoint -- only metadata (path, count, size)
**Warning signs:** Scan results showing system directories, unexpected paths outside the data volume.
**Confidence:** HIGH -- standard web security concern, well-documented.

### Pitfall 2: Docker Volume Mount Must Include Dataset Directory

**What goes wrong:** User enters a path in the UI, but the directory does not exist inside the Docker container because it was not volume-mounted.
**Why it happens:** The current `docker-compose.yml` only mounts `./data:/app/data`. If the user's dataset lives at `/home/user/datasets/coco2017`, the backend container cannot see it.
**How to avoid:**
- Document that users must add a volume mount for their dataset directory: `- /path/to/datasets:/data/datasets`
- In the scan endpoint, return a clear error if the path does not exist: "Directory not found. If running in Docker, ensure the directory is mounted as a volume."
- Provide a default convention: mount datasets under `/data/datasets` inside the container
- Consider adding a `DATAVISOR_DATASET_ROOT` config setting that both constrains scanning and hints at the expected mount point
**Warning signs:** "Path not found" errors that work in local dev but fail in Docker.
**Confidence:** HIGH -- verified from `docker-compose.yml` which only mounts `./data:/app/data`.

### Pitfall 3: Large Directory Scanning Timeouts

**What goes wrong:** User points at a deeply nested directory with hundreds of thousands of files. The scan takes minutes and the HTTP request times out.
**Why it happens:** Recursive directory walking with content inspection (peeking into JSON files) is I/O-bound. A folder with 100K+ images takes significant time to enumerate.
**How to avoid:**
- Limit scan depth (2-3 levels max from root)
- Count images by directory listing (`os.scandir`), not by globbing
- Set a scan timeout (e.g., 30 seconds) and return partial results
- For COCO detection, only peek into JSON files < 100MB (skip unreasonably large files for the detection step; they will be parsed fully during import)
- Use `ijson` prefix scan (read first 3 top-level keys) rather than full parse
**Warning signs:** Scan requests taking >5 seconds. Frontend showing spinner indefinitely.
**Confidence:** MEDIUM -- based on experience with large filesystem operations. Exact thresholds need empirical validation.

### Pitfall 4: Annotation File Naming Varies Wildly

**What goes wrong:** Scanner fails to detect annotation files because they don't follow the "standard" naming convention.
**Why it happens:** The "standard" COCO layout (`annotations/instances_train2017.json`) is the official format, but real-world datasets use many variations:
- `_annotations.coco.json` (Roboflow export)
- `train.json`, `val.json`, `test.json`
- `annotations.json` (single file for all splits)
- `labels.json`
- `instances.json`
- `coco_annotations.json`
- Any `.json` file that contains `"images"` and `"annotations"` keys
**How to avoid:**
- **Do not match by filename.** Match by content: any `.json` file that contains top-level `"images"` key is a COCO annotation candidate
- Use `ijson` to peek at the first few keys: `ijson.items(f, "images.item")` -- if it yields anything, it's a COCO file
- Associate annotation files with image directories by proximity (same directory or parent/sibling relationship)
**Warning signs:** Scanner returning empty results for valid COCO datasets.
**Confidence:** HIGH -- verified from [Datumaro COCO docs](https://open-edge-platform.github.io/datumaro/stable/docs/data-formats/formats/coco.html) and Roboflow format documentation showing naming variations.

### Pitfall 5: Single Dataset vs Multiple Splits Ambiguity

**What goes wrong:** Scanner finds a single annotation file at the root with no split directories, or finds split directories with their own annotation files. The logic for mapping annotation files to splits gets confused.
**Why it happens:** COCO datasets have at least three common layouts:

**Layout A: Standard COCO (separate annotation files per split)**
```
dataset/
├── annotations/
│   ├── instances_train2017.json
│   └── instances_val2017.json
└── images/
    ├── train2017/
    └── val2017/
```

**Layout B: Roboflow export (annotation file inside split dir)**
```
dataset/
├── train/
│   ├── _annotations.coco.json
│   └── *.jpg
├── valid/
│   ├── _annotations.coco.json
│   └── *.jpg
└── test/
    ├── _annotations.coco.json
    └── *.jpg
```

**Layout C: Flat (single annotation file, single image dir)**
```
dataset/
├── annotations.json
└── images/
    └── *.jpg
```

**How to avoid:**
- Implement detection for all three layouts in priority order: Layout B first (most specific), then Layout A, then Layout C
- For Layout A: Match annotation filenames containing split names (`train`, `val`, `test`) to image directories containing the same split names
- For Layout B: Detect annotation JSON files co-located with images in split-named directories
- For Layout C: Present as a single split with name derived from the root directory
- Return all detected splits and let the user confirm/adjust in the UI
**Warning signs:** Scanner returning duplicate splits or missing splits for known COCO datasets.
**Confidence:** HIGH -- layouts verified from official COCO, Datumaro documentation, and Roboflow format specs.

### Pitfall 6: POST SSE vs GET SSE Frontend Handling

**What goes wrong:** Developer tries to use `new EventSource()` for the import progress, but `EventSource` only supports GET requests. The existing ingestion endpoint is POST.
**Why it happens:** Two different SSE patterns exist in the project:
1. **POST with StreamingResponse** (ingestion): Request body contains import params. The POST stays open, streaming progress until done.
2. **POST trigger + GET poll** (embeddings, VLM): POST triggers background task (returns 202 immediately), GET endpoint streams progress from in-memory state.
**How to avoid:** For the smart ingestion, continue using Pattern 1 (POST with StreamingResponse). On the frontend, use `fetch()` with `ReadableStream` API to consume the SSE events, NOT `new EventSource()`. The existing SSE hooks (`useEmbeddingProgress`, `useVLMProgress`) use `EventSource` and are for GET-based patterns only.
**Warning signs:** Import button triggers but no progress events appear in the UI.
**Confidence:** HIGH -- verified from codebase analysis. The existing `POST /datasets/ingest` uses `StreamingResponse` (datasets.py:65-73), while embedding/VLM progress uses `EventSourceResponse` with GET.

## Code Examples

Verified patterns from the existing codebase (not hypothetical):

### COCO Format Detection via ijson Peek

```python
# Detect if a JSON file is a COCO annotation file by peeking at top-level keys.
# Source: Existing COCOParser.parse_categories() in app/ingestion/coco_parser.py

import ijson
from pathlib import Path

def is_coco_annotation(file_path: Path) -> bool:
    """Check if a JSON file looks like a COCO annotation file.

    Peeks at top-level keys using ijson streaming parser.
    Returns True if 'images' key is found (the minimal indicator of COCO format).
    """
    try:
        with open(file_path, "rb") as f:
            # Use ijson prefix parser to read top-level keys without loading full file
            parser = ijson.parse(f)
            for prefix, event, value in parser:
                if prefix == "" and event == "map_key" and value == "images":
                    return True
                # Stop after checking first 10 top-level keys (optimization)
                if prefix == "" and event == "map_key":
                    continue
        return False
    except (ijson.IncompleteJSONError, OSError):
        return False
```

### Split Directory Detection

```python
# Detect train/val/test split directories by naming convention.
# Source: Informed by COCO standard layout and Datumaro COCO format spec

SPLIT_DIR_NAMES = {
    "train": "train",
    "train2017": "train",
    "train2014": "train",
    "training": "train",
    "val": "val",
    "val2017": "val",
    "val2014": "val",
    "valid": "val",
    "validation": "val",
    "test": "test",
    "test2017": "test",
    "test2014": "test",
    "testing": "test",
}

def detect_splits(root: Path) -> dict[str, Path]:
    """Map canonical split names to directory paths."""
    splits: dict[str, Path] = {}
    for entry in root.iterdir():
        if entry.is_dir():
            normalized = entry.name.lower()
            if normalized in SPLIT_DIR_NAMES:
                canonical = SPLIT_DIR_NAMES[normalized]
                splits[canonical] = entry
    return splits
```

### Scan API Endpoint

```python
# Source: Follows existing router patterns in app/routers/datasets.py

from fastapi import APIRouter, HTTPException
from app.models.scan import ScanRequest, ScanResult
from app.services.folder_scanner import FolderScanner

router = APIRouter(prefix="/ingestion", tags=["ingestion"])

@router.post("/scan", response_model=ScanResult)
def scan_folder(request: ScanRequest) -> ScanResult:
    """Scan a directory for importable COCO datasets.

    Returns detected annotation files, image directories, and splits
    as a suggestion for the user to confirm before import.
    """
    scanner = FolderScanner()
    try:
        result = scanner.scan(request.root_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not result.splits:
        raise HTTPException(
            status_code=404,
            detail="No COCO datasets detected in this directory"
        )

    return result
```

### Frontend POST SSE Consumption

```typescript
// Source: Adapted from existing SSE patterns in use-embedding-progress.ts
// and the POST /datasets/ingest endpoint format in datasets.py:48-63

import { API_BASE } from "@/lib/constants";

interface IngestProgress {
  stage: string;
  current: number;
  total: number | null;
  message: string;
}

export async function streamImport(
  body: { annotation_path: string; image_dir: string; dataset_name: string; split?: string },
  onProgress: (progress: IngestProgress) => void,
  onComplete: () => void,
  onError: (error: string) => void,
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/datasets/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      onError(`Import failed: ${response.status} ${response.statusText}`);
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6)) as IngestProgress;
          onProgress(data);
          if (data.stage === "complete") {
            onComplete();
          }
        }
      }
    }
  } catch (err) {
    onError(err instanceof Error ? err.message : "Import failed");
  }
}
```

### Ingestion Service Extension for Split Parameter

```python
# Source: Existing app/services/ingestion.py and app/ingestion/coco_parser.py

# In IngestionService.ingest_with_progress(), add optional split parameter:
def ingest_with_progress(
    self,
    annotation_path: str,
    image_dir: str,
    dataset_name: str | None = None,
    format: str = "coco",
    split: str | None = None,    # NEW: optional split name
) -> Iterator[IngestionProgress]:
    ...
    # Pass split to parser's build_image_batches
    for batch_df in parser.build_image_batches(
        Path(annotation_path), dataset_id, split=split  # NEW
    ):
        ...

# In COCOParser.build_image_batches(), accept optional split:
def build_image_batches(
    self, file_path: Path, dataset_id: str, split: str | None = None
) -> Iterator[pd.DataFrame]:
    ...
    batch.append({
        ...
        "split": split,  # Was always None, now can be "train"/"val"/"test"
        ...
    })
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CLI-only dataset loading (v1.0) | UI wizard with auto-detection (this phase) | Phase 9 | Users no longer need to know file paths or use CLI |
| No split awareness | Split column populated during ingestion | Phase 9 | Existing sidebar filtering works for splits automatically |
| Single annotation + image dir pair | Multi-split import from a single root | Phase 9 | One-click import of full train/val/test datasets |

**Industry context:**
- FiftyOne requires Python code to load datasets (`fo.Dataset.from_dir()` with explicit format type). No folder auto-detection.
- Encord requires cloud storage registration and SDK configuration. No local folder scanning.
- Roboflow has a web upload UI but requires format selection by the user.
- **Neither major competitor has a "point at folder and auto-detect" experience.** This is a genuine differentiator for DataVisor (per project FEATURES.md research).

## Open Questions

1. **Multi-split import: one dataset or multiple datasets?**
   - What we know: The `samples` table has a `split` column. The existing UI filters by metadata fields including split. Logically, train/val/test of the same dataset ARE one dataset.
   - Recommendation: **One dataset, multiple splits.** Import all splits into a single dataset with the `split` column set appropriately. This is how FiftyOne handles it (tags per sample).

2. **Should import be sequential or one-at-a-time per split?**
   - What we know: The existing ingestion is synchronous and writes directly to DuckDB. Running multiple ingestions concurrently risks DuckDB write conflicts (single-writer).
   - Recommendation: **Sequential per split.** Ingest train, then val, then test, all under the same dataset_id. Yield progress events indicating which split is being processed.

3. **How to handle the "Import" button on the landing page?**
   - What we know: The landing page (`page.tsx`) currently shows "No datasets found. Ingest a dataset via the API first." This is the natural place to add an import button.
   - Recommendation: Add an "Import Dataset" button/link on the landing page that navigates to `/ingest`. Keep it simple -- a link, not a modal.

4. **Docker dataset volume mount convention**
   - What we know: Current compose only mounts `./data:/app/data`. Dataset files need to be accessible inside the container.
   - Recommendation: Add a commented-out volume mount example in `docker-compose.yml`: `# - /path/to/your/datasets:/data/datasets`. Document in the scan endpoint error message. Add a `DATAVISOR_DATASET_ROOT` setting for path validation.
   - What's unclear: Whether to enforce a single mount point or allow arbitrary paths. For security, a single configured root is better. For flexibility, arbitrary paths within the container filesystem are simpler.

5. **Should scan detect annotation file image counts before import?**
   - What we know: The scanner could use ijson to count `images.item` entries in the annotation JSON, giving the user an accurate count before import. But for large files (1GB+), this takes time.
   - Recommendation: Count images in the **directory** (fast, `os.scandir`), not in the annotation file. Show directory image count in the confirmation UI. The annotation file count will be discovered during actual import.

## Sources

### Primary (HIGH confidence)
- **Existing codebase** -- All architectural patterns verified by reading source files:
  - `app/services/ingestion.py` -- Current ingestion pipeline
  - `app/ingestion/coco_parser.py` -- COCO streaming parser with ijson
  - `app/routers/datasets.py` -- SSE streaming via StreamingResponse (POST)
  - `app/routers/embeddings.py` -- SSE streaming via EventSourceResponse (GET)
  - `app/repositories/duckdb_repo.py` -- Schema with `split` column
  - `frontend/src/hooks/use-embedding-progress.ts` -- EventSource SSE hook
  - `frontend/src/components/toolbar/auto-tag-button.tsx` -- Trigger-then-monitor pattern
  - `docker-compose.yml` -- Volume mount configuration
- **`.planning/research/ARCHITECTURE.md`** -- Smart ingestion architecture pre-designed (FolderScanner, endpoints, file structure)
- **`.planning/research/FEATURES.md`** -- Competitive analysis of FiftyOne and Encord import UX

### Secondary (MEDIUM confidence)
- [Datumaro COCO format docs](https://open-edge-platform.github.io/datumaro/stable/docs/data-formats/formats/coco.html) -- COCO directory structure specification, annotation file naming conventions (`<task>_<subset>.json`)
- [FiftyOne import_datasets docs](https://docs.voxel51.com/user_guide/import_datasets.html) -- API requires explicit `dataset_type`, no auto-detection
- [V7 COCO Dataset Guide](https://www.v7labs.com/blog/coco-dataset-guide) -- Standard folder layout reference

### Tertiary (LOW confidence)
- [Roboflow COCO JSON split format](https://roboflow.com/split-datasets/coco-json) -- Roboflow-specific `_annotations.coco.json` naming variation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries needed; all patterns verified from existing codebase
- Architecture: HIGH -- Pre-designed in ARCHITECTURE.md, all integration points verified in code
- Pitfalls: HIGH -- Path security, Docker volumes, naming variations all verified from real sources; POST vs GET SSE pattern verified from codebase dual-pattern analysis

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (stable -- all patterns are internal to this project, no external version dependencies)
