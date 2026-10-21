# Phase 5 — Intelligent Document Processing & Offline AI

How Salin adds optional on-device AI on top of the Phase 3 dataset editor and the Phase 4 OCR engine: which models were chosen and why (with the benchmarks that decided it), how suggestions stay grounded and traceable, how models are managed offline, and the status of every Phase 5 task.

**The rule throughout: AI proposes, validation checks, the user approves.** No AI output is ever written to a dataset or a scan without passing a schema check and an explicit user action. Everything still works without any AI model.

## 1. Technology decisions

| Technology | Decision | Notes |
|---|---|---|
| Tesseract.js | **Kept** | Printed text, word boxes and confidence (Phase 4). |
| ONNX Runtime Web | **Added** (1.31, shared) | Runs the handwriting model directly, and is the backend under Transformers.js. One engine binary (27 MB, WASM with WebGPU support) serves both models. It is downloaded on demand into the model cache, not precached; its 53 KB loader ships with the app. |
| Transformers.js | **Added** (4.3) | Runs the assistant language model (tokenizer, chat template, generation) on WebGPU or the CPU. It runs in the AI worker, and only loads when the assistant is used. |
| WebLLM | **Not added** | It sits behind the same `LocalAiProvider` interface (`core/ai/ai-runtime.ts`), so it can be added for WebGPU-only devices later. One runtime keeps downloads and testing small. |
| Image preprocessing | Kept | The same crop, deskew, contrast and denoise pipeline feeds handwriting crops. |
| Templates | **Extended** | They now carry Filipino and English wordings from the CVO forms, a standard-form rule per field, versions, and an editor. |
| Zod | Kept | It validates every model reply (commands, fields, corrections, mappings, names) and the new backup fields. |
| Dexie / IndexedDB | Kept | Suggestions and their decisions live on the scan's extraction. Accepted values are traced in the dataset rows. There is no schema change (still DB v5). |
| Web Workers | Kept | `ai.worker.ts` holds one model at a time, separate from the OCR and imaging workers. |

### 1.1 Handwriting model — benchmark-gated

Three candidates were run on the same samples: 60 lines from the IAM handwriting test set (real handwriting, English) and 5 values cut from a real photo of the City Vet census working sheet ("Juan Dela Cruz" ×2, "2nd week of Dec", "100", "350 mandatory"). Scores are character error rates (CER); lower is better.

| Model | Size | IAM lines | Real CVO form photo | Notes |
|---|---|---|---|---|
| Tesseract 5 (current OCR) | — | 47.0% | 46.7% | Reads print well, handwriting poorly. |
| TrOCR-small-handwritten (Transformers.js) | 68 MB | 18.3% | **138%** | **It invents text on real form crops**, e.g. "HelpLearn to editCommunity portal…" for "2nd week of Dec", with high confidence. |
| TrOCR-base-handwritten (Transformers.js) | 340 MB | 45.1% | 171% | Worse after quantization, and invents text too. |
| **PP-OCRv5 mobile English (ONNX Runtime Web)** | **7.8 MB** | **15.4%** | **18.0%** | It reads "Juan Dela Chvz", "100" and "350 mandatury". Being a CTC model, it can't invent words, and its per-character confidence separates good readings from bad ones (≥ 0.9 → no bad readings kept). |

**Chosen: PaddleOCR PP-OCRv5 mobile English recognizer** (Apache-2.0), run with ONNX Runtime Web: per value, about 25–70 ms on a desktop CPU.

TrOCR was rejected because a model that confidently invents plausible text is unsafe for records. Readings below 75% confidence are not offered at all; the value is flagged "Handwriting couldn't be read reliably — type what you see", with a close-up.

The 5 real-photo samples come from one low-resolution (2048 px) phone photo. **More real CVO forms are needed for a validated rate** (see §5).

### 1.2 Assistant language model — benchmark-gated

Each candidate got Salin's real prompts:
- 24 plain-language requests over a vet dataset (English and Filipino, including requests it must refuse).
- 12 **held-out** wordings, never used while writing the prompt.
- One requested-field extraction from a form's text, with 2 fields that aren't on the page (which must come back empty, not invented).

A reply counts as correct only if it becomes exactly the right validated command; extra, invented filter conditions count as wrong. The models ran in Node with the same weights the app downloads (`src/core/ai/llm-eval.test.ts`, raw results in `docs/benchmarks/`).

| Model (weights) | Download | Requests (dev) | Held-out | Fields copied | Fields invented |
|---|---|---|---|---|---|
| Qwen2.5-0.5B-Instruct (q8) | 512 MB | 0% | — | 2/7 | yes (reformatted / mixed) |
| Granite-4.0-350M (q4) | 576 MB | 33% | 25% | 71% | **2 invented** |
| LFM2.5-350M (q4) | 294 MB | 4% | 8% | 29% | 0 |
| **Qwen3.5-0.8B (q4)** | **570 MB (CPU) / 489 MB (GPU)** | **79% → 88%** with the request check | **33% → 42%** (5/12) with the request check | **7/7** | **0** |

**Chosen: Qwen3.5-0.8B** (Apache-2.0), the only candidate that was usable. It is still a small model, so the assistant is **experimental** (AI Advanced only). Every reply is validated against the dataset and previewed before it changes anything, and the Transform tools do everything the assistant can do.

The held-out score is the honest one. The model's main failure was adding conditions nobody asked for ("only cats please" → also "Sex is Female"). Replies are therefore also checked against the request: a filter condition is kept only if the request names its column or value, including Filipino synonyms such as "aso" → Dog, and common operator spellings ("greater_than_or_equal") are accepted. The second figures re-score the same stored replies with this check (`parseCommandReply(reply, columns, request)`). It also turned one wrong destructive answer ("remove pets older than 10" → delete by date) into a refusal.

Speed: in Node on this PC's CPU it takes about 21 s per request. In the browser without WebGPU it runs on one CPU thread, which is much slower; see §2.4.

#### Round 2 (October 2026): AI Studio questions, a laptop build and a new phone model

AI Studio now answers questions about a dataset ("how many…", "what is the email of…", "extract only the…"). The model writes a read-only query plan; Salin runs it over every row. The benchmark gained **20 questions** (12 dev, **8 held-out**), scored like commands: the plan must have the right action, only the conditions the question states (after the same request check the app applies), and, for "extract", exactly the named columns.

Fixes found with it, before comparing models:
- A filter on a text column is now kept only if its **value** is in the question. Naming the column was enough before, so "What is the email of Hector?" became `Email = <an example email>` and showed someone else's row. (Re-scoring the stored round-1 replies with the stricter check changes no result.)
- For questions, conditions the question doesn't state are dropped instead of failing the whole answer; with none left, Salin asks for a rewording. "How many…"/"ilan…" always counts. Duplicate or blank output columns are ignored.
- The question prompt now gives one example per shape on a described sample table, like the command prompt. With the 0.8B model: questions 25% → 67% (dev), 12.5% → 37.5% (held-out).

All on the new prompts, q4 weights, Node on this PC's CPU (raw results in `docs/benchmarks/`):

| Model | GPU / CPU download | Commands dev | Commands held-out | Questions dev | Questions held-out | **All held-out** | s per answer (CPU) |
|---|---|---|---|---|---|---|---|
| Qwen3.5-0.8B (round 1 choice) | 470 / 551 MB | 75% | 42% | 67% | 37.5% | 8/20 | 21 |
| **Qwen3-0.6B** | **570 / 919 MB** | 58% | **75%** | 75% | 62.5% | **14/20** | 37 |
| **Qwen3-1.7B** | **1.43 GB** / — (ONNX) | 79% | 50% | 75% | **87.5%** | **13/20** | 88 |
| Qwen3.5-2B (text parts) | 1.40 GB / — | 79% | 67% | 100% | 62.5% | 13/20 | 91 |

All four copied 7/7 form fields and invented none.

**In the browser** (Chrome, this laptop's Intel UHD integrated graphics, WebGPU, AI Studio questions on a 100-row CSV):

| Build | Runtime | Per question | Result |
|---|---|---|---|
| Qwen3-1.7B, ONNX (single 1.4 GB `.onnx`) | Transformers.js / ONNX Runtime Web | — | **doesn't load**: `std::bad_alloc` creating the session |
| Qwen3.5-2B, ONNX | Transformers.js / ONNX Runtime Web | 6–10 min | right answers, far too slow |
| Qwen3-0.6B, ONNX | Transformers.js / ONNX Runtime Web | 75–95 s | works |
| **Qwen3-1.7B q4f16_1 (MLC)** | **WebLLM 0.2.85** | **23–31 s** (7.5 s to load from cache) | right plans |

**Chosen:** **Qwen3-0.6B** (ONNX, Transformers.js) for phones and other devices (Apache-2.0) — the best held-out score of the small models, though its CPU build is larger and about 2× slower on the CPU than the 0.8B. **Qwen3-1.7B** for laptops and desktops (Apache-2.0), run with **WebLLM** (MLC's model compiled to WebGPU code): non-mobile, WebGPU with f16, and 8 GB reported memory (`variantFor`). On integrated graphics WebLLM is several times faster than ONNX Runtime Web, and its weights come in 30 small shards, so the browser's memory limit that stops the ONNX build doesn't apply.

How the WebLLM build keeps Salin's rules:
- **Pinned and size-checked.** `mlc-ai/Qwen3-1.7B-q4f16_1-MLC` at a pinned revision: `mlc-chat-config.json`, `tensor-cache.json`, `tokenizer.json` and 30 weight shards (968 MB), each with its exact size. The compiled model library (`Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm`, 5.6 MB, from `binary-mlc-llm-libs` @ `025bcaf`) is in the repo and served by Salin, so the only hosts are still Salin and the model host.
- **Downloaded by Salin, read by WebLLM.** The model manager stores each file in the cache WebLLM reads it from (`webllm/model`, `webllm/config`, `webllm/wasm`; `ModelAsset.cache`). WebLLM fetches only what's missing from those caches, so the worker first checks every file is there and stops with "missing files" otherwise — it never downloads.
- **Not in the app shell.** The WebLLM engine is one self-contained 6.6 MB module. It's served by Salin as `web-llm-*.js`, left out of the precache (like the OCR engines), downloaded with the laptop build into Salin's cache, and imported by the worker from there. Phones never download it. `@mlc-ai/web-llm` is pinned exactly, since its size is in the catalogue and its model library must match.
- **GPU resets.** Once, while the GPU code was still compiling, the integrated GPU hung and WebGPU reported the device lost. The worker then drops the engine, the user sees "stopped unexpectedly, try again", and the next question loads it afresh.

Notes:
- The Node benchmark can't run WebLLM, so the 1.7B's accuracy figures come from its ONNX q4 weights; the MLC build is a different q4 quantization of the same model.
- 20 held-out items is a small set: one or two answers apart is noise.
- The uncommitted change to `describeColumn` (up to 12 values per column) moved the 0.8B's command dev score from 79% to 75% with the same held-out score; the request check accounts for none of it.
- Both Qwen3 models still turn "send this to my boss" into a table of every row instead of refusing; commands are always previewed, and questions are read-only.
- Phone speed is not measured on a real Android phone yet; see §5.

#### Round 3 (October 2026): questions about any dataset, without a model

Round 2's questions only worked well on the datasets they were tuned on. The model had to work out which column and which cell value a question meant, from at most 12 sample values per column, and small models fail at that on unfamiliar data. So Salin now reads the question itself first:

- **Linking** (`src/core/ai/question-linking.ts`): which columns the question names (whole header, its field noun, English/Filipino synonyms, abbreviated sub-headings such as "Sex F"), which cell values it mentions (any case, no accents, plural, part of a value, small typos including swapped letters; email addresses and links only in full), and its numbers.
- **Reading** (`src/core/ai/question-parser.ts`): turns those links and the action words (how many / ilan, per / bawat, average, total, highest, top 5, latest, without / walang, not, more than, between, in 2024, last month…) into a read-only query, and lists the words it couldn't place.
- **Running** (`src/core/ai/data-query.ts`): the query runs over every row with the Transform tools' matching; nothing changes.

AI Studio answers from the reader when it understood every word: instantly, with no model and on every device. Names that aren't in the data ("Chile") are reported as missing. Only other questions go to the model; if it fails or isn't set up, the reader's partial reading is shown with the words it didn't use. Every answer shows "I read this as: …".

Results, rules only, no model (`SALIN_RULES_EVAL=1 npx vitest run src/core/ai/question-eval.test.ts`, `docs/benchmarks/rules-eval.json`): **46 / 47 held-out questions** right across six unrelated datasets (customers, orders, inventory, grades, employees, barangay households), in English, Filipino and Taglish. All 46 answers it was sure of were right; the miss ("biggest household") goes to the model. One rule was adjusted after a held-out run (sex words such as "boys"), so the figure is slightly optimistic. Real users' questions should be added to the held-out set.

**Spreadsheet forms.** The CVO census workbook showed why files weren't recognised: table detection took the form's title rows as the header. Detection now skips stacked title and fill-in lines ("BARANGAY: ____"), reads two- and three-row headers whose sub-labels repeat ("Type of Pet" → Dog / Cat), and leaves out sign-off lines ("Prepared By:", "______ Paravet"). Tick marks (✓, x, /) are yes/no, so "how many dogs", "female dogs" and "dogs that are not confined" count the ticked boxes; blank numbered form lines aren't records. Asked about in one step (AI Studio), a workbook gives its main table plus same-shaped tables; other shapes are left out with a pointer to Extract data.

Known limits: a form split by a completely unused column reads as two side-by-side tables (Salin keeps genuinely side-by-side tables apart and can't yet tell the two apart; adjust the selection in Extract data); a blank workbook with several different forms (like the census template) has no main table to pick; label/value forms (the dog registration sheet) aren't tables and need the document questions of the plan's step 6; the summary sheet's third header row (D / C under each Sex column) shares a row with the first record number.

## 2. How it works

```
 photo / PDF ─► Prepare ─► OCR (Tesseract) ─► layout ─► template mapping ─► rule suggestions ─┐
                                                                                            ▼
                    optional: handwriting reader (PP-OCRv5, per value box) ───────► Review: suggestions (Use / Edit / Dismiss),
                    optional: assistant (Qwen3) ─── OCR fixes, label mapping,         grounded or "Not found on page",
                              requested fields                                       close-up of the page region
                                                                                            ▼
                                                           Save: preview of each dataset, column names / types
                                                                                            ▼
            Dataset editor: Transform (manual) or Ask (assistant) ─► validated command ─► preview ─► apply (Undo)
```

### 2.1 Modes and device support

*Standard* uses no models. *AI Lite* adds the handwriting reader (35 MB including the engine). *AI Advanced* adds the assistant (≈600 MB; ≈1 GB on WebGPU laptops and desktops with 8 GB of memory).

*Auto* recommends a mode from the device:
- WebAssembly, workers and Cache Storage are required.
- The memory the browser reports decides how far it goes.
- WebGPU with 16-bit support gets the smaller GPU build of the assistant; on a non-mobile device that also reports 8 GB, the larger laptop build (Qwen3-1.7B, run with WebLLM).
- Once the AI benchmark has been run, the assistant's measured speed counts too: ≤ 15 s per answer allows Advanced.

Missing capabilities degrade gracefully: the AI buttons explain why they're unavailable and link to Settings.

### 2.2 Suggestions, grounding and traceability

- **Rules first.** Deterministic suggestions, made as soon as pages are mapped:
  - OCR slips in numbers and dates (O→0, l→1, S→5, B→8).
  - Standard forms: sex, species, yes/no, dates to YYYY-MM-DD, and proper-case names. Template fields name their rule, e.g. "Kasarian: M" → Male.
  - A typed value in the wrong column next to an empty one that fits ("move to Age").
  - Leading zeros (phone numbers, IDs) are never touched, and nothing is suggested for empty values.
- **Handwriting** suggestions come from the value's own box, so they are grounded in the image; each shows its confidence and a close-up.
- **Assistant** suggestions are checked against the page:
  - A correction must stay close to what was read (≥ 60% character similarity).
  - A requested field must match words read on the page, which also gives its region.
  - A label mapping takes the value printed next to a real label.
  - Anything else is marked **Not found on page**, and using it needs an extra confirmation.
- **Accepting** applies the value through the normal review edit:
  - What OCR read stays as `ocrText`, and the value records `suggestedBy`.
  - In the dataset, the row's source keeps the original value and which source suggested it. The cell tooltip reads "Suggested by the handwriting reader, approved in review — OCR read “…”".
  - Typing over a suggestion makes the value the reviewer's own.
- **Decisions are recorded.** Accepted and rejected suggestions stay on the scan (and in backups), and a rejected suggestion is never offered again.
- **The AI can't write anything.** The worker only returns text and pixel readings. All writes go through the repositories, which validate the content (`assertValidContent`). Commands are validated twice: against the dataset with `resolveCommand`, and again on save.

### 2.3 Dataset commands (Transform and Ask)

One command engine (`core/processing/dataset-commands.ts`) serves the manual Transform dialog and the assistant. It supports:
- filter (a view; nothing changes)
- sort
- rename a column
- change a column's type
- summarize / group with count, sum, average, min or max
- standardize values
- set a value where a condition holds
- find duplicates (deterministic; nothing is removed unless chosen)
- delete rows where a condition holds

Every command is zod-validated, resolved against the dataset (columns by name or close match, values converted to the column type, impossible comparisons refused) and previewed: affected rows and columns, before/after samples, and a warning for deletions and bulk edits. Changes can be undone (20 steps). Summary tables can be saved as a new dataset.

The Ask Salin AI page hands its commands to the dataset editor, so they are previewed, applied and undone there too.

### 2.4 Memory and speed on phones

- Only one AI model is loaded at a time.
- The OCR engine shuts down before the assistant loads, and the AI models are unloaded before OCR reads pages.
- The AI worker stops after a minute idle, and cancelling stops it at once.
- Inference never runs on the main thread.
- Without cross-origin isolation, ONNX Runtime uses one CPU thread. Deployments that send COOP/COEP headers would allow multi-threading.

### Code map

| Path | What |
|---|---|
| `src/core/ai/ai-models.ts` | Model catalog: pinned revisions, exact sizes, licenses, requirements, approved host, modes and recommendation |
| `src/core/ai/ai.worker.ts`, `ai-runtime.ts` | AI worker and the `LocalAiProvider` client (queue, progress, cancel, idle unload, errors) |
| `src/core/ai/handwriting.ts` | PP-OCR input preparation and CTC decoding with confidence |
| `src/core/ai/llm-tasks.ts` | Prompts and zod-validated parsing of every model reply |
| `src/core/ai/grounding.ts`, `suggestions.ts` | Grounding checks; rule / handwriting / assistant suggestions; accept and reject |
| `src/core/ai/llm-eval.test.ts` | Opt-in language-model benchmark (`SALIN_LLM_EVAL=repo:dtype`) |
| `src/core/processing/dataset-commands.ts`, `value-normalizers.ts`, `column-naming.ts` | Command engine, standard forms, column-name suggestions |
| `src/core/ocr/templates/template-suggest.ts` | "This looks like a … form" template suggestions |
| `src/core/ocr/models/model-manager.ts` | Streaming downloads, approved sources, integrity checks (shared with OCR) |
| `src/features/ai/` | AI actions for scans and datasets, line crops, review assist UI, AI benchmark |
| `src/features/processing/components/` | Transform dialog, command preview, Ask box |
| `src/features/settings/` | On-device AI card, templates card and editor |
| `src/stores/ai-store.ts` | Mode, model status, downloads |

## 3. Offline, models and privacy

- **Download and verify.** Models are optional downloads in Settings → On-device AI. The card shows size, language support, capabilities, device needs, license and source. Each file is pinned to a model revision and an exact byte size, streamed straight into Cache Storage, and kept only once complete. An interrupted download resumes from the files already finished. *Check files* re-measures every stored file and removes damaged ones. Before a download, Salin warns when it won't fit the free space or when the device reports too little memory.
- **Approved sources only.** Model files come only from the configured host: Hugging Face by default, or `VITE_AI_MODEL_HOST` to self-host the same paths. The engine binary comes from Salin's own site. Anything else is refused. The worker cannot fetch: every file is read from the cache.
- **Offline once downloaded.** After download, the AI works in airplane mode (asserted in e2e). The AI worker and the engine loader are precached with the app shell.
- **Nothing leaves the device.** The e2e suite asserts that only Salin's origin and the model host are contacted, and **that nothing is ever uploaded** (no non-GET requests).
- Everything works without downloading any model.

## 4. Phase 5 checklist status

✅ done and tested · 🟡 done with limits · 📱 needs the real Android phone (tooling provided)

**5.1 Architecture & devices.**
- ✅ `LocalAiProvider` interface, with Transformers.js and ONNX Runtime Web behind it.
- 🟡 WebLLM is left as an option (§1).
- ✅ WebGPU, 16-bit GPU, WASM, memory and worker detection.
- ✅ The Standard, AI Lite and AI Advanced modes, with Auto.
- ✅ Inference runs in workers.
- ✅ Models are loaded and unloaded between OCR, handwriting and the assistant.
- ✅ Cancellation, retry, load progress and clear errors (missing files, memory, failure).
- ✅ Graceful fallback to the manual workflows.

**5.2 Handwriting.**
- ✅ Shortlist, compatibility check and benchmark against Tesseract (§1.1).
- ✅ Recognition is region-based, at template-located fields and cells.
- ✅ Results carry their region and confidence, with a close-up to compare against.
- ✅ Illegible values are flagged for typing.
- ✅ Optional.
- 🟡 Only 5 real CVO form samples were available.
- 📱 Android speed and memory.

**5.3 Field extraction & mapping.**
- ✅ OCR words, positions, confidence and templates are the input.
- ✅ Template suggestions by label (deterministic).
- ✅ English and Filipino labels, from aliases plus the assistant's label mapping.
- ✅ Requested-field extraction on generic forms, and missing fields on template forms.
- ✅ Rules come before the LLM.
- ✅ Originals and source regions are kept.
- ✅ Mappings are validated against the template's keys.
- ✅ Ungrounded values are flagged.

**5.4 Correction & standardization.**
- ✅ OCR slip fixes.
- ✅ Standard forms for sex, species, yes/no, dates and names.
- ✅ Dates keep their meaning, with a note when day and month could be swapped.
- ✅ Leading zeros are preserved.
- ✅ The original is kept beside the suggestion, shown as before → after.
- ✅ Acceptance is required, with Use, Edit and Dismiss.
- ✅ "Not found on page".
- ✅ Missing values are never invented (tested).

**5.5 Table & dataset structuring.**
- ✅ Column names suggested from values (and by the assistant), with types inferred.
- ✅ Repeated records: ruled and aligned tables, and repeated label blocks on one page.
- ✅ Column-shift ("move") suggestions.
- ✅ Type and required-value issue counts.
- ✅ Different layouts are not merged.
- ✅ Dataset preview before saving.
- ✅ Zod checks on all AI output.
- ✅ The Phase 3 editor is used for final corrections.

**5.6 Transformations.**
- ✅ All of: the command schema; filter, sort, rename and type; group and aggregate; normalize and set-where; deterministic duplicates (the assistant can propose them, nothing is auto-deleted); preview; confirmation for destructive and bulk changes; Undo; one engine for manual and AI commands.

**5.7 Assistant.**
- ✅ Benchmark on desktop (§1.2) and model selection. 📱 Android benchmark.
- ✅ Plain language to commands (barangay and vaccination filters, summaries, cleaning).
- ✅ Requested fields.
- ✅ Validation; unsupported requests are explained.
- ✅ Preview and confirmation.
- ✅ The manual Transform alternative.

**5.8 Templates.**
- ✅ Aliases from the real CVO forms and per-field standard forms.
- ✅ Registration, census and consent templates.
- ✅ Create (from a scan, or by copying a built-in), edit, rename and delete.
- ✅ Suggestions from labels.
- ✅ Versioning: review notes when a template changed since mapping, and keys stay stable.
- ✅ Work without an LLM.
- ✅ Included in backup and restore.
- ✅ Tested on several documents of one layout.

**5.9 Review & safety.**
- ✅ All of: original beside suggestion; page regions; OCR confidence, mapping confidence and suggestion source shown separately; explicit approval; ungrounded flags; manual checks for names, IDs, dates and numbers; originals and unmodified OCR kept; decisions recorded; AI can't write to IndexedDB; hallucinations can't be saved silently.

**5.10 Offline models & PWA.**
- ✅ Optional downloads, with size, languages, capabilities and requirements shown.
- ✅ Cache and verify; delete, re-download and resume.
- ✅ Storage and memory warnings.
- ✅ Approved sources only.
- ✅ Airplane-mode e2e.
- ✅ OCR and datasets work without an LLM.
- 📱 Installed Android PWA.

**5.11 Performance, accessibility & privacy.**
- ✅ AI benchmark: load time, per-value and per-answer latency, JS heap and storage. 📱 Low-memory phones.
- ✅ Workers keep the screen responsive.
- ✅ Status messages with `aria-live`, keyboard-operable menus and dialogs, 40 px+ touch targets.
- ✅ Core flows work without AI.
- ✅ Content stays on the device (e2e).
- ✅ Failures are handled.
- ✅ Documented here.

**5.12 Testing.**
- ✅ Unit tests: command validation, mapping rules, suggestions, zod outputs, ungrounded and invented-value cases, English and Filipino labels, the runtime queue and cancel.
- ✅ E2E: upload → OCR → handwriting suggestions (offline) → review → dataset trace; rules → Transform → filter → delete → undo; the assistant (opt-in, `SALIN_E2E_ASSISTANT=1`).
- ✅ Phase 2–4 regression suites.
- 🟡 Real handwritten samples: 5 from CVO, plus IAM.
- 📱 Android airplane mode and fallback hardware.

## 5. Known limits and what to do on the phone

- **Handwriting:** the 18% CER on real CVO crops comes from one low-resolution photo. Photograph forms at full camera resolution, flat, filling the frame. To measure properly, run Settings → On-device AI → AI benchmark on the phone, and test 10–20 filled forms written by different people.
- **Assistant:** a 0.6B model is fast enough only with WebGPU, and the 1.7B laptop build (WebLLM) needs it. On the CPU it takes tens of seconds per answer, and it still misreads some requests. That's why every answer is shown as "The assistant understood your request as: …" before anything happens. Use Transform when it gets one wrong.
- **Tick-mark columns** on the census working sheet still rely on Phase 4 checkbox detection. Exact per-form templates for the CVO census sheets (column geometry) remain future work.
- **Android checks still to do:**
  - Settings → On-device AI → download both models, then run *AI benchmark* and *Copy results* into §6.
  - Repeat in airplane mode in the installed app.
  - Note any memory problems ("ran out of memory" messages).

## 6. Android results

| Date | Phone (model, RAM) | Android / Chrome | WebGPU | Handwriting (load / per value) | Assistant (load / per answer, build) | Commands correct | Offline (tab / installed) |
|---|---|---|---|---|---|---|---|
| _to do_ | | | | | | | |
