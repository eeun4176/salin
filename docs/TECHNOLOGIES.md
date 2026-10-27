# e-Vet Technologies

The technologies and AI models e-Vet uses: what each one does in the system, and why it fits the City Veterinary Office's situation. The office works with paper forms, house-to-house visits with weak signal, owners' personal data, and a small budget.

How they fit together is in [`ARCHITECTURE.md`](ARCHITECTURE.md). The benchmarks behind the model choices are in [`PHASE5_AI.md`](PHASE5_AI.md) and [`OCR_BENCHMARKS.md`](OCR_BENCHMARKS.md).

---

## 1. Technology trends e-Vet applies

| Trend | In e-Vet |
|---|---|
| **Offline-first / local-first apps** | e-Vet Field saves everything on the phone first and syncs later through an outbox |
| **Progressive web apps (PWA)** | One web app that installs like a phone app, with no app store |
| **On-device AI (edge AI)** | Handwriting reading and the AI assistant run on the phone or laptop, not in the cloud |
| **Small language models** | Qwen3-0.6B and 1.7B, quantised to 4-bit, answer questions about the data |
| **Intelligent document processing** | OCR, handwriting recognition and optical mark recognition turn paper into data |
| **WebGPU** | The browser uses the device's graphics chip to run AI quickly |
| **Serverless cloud** | The API runs as a Vercel function, with no server to maintain |
| **Privacy by design** | Documents never leave the phone; only values are sent (RA 10173) |

---

## 2. e-Vet Field (the phone app)

### 2.1 App platform

| Technology | Purpose in e-Vet | Why it fits |
|---|---|---|
| **Progressive Web App** (vite-plugin-pwa, Workbox service worker) | Installs from the browser and opens without internet | Paravets use their own Android phones of many brands. A PWA needs no app store, updates by itself, and runs on any modern browser. |
| **React 19 + TypeScript** | The screens and app logic | A widely known, well-supported stack. TypeScript catches mistakes before they reach users. |
| **Vite 8** | Builds and serves the app | Fast builds, and it splits off heavy parts (OCR, AI) so the app opens quickly on low-end phones |
| **Tailwind CSS v4 + shadcn/ui (Radix UI)** | Design system and accessible components | Accessible menus, dialogs and focus handling; one colour system shared with e-Vet Admin |
| **zustand** | Screen state | Small and simple |
| **React Router** | Navigation | Standard routing; deep links such as `/programs?tab=attendance` |

### 2.2 Offline storage and sync

| Technology | Purpose | Why it fits |
|---|---|---|
| **IndexedDB through Dexie** | Stores files, scans, datasets, census records, day packs and the outbox on the phone | The browser's built-in database: large, persistent and offline. Dexie adds versioned schemas so updates never lose data. |
| **Cache Storage** | Keeps the app and the AI models offline | Opens in airplane mode; models are downloaded once |
| **Outbox pattern** (`src/core/sync/outbox.ts`) | Queues changes for the office and sends them in order when online | Work in the barangay never waits for signal, and a request id stops a resend from being counted twice |
| **Web Crypto (AES-GCM, PBKDF2)** | Seals the sign-in session on the phone | Offline sign-in without keeping the password; the session is unreadable without it |

### 2.3 Documents and files

| Technology | Purpose | Why it fits |
|---|---|---|
| **pdf.js** | Reads PDFs and their text | Mozilla's PDF engine; runs in the browser |
| **SheetJS (xlsx)** | Reads and writes Excel | The office already works in Excel |
| **PapaParse** | Reads CSV | Fast, handles messy CSV |
| **fflate** | Zips backups | Small, fast; backup and restore of the phone's data |
| **qrcode / jsQR** | Prints stub QR codes; scans them with the camera | Works offline, and each QR holds only a random code: no personal data |
| **zod** | Checks every server reply and every AI reply | Bad data is refused before it reaches the screen or a dataset |

### 2.4 Document recognition (OCR, handwriting, OMR)

| Technology | Purpose | Why it fits |
|---|---|---|
| **Image preparation** (own code, OffscreenCanvas in a worker) | Finds the page, straightens and cleans it | Phone photos are tilted and unevenly lit; cleaning first raises accuracy |
| **Tesseract.js 7** (English + Filipino) | Reads printed text | Proven open-source OCR that runs in the browser; knows Filipino words used on CVO forms |
| **PP-OCRv5 mobile recognizer** (PaddleOCR, run with **ONNX Runtime Web**) | Reads handwriting, one box or line at a time | See §4. Small (7.8 MB), accurate on real CVO forms, and it can't invent words |
| **Optical mark recognition** (own code: `src/core/census/omr/`) | Reads the census sheet's corner markers, code strip, tick boxes and bubbles | Tick boxes read near-perfectly with no AI model; the code strip carries barangay, date and sheet number |
| **Templates** (`src/core/ocr/templates/`) | Tell the app where fields are on known forms | General-purpose: new forms are added as templates, not new code |
| **Web Workers** | Run OCR, handwriting, QR and AI off the main screen | The phone stays responsive during heavy work |

### 2.5 On-device AI

| Technology | Purpose | Why it fits |
|---|---|---|
| **Rule-based question reader** (`question-linking.ts`, `question-parser.ts`, `data-query.ts`) | Answers most questions about a dataset instantly, with no model | 46 of 47 held-out questions right, on every device, in English, Filipino and Taglish |
| **Transformers.js 4** | Runs Qwen3-0.6B (phones and other devices) | Runs ONNX models on WebGPU or the CPU inside the browser |
| **WebLLM** (`@mlc-ai/web-llm` 0.2.85) | Runs Qwen3-1.7B on laptops and desktops with WebGPU | Several times faster than ONNX on integrated graphics: about 25 s per answer instead of minutes |
| **ONNX Runtime Web** | Engine under the handwriting model and Transformers.js | One 27 MB engine serves both models |
| **WebGPU** | Uses the graphics chip for AI | Makes a small language model usable on a phone or laptop |

---

## 3. e-Vet Admin (dashboard and API)

| Technology | Purpose | Why it fits |
|---|---|---|
| **React 18 + TypeScript + Vite** | The staff dashboard | Same skills and design tokens as e-Vet Field |
| **Vercel serverless function** (Node 24, region Singapore) | The REST API (`/api/v1`) | No server to maintain; scales by itself; close to the Philippines; free or low cost at the office's size |
| **Supabase PostgreSQL** | The central database: accounts, registry, census, programs, stubs, attendance, audit log | A full relational database with constraints and transactions; managed backups on the paid plan; standard SQL that can move to another host |
| **Supabase Storage** (private bucket) | Uploaded files | Private by default; accessed only through the API |
| **jose (JWT) + bcrypt (pgcrypto)** | Sessions and passwords | Signed sessions (cookie for staff, Bearer token for e-Vet Field); passwords stored only as hashes |
| **zod** | Validates every request | The API refuses malformed or out-of-range input with a clear message |
| **nodemailer + Gmail** | Sends password-reset and email-confirmation codes | Uses the office's existing Gmail; no paid email service |
| **ExcelJS** | Excel exports and the Spay and Neuter monthly workbook | The office's reports are Excel |
| **Charts** (own components: `ColumnChart`, `ComparisonBars`) | KPI and analytics charts | Light, accessible (each column shows its number), no chart library to load |

---

## 4. The AI models

All models are open-source (Apache-2.0), **pinned to an exact revision and file size**, downloaded once from Hugging Face, and then used offline. Nothing is sent to an AI service.

| Model | Used for | Download | Runs on | Why this model |
|---|---|---|---|---|
| **PaddleOCR PP-OCRv5 mobile (English recognizer)** | Reading handwriting in form fields and census sheets | 7.8 MB model + 27 MB engine (about 35 MB) | Any phone (CPU, WebAssembly) | Lowest error of the candidates: 15.4% character error on IAM handwriting and 18% on a real CVO form photo, against 47% for Tesseract. TrOCR was rejected because it confidently *invented* text on real forms. PP-OCRv5 can't invent words and gives a confidence per character, so unsure readings (under 75%) are flagged for typing. |
| **Qwen3-0.6B** (ONNX, 4-bit) | AI Studio questions the rule reader can't place; turning requests into dataset commands; OCR fix and label-matching suggestions | 570 MB (GPU build) / 919 MB (CPU build) | Phones and other devices; best with WebGPU | Best held-out score of the small models (14 of 20 unseen requests and questions right). Understands English and Filipino. Small enough for phone memory. |
| **Qwen3-1.7B** (MLC, 4-bit, run with WebLLM) | The same jobs, more accurately | About 1 GB | Laptops and desktops with WebGPU and 8 GB of memory | 87.5% of held-out questions right; about 25 s per answer on integrated graphics |
| *Rejected:* TrOCR small/base, Qwen2.5-0.5B, Granite-4.0-350M, LFM2.5-350M, Qwen3.5-0.8B/2B | — | — | — | They invented text or fields, scored lower on unseen wordings, or were too slow or too large for the browser (see `PHASE5_AI.md`) |

**How the AI stays safe:**
- **It never answers from memory or runs code.** It chooses from a fixed list of actions (count, filter, sort, summarise, find duplicates…), and the app runs the action on every row.
- **Everything it suggests is checked and shown first.** Replies are validated by zod and against the request, every answer starts with *"I read this as: …"*, and changes open a preview with Undo.
- **Nothing depends on it.** Every feature works without a model, and AI Studio's rule reader answers most questions with none.

**AI modes** (Settings → On-device AI; **Auto** picks one for the device):

| Mode | Downloads | Gives |
|---|---|---|
| Off | Nothing | Scanning, OCR, templates, OMR and the question reader still work |
| Handwriting | About 35 MB | Adds handwriting reading |
| Handwriting and assistant | About 600 MB (1 GB on laptops) | Adds the AI assistant |

---

## 5. Testing and quality tools

| Tool | Purpose |
|---|---|
| **Vitest** (+ fake-indexeddb) | Unit tests for all logic in `src/core/` (e-Vet Field) and the API (e-Vet Admin) |
| **Playwright** | End-to-end tests on a production build: offline mode, scanning, programs, sign-in; asserts that nothing is uploaded |
| **PGlite** | A disposable local PostgreSQL, so e-Vet Admin's tests never touch the live database |
| **ESLint, TypeScript** | Code checks before every build |
| **Opt-in benchmarks** | `llm-eval`, the rules evaluation and the in-app *AI benchmark* measure model accuracy and speed |
