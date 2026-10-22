# CLAUDE.md — Salin AI

**Salin AI** — *Mula dokumento, tungo sa datos.* (From documents to data.)
A mobile-first, local-first PWA for City Vet paravets that turns paper forms, PDFs and spreadsheets into reviewed, structured, exportable data.
Workflow: **capture/import → parse/extract → structure → review → save → organize → search → export** (XLSX / CSV / JSON).

Full product spec: `d:\MyProgrammingDictionary\SALIN Project Documentation\SALIN AI.md` (outside the repo). Phase specs live in `d:\MyProgrammingDictionary\`.

## Product rules (never break these)

- **Local-first, no uploads.** Documents, drafts and datasets stay on the device (IndexedDB). No backend, no analytics with document text, no cloud AI. Sign-in is checked on the device (`src/core/auth/local-auth.ts`, one temporary account) until the City Vet admin system exists; sending datasets to it is a later step — build only its UI, never a real upload.
- **AI proposes, validation checks, the user approves.** AI output is a suggestion with a source (`rule` / `handwriting` / `ai`), never written silently into a dataset. Values not found on the page are flagged "Not found on page".
- **AI never runs code.** Natural-language requests become a zod-validated command from a fixed list (`src/core/processing/dataset-commands.ts`): filter, sort, rename_column, change_type, summarize, normalize, set_value, find_duplicates, delete_rows, keep_columns. TypeScript executes them, after a preview, with Undo.
- **Progressive enhancement.** Workspace, imports, exports and rule-based extraction must work with no model downloaded and on devices without WebGPU. Show "unsupported on this device" instead of failing.
- **Safe transformations.** Preview before destructive changes; keep the original and source links (traceability from dataset back to file).
- **General-purpose.** Use templates (`src/core/ocr/templates/`), not hard-coded veterinary fields. The CVO forms are just built-in templates.
- **Untrusted input.** Validate imported file types and sizes; prevent spreadsheet formula injection on export.
- Don't use color alone for confidence or validation state; keep visible keyboard focus and phone-width layouts usable (16px gutter, no horizontal scroll).

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build
npm run preview      # serve the production build (needed to test PWA/offline)
npm run lint         # eslint
npm test             # vitest run (unit)
npm run test:e2e     # Playwright on the installed Chrome (PW_CHROMIUM=1 for bundled Chromium)
npm run verify       # lint + test + build + e2e
npx tsc -b           # type check only
```

- Playwright builds and serves on **port 4173** and reuses an existing server. A stale `vite preview` on 4173 makes e2e test old code; kill it first.
- Opt-in, slow tests:
  - `SALIN_LLM_EVAL=1 npx vitest run src/core/ai/llm-eval.test.ts` runs the assistant benchmark. Results go to `docs/benchmarks/`. The model cache is at `SALIN_HF_CACHE`, default `node_modules/.cache/hf`.
  - `SALIN_E2E_ASSISTANT=1 npx playwright test e2e/ai.spec.ts` runs the real assistant in the browser and downloads about 500 MB once. Model files are served from `e2e/.models`, which is gitignored.
- Test service worker, offline and camera behaviour on a production build, not just the dev server. Camera needs HTTPS or localhost.

## Stack

React 19 + TypeScript (~6), Vite 8, Tailwind v4 + shadcn/ui (radix-ui), lucide-react, react-router, zustand, Dexie (IndexedDB), zod, pdfjs-dist, SheetJS `xlsx`, papaparse, fflate, vite-plugin-pwa/Workbox, tesseract.js (printed OCR), onnxruntime-web + @huggingface/transformers (handwriting + assistant), Vitest (+ fake-indexeddb), Playwright.

Design tokens: primary `#01A85A`, text `#1D1F1E`, canvas `#F8FAF9`, border `#E6EBE8`, surface `#FFFFFF`, font Inter, Lucide outline icons; minimal, breathable, subtle borders. Dark theme: base `#121212`, cards `#1E1E1E`, bars (`salin-bar`) `#272727`, menus `#2E2E2E`, dialogs (`salin-dialog`) `#383838`, same green.

## Layout

```text
src/
  app/            router.tsx, pwa.ts
  components/     layout/ (AppShell, AppHeader, MobileNav), ui/ (shadcn), common/ (ChoiceMenu, ConfirmDialog, StepFooter…), brand/
  core/           framework-free logic, unit-tested
    storage/      database.ts (Dexie, schema v5 — add a new db.version() for any schema change), repositories/, backup.ts
    processing/   parsers/, excel/, dataset-*.ts (inference, validation, transform, export, commands), value-normalizers, column-naming
    ocr/          imaging/, layout/, engine/ (Tesseract), models/ (capabilities, model-assets, model-manager), templates/, review/, benchmark/
    ai/           ai-models (pinned catalog), ai.worker, ai-runtime, handwriting, llm-tasks, grounding, suggestions
    auth/         local-auth (on-device sign-in, session in the settings table)
    census/       census-layout (CVO-CENSUS v1–v3 sheet geometry), code-strip, omr/ (markers, OMR), census-extraction, census-records, summary-workbook, xlsx-patch
  features/       UI per area: auth (login), home, workspace, import, capture, ocr (scan workflow), processing (dataset review), census (records, print forms), ai (review assist), ai-studio, settings, backup
  stores/         zustand stores (workspace, ocr, ai, ui, toast…)
  types/          shared domain types
e2e/              Playwright specs
docs/             PHASE4_OCR.md, PHASE5_AI.md, OCR_BENCHMARKS.md, CENSUS_FORM.md, benchmarks/*.json
```

Navigation: from 760px (Tailwind `nav:` breakpoint, `useDesktopLayout`) a dashboard — sidebar (`components/layout/sidebar.tsx`, a floating card 12px from the edges: the morphing New Document menu in `new-document-menu.tsx`, Workspace/Recents/Favorites/Trash with counts, Census, AI Studio, Settings, storage, account; folds 264px ↔ 64px rail with the PanelLeft button or Ctrl/Cmd+B, saved in `localStorage` `salin_sidebar_collapsed`) | list pane (340px default, drag the divider for 260–480px, `@container` queries) | detail pane (`file-detail.tsx` for `?preview=`, `dataset-detail.tsx` for `?dataset=` on /datasets). Phones keep the hero, bottom nav and full-screen preview dialog. Recents/Favorites/Trash are query views over metadata, not copies. Everything but /login sits behind `RequireSession`; e2e signs in once in `e2e/auth.setup.ts`.

## On-device AI (Phase 4–5) — how it fits together

- **Printed OCR:** Tesseract.js (eng + tgl) in a worker.
- **Handwriting:** PP-OCRv5 mobile recognizer (ONNX), run with ONNX Runtime Web. Handwriting is used only on lines Tesseract can't read, and readings below 0.75 confidence are flagged "illegible".
- **Assistant:** Qwen3-0.6B through Transformers.js (q4f16 on WebGPU with f16, q4 on WASM otherwise); laptops and desktops with WebGPU and 8 GB get Qwen3-1.7B through **WebLLM** (`@mlc-ai/web-llm`, pinned exactly), which is several times faster on integrated GPUs. AI Studio questions are read first without any model by `question-linking.ts` + `question-parser.ts` (run by `data-query.ts`); only questions the reader can't fully place go to the assistant. The assistant also turns requests into commands, finds fields, suggests corrections and mappings, and names columns.
- **Models are pinned by repo and revision** in `src/core/ai/ai-models.ts`, with exact file sizes. To change a model, re-run the benchmark and update the sizes and `docs/PHASE5_AI.md`. Don't use `main` revisions.
- **Model files are cached in the `salin-ocr-models` Cache Storage.** They stream in through `model-manager.ts`, which checks their sizes. Downloads are allowed only from approved hosts: the app's own origin plus `VITE_AI_MODEL_HOST`, which defaults to `https://huggingface.co`.
- **The AI worker never touches the network.** Its `env.fetch` throws `MissingFiles`. Every file is read from the cache. Transformers.js sometimes asks for `/resolve/main/` URLs, and the worker's `customCache` remaps those to the pinned revision. WebLLM reads its files from its own caches (`webllm/model`, `webllm/config`, `webllm/wasm`), which the model manager fills (`ModelAsset.cache`); the worker checks every file is there before starting it, and imports the WebLLM engine module from Salin's cache (it's not in the app shell). Its compiled model library lives in `src/core/ai/webllm/`.
- **Memory:** only one model is held in memory at a time. OCR and the assistant unload each other, and the AI runtime shuts down after 60 s idle. Users choose Standard, Lite or Advanced mode, or Auto, which uses `recommendAiMode`.
- **Choosing models:** benchmark them first. Real CVO crops and the held-out command set decide which models ship. See `docs/PHASE5_AI.md` for the decisions, the numbers, and what still needs testing on a physical Android phone.

## Code conventions

- **Every source file starts with a title comment:** `/** Title` + one-paragraph plain-English description `*/`. Match the existing files.
- Match the surrounding code's naming, comment density and idioms. Keep long lines; the code is formatted at ~180 columns. There is no Prettier config, so pass `--print-width 180` if you run Prettier.
- Use the `@/` import alias. Reuse existing components before adding new ones; use `ChoiceMenu` for dropdowns.
- Put logic in `src/core/` and cover it with unit tests next to the file (`*.test.ts`). Keep `src/features/` components thin.
- Run heavy work (parsing, OCR, inference) in Web Workers so the UI never freezes.
- Some files use CRLF line endings; preserve them when editing.
- Before reporting work as done, run lint, tsc and the unit tests. When UI flows change, run the affected e2e specs too.

## Git

- Branch per phase (e.g. `func/phase5`); `main` is the PR base.
- **Commit only when the user asks.**
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; end PR descriptions with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Roadmap status

| Phase | Status |
|---|---|
| 1 Foundation, 2 Workspace, 3 Data processing | done |
| 4 On-device OCR (Tesseract, capture, templates, review) | committed ("Initial Phase 4") |
| 5 Intelligent tools & offline AI | implemented on `func/phase5`, not yet committed. Still pending: Android benchmarks, installed-PWA offline check, real handwritten forms |
| 6 Login, dashboard workspace, CVO census OCR/OMR sheet | on `func/phase6`, not yet committed. Pending: real printed sheets on Android phones, confirm the Summary field mapping with City Vet, the send-to-admin UI |
| Future | City Vet admin integration (real accounts, sending datasets) — build only the UI until the admin system exists |
