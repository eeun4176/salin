# Phase 4 — On-Device OCR & Document Recognition

How Salin reads photos and scanned PDFs on the device, which technologies were chosen (and which were evaluated and left out), how the code is organised, and the status of every Phase 4 task. Benchmarks and accuracy results are in [OCR_BENCHMARKS.md](OCR_BENCHMARKS.md). Phase 5 later added optional on-device AI (Transformers.js and ONNX Runtime Web, for handwriting and an assistant) on top of this engine — see [PHASE5_AI.md](PHASE5_AI.md).

## 1. Technology evaluation

The phase plan suggested a stack. Each part was checked against the real goal: a privacy-preserving, offline, mid-range-Android-friendly workflow.

| Technology | Decision | Why |
|---|---|---|
| **Tesseract.js 7** (Tesseract 5 LSTM in WebAssembly) | **Used — the OCR engine** | Mature printed-text OCR that returns lines and words with boxes and per-character confidence (needed for source highlighting and review flags). It runs on CPU/WASM everywhere, including phones without WebGPU. Downloads are small: a ~3.9 MB engine build per device plus a ~2.9 MB English model (Filipino is an optional 3.3 MB). |
| **Transformers.js** | **Evaluated, not shipped** | Browser OCR models fall into two groups. Line recognisers (TrOCR) need a separate text detector and return no page coordinates. Detect-and-read models (Florence-2) are 230 MB+, practically need WebGPU, and risk crashing 3–4 GB phones. Neither meets the "mid-range Android, offline" goal better than Tesseract. The engine interface (`core/ocr/engine/ocr-engine.ts`) lets one be added later as an opt-in "advanced" engine. |
| **ONNX Runtime Web** | **Evaluated, not shipped** | Only needed for an ONNX model. Transformers.js bundles its own ORT, so using both would duplicate the ~20 MB runtime and the inference path. |
| **OpenCV.js** | **Replaced with small built-in routines** | OpenCV.js is an 8–10 MB WASM download with a slow start on phones. Salin needs only a handful of operations, implemented in `core/ocr/imaging` (≈600 lines, unit-tested): grayscale, resize, shadow flattening, contrast, median denoise, adaptive black-and-white, deskew, perspective warp, page-edge, ruling-line, checkbox and speckle detection. |
| **PDF.js** | Used | Renders scanned PDF pages (~200 dpi) for OCR, offline. It was already in the app from Phase 3. |
| **Web Workers** | Used | Image preparation runs in its own worker (`imaging.worker.ts`, OffscreenCanvas) and OCR in Tesseract's worker. Where OffscreenCanvas is missing, preparation falls back to the main thread. |
| **Dexie / IndexedDB** | Used | DB v5 adds `ocrDocuments`, `ocrPages`, `templates` and `benchmarks`. |
| **Zod** | Used | Validates template definitions (built-in and saved) and the OCR parts of backups. |
| **WebGPU** | Detected and reported, not required | The shipped engine is CPU/WASM, so WASM *is* the tested fallback. WebGPU support is shown under Settings → Text recognition → This device. |

**Profiles.** *Standard* reads pages at up to 2,200 px in one pass (the default on phones). *Accurate* reads at up to 3,000 px and takes a second "sparse text" pass when the first pass is unsure. *Auto* picks one from device memory, CPU cores, WASM SIMD, and the device's own benchmark result once it has been run.

## 2. How it works

```
capture / upload ─► Prepare (worker) ─► Read (Tesseract worker) ─► Layout ─► Template mapping ─► Review ─► Datasets
   camera, camera app,   crop + perspective, rotate,   lines, words,          tables, fields,    fields/records   check against page,   Phase 3 dataset
   JPG/PNG/WebP, PDF     shadows, contrast, deskew,    boxes, confidence      checkboxes,        with source      confirm, correct,     editor + export
                         speckle removal               (blank/unreadable)     headings, issues   regions          pick, redraw table
```

- **Two screens for the user.** *Read* starts by itself once the recognition files are on the device: page edges are found on photos, every page is read, and a template that clearly fits (score ≥ 0.6) is picked. Prepare is optional, behind "Fix pages". *Check & save* starts with "What do you need?". The user names columns or taps labels found on the page, says whether each page is one record or a list, and gets only those columns (`core/ocr/templates/requested-columns.ts`). The columns are saved as an `asked-*` template, which is offered again under "Used before". If a list's headings don't match, it is filled by column position, with a warning. With the assistant set up, form values that have no printed label are looked for and offered as suggestions. "Save dataset" creates the datasets directly. Unnamed columns are named from their values where possible.
- **Originals are never changed.** Captured photos are saved to the workspace first. Each scan page stores its edits and a separate *processed* image; PDF pages store their rendering.
- **Nothing is re-done unnecessarily.** A page is only re-prepared when its edits change, and only re-read when its image or the engine settings change. The engine starts once and is reused, shared by concurrent callers, restarted after a cancel or a change of languages, and shut down after a minute idle. A scan can't be read twice at once.
- **Orientation.** EXIF orientation is applied on decode. A page whose text seems to run sideways, or that reads poorly, is also read turned (90°/270°, or 180°), and the better reading is kept.
- **Nothing is invented.** Values that aren't on the page stay empty. Totals are compared with the rows read and flagged when they differ, never "corrected". A page that doesn't match the template is labelled unsupported, not claimed as extracted.
- **Review states.** *Ready*, *Needs review*, *Unreadable* and *Missing* come from OCR confidence (per value, with unclear characters), mapping confidence (shown separately), type checks, checkbox clarity and handwriting hints. Required values must be resolved before saving.
- **Traceability.** Each dataset row keeps its file, PDF page, scan page, and the page region of the record and of every value. It also keeps what OCR originally read wherever the reviewer changed it ("Corrected — OCR read …" in the dataset editor). "View source" shows the scanned page with the region highlighted, without re-running OCR.

### Code map

| Path | What |
|---|---|
| `src/types/ocr.ts` | Scan, page, recognition, layout and extraction types |
| `src/core/ocr/imaging/` | Pixel routines, page analysis, pipeline, worker + client |
| `src/core/ocr/models/` | Capabilities & profiles, model assets, model manager (Cache Storage) |
| `src/core/ocr/engine/` | Engine interface, Tesseract engine, runtime (start-once, queue, idle shutdown) |
| `src/core/ocr/layout/` | Layout analysis (ruled/aligned tables, fields, checkboxes, headings, columns) |
| `src/core/ocr/templates/` | Template schema (zod), built-in vet templates, label matching, field mapping, requested columns |
| `src/core/ocr/review/` | Review states and edits; conversion to Phase 3 datasets |
| `src/core/ocr/benchmark/` | CER / WER / field accuracy |
| `src/core/storage/repositories/ocr.repository.ts` | Scans, pages, templates, benchmarks; saving datasets |
| `src/features/ocr/` | Read text workflow (`/scans/:id`), runner, page sources, benchmark |
| `src/features/settings/ocr-settings-card.tsx` | Settings → Text recognition |

### Tesseract.js workaround

Tesseract.js 7 has a bug: when languages are passed as data (needed to load them from Salin's own cache), its worker initialises with each language's *bytes* instead of its *code*, and start-up then hangs. Salin prepends a few lines to the worker script that swap in the codes. The script text is loaded from the app's precache, so this works offline (see `tesseract-engine.ts`). Start-up also has an error handler and a timeout, so a broken model can never hang the app. Remove the workaround when upstream fixes `worker-script/index.js` (`l.data` → `l.code`).

## 3. Offline & privacy

- All OCR files are served from Salin's own origin, not a CDN. They are downloaded on demand, only the engine build this device can run plus the chosen languages, into the `salin-ocr-models` Cache Storage. They are verified by size, then loaded from there (as blob URLs), so OCR works offline even without the service worker.
- The small worker scripts are precached with the app shell. The ~4 MB engine builds are excluded from the precache (`globIgnores`), so visitors who never use OCR don't download them.
- "Ready — works offline" is only shown once every required file is stored and verified. When the files are missing and the device is offline, the app says how to recover: connect once and download, and meanwhile type values by hand.
- The e2e suite asserts that a full capture → read → review → save → export run makes **no request outside Salin's origin**.
- Backups include scans, page edits, recognition results, reviews and saved templates. Processed images (rebuilt from the originals, identically) and the model files (downloaded again) are left out. Settings → Privacy → Delete all data also removes scans, templates and benchmarks.

## 4. Phase 4 checklist status

✅ done and tested · 🟡 done with limits (noted) · 📱 needs a run on the real target phone (tooling provided)

**4.1 Capture & upload.** ✅ Browser camera with Retake / Use photo / Cancel, plus the phone's camera app (`capture="environment"`) when the camera is blocked or missing. ✅ JPG/JPEG/PNG/WebP and scanned PDFs (one page per PDF page). ✅ Multiple pages per scan (up to 30); add, reorder and remove them. ✅ Denied permission, unsupported formats and files over 50 MB are explained. ✅ Originals are kept unchanged.

**4.2 Editing & preprocessing.**
- ✅ Crop with corner handles (mouse, touch, keyboard), rotate, zoom and reset.
- 🟡 Automatic page edges: works for a page on a contrasting background; otherwise the user drags the corners.
- ✅ Perspective correction and deskew.
- ✅ EXIF orientation, plus visual checks for sideways and upside-down pages.
- ✅ Shadows, contrast, noise (also automatic for grainy pages), and black-and-white.
- ✅ Resolution sized per profile.
- ✅ "Preview for reading" shows exactly what will be read.
- ✅ Processed images are stored apart from the originals.

**4.3 Device compatibility & models.**
- ✅ Detects WASM, SIMD, relaxed SIMD, threads, WebGPU, workers, OffscreenCanvas, memory, cores, camera and storage.
- ✅ Standard and Accurate profiles, with Auto selection that uses the device benchmark.
- ✅ Evaluation of Transformers.js and ONNX Runtime Web (section 1).
- 📱 Android benchmark: the in-app benchmark exists; desktop results are recorded, and the phone run is still to do.
- ✅ Measures model size, download time, start-up, per-page time, JS heap and accuracy.
- ✅ Downloads only the required files and languages, caches them for offline use, and verifies them.
- ✅ Shows download size, progress, ready state and failures.
- ✅ Storage management with safe removal (refused while a page is being read).
- ✅ WASM/CPU is the default (it is also the fallback).
- ✅ Manual transcription ("Type values myself") when OCR is unsupported or not wanted.

**4.4 OCR engine.**
- ✅ Engine interface, runtime and runner.
- ✅ Preparation and OCR both run in workers.
- ✅ Reads images and scanned PDF pages.
- ✅ Page-by-page reading; cancel stops at once.
- ✅ States shown for start-up, reading, done, retry (failed pages only) and errors.
- ✅ Words and lines come with boxes and confidence.
- ✅ Blank, unreadable and partially failed pages are handled per page.
- ✅ No duplicate reading and no repeated model start-up.
- ✅ On-device only.

**4.5 Layout & tables.**
- ✅ Headings, text blocks, "Label: value" pairs, fill-in lines, and two-column reading order.
- ✅ Ruled tables (merged cells, several records per band) and aligned tables (wrapped rows joined).
- ✅ Decorative frames and empty grids are skipped and reported.
- ✅ Checkboxes are classified as checked, unchecked or unclear.
- ✅ Overlapping marks and low-confidence regions are flagged.
- ✅ Manual corrections: edit, pick from page, add or remove rows, and redraw a table's area.
- ✅ Nothing is generated.

**4.6 Templates.**
- ✅ Zod-validated template schema with field types, required fields, choices, regions, table sections and summary/count fields.
- ✅ Generic mode and manual template selection.
- ✅ Mapping by fuzzy label, saved region, checkbox and column heading, including continuation pages.
- ✅ Repeated records and totals.
- ✅ Empty or partly filled forms.
- ✅ Registration form and census sheet templates.
- 🟡 Consent form template, marked experimental (signatures aren't read).
- ✅ "Save as a template" stores learned regions.
- ✅ Results go into the Phase 3 editor.

**4.7 Confidence & source review.**
- ✅ The page sits beside the values, and the selected value's region is highlighted.
- ✅ OCR confidence and mapping confidence are shown separately.
- ✅ Flags cover unclear characters, missing required values, ambiguous mappings, unclear checkboxes, type problems and count mismatches.
- ✅ The four review states.
- ✅ Required values must be resolved before saving.
- ✅ Corrections are traceable.

**4.8 Handwriting & difficult documents.**
- 🟡 Handwriting is labelled experimental. Low-confidence values are marked "possibly handwritten", with a close-up of the region to transcribe from.
- ✅ Manual transcription.
- ✅ Blur, shadow, skew, faint print, noise and stamps were evaluated (see benchmarks).
- 📱 Handwriting feasibility on Android: only a script-font proxy was measured on desktop, so real handwriting on the target phone is still to be tested.
- ✅ Unsupported layouts are labelled as such.

**4.9 Datasets & persistence.**
- ✅ Converts into the Phase 3 dataset structure (typing, validation, editing).
- ✅ Saved in IndexedDB with source references and the template id.
- ✅ Reopening and correcting saved data doesn't re-run OCR.
- ✅ CSV/XLSX/JSON export.
- ✅ OCR data in backup/restore.
- ✅ Quota errors are reported, and persistent storage is requested.
- ✅ A failure never touches originals or other datasets.

**4.10 Offline PWA & privacy.**
- ✅ Tested on the production build with the service worker (`vite preview`).
- ✅ OCR files cached; readiness confirmed only when they're present.
- ✅ Airplane-mode e2e: read and review work offline.
- ✅ Scanned PDFs render offline.
- ✅ Missing-file recovery instructions.
- ✅ No third-party requests (asserted in e2e).
- 📱 Reopening the *installed* PWA offline on Android is still to be checked by hand.

**4.11 Testing.**
- ✅ Unit tests: preprocessing, layout, mapping, templates, review, datasets, backup, runtime, model manager and accuracy.
- ✅ E2E: capture/upload → OCR → review → save → export; census; offline; damaged and blank files; camera fallbacks; phone layout; quality under difficult conditions.
- ✅ Phase 2/3 regression suites still pass.
- 📱 Android benchmark run.

## 5. Known limits

- The handwriting accuracy figure (in OCR_BENCHMARKS.md) was measured on a script font, not real handwriting, so it isn't a validated rate. Real handwriting usually needs manual transcription, which the review screen supports.
- Automatic page-edge detection needs the page to stand out from its background.
- Checkbox detection expects square boxes about 0.6–3.5% of the page size.
- Tables with neither lines nor clear column gaps may need "Redraw table area".
- The Auto profile only uses the benchmark after it has been run on that device.
