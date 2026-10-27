# e-Vet Field (Salin)

**e-Vet Field** is the offline-first phone app the City Veterinary Office of San Jose del Monte, Bulacan gives its Paravets. Its code name is **Salin**: *mula dokumento, tungo sa datos* (from documents to data).

It turns paper census sheets, forms, PDFs and spreadsheets into reviewed, structured data on the phone, and runs the barangay's program requests, stubs and program-day attendance. It sends only values to the office's **e-Vet Admin** system (`city-vet-admin`). It works without signal, and its OCR and AI run on the device.

## Features

- **Scan and import:**
  - Camera capture and PDF, Excel and CSV import.
  - Printed-text OCR (Tesseract, English and Filipino).
  - On-device handwriting reading (PP-OCRv5).
  - Optical mark recognition for the CVO census sheet.
- **Review first:** every value is a suggestion with its source; nothing is saved until the user checks it.
- **Datasets:** filter, sort, clean, find duplicates, and export to XLSX, CSV or JSON, with preview and undo.
- **Census:** print the CVO working sheet, scan it, review records, fill the official summary workbook, and send Validated records to the office.
- **Programs:** the barangay's shared program request, stub sheets and encoding, and program day (QR scans and walk-ins, offline).
- **AI Studio:** ask questions about a dataset in English, Filipino or Taglish. A rule-based reader answers first; an on-device language model (Qwen3) handles the rest. No cloud AI.

## Quick start

```bash
npm install
npm run dev          # Vite dev server
npm run build        # type check + production build
npm run preview      # production build on :4173 (needed for PWA/offline and camera tests)
npm run verify       # lint + unit tests + build + end-to-end tests
```

Create `.env.local` with `VITE_CITY_VET_API_URL` (the e-Vet Admin site) to sign in. The camera needs HTTPS or localhost.

## Documentation

| Document | What |
|---|---|
| [`docs/E-VET_SYSTEM_GUIDE.md`](docs/E-VET_SYSTEM_GUIDE.md) | How to use e-Vet Field and e-Vet Admin |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the two apps are built and how they connect |
| [`docs/TECHNOLOGIES.md`](docs/TECHNOLOGIES.md) | Technologies and AI models: their purpose and why they fit |
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | What the system can't do, or does only under conditions |
| [`docs/ADMIN_INTEGRATION.md`](docs/ADMIN_INTEGRATION.md) | The e-Vet Admin API, sending a census, migrations |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Colours, type and components shared by both apps |
| [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) | Phases, status and what's left |
| [`docs/PHASE4_OCR.md`](docs/PHASE4_OCR.md), [`docs/OCR_BENCHMARKS.md`](docs/OCR_BENCHMARKS.md) | Scanning and OCR |
| [`docs/PHASE5_AI.md`](docs/PHASE5_AI.md), [`docs/PHASE5_ACCURACY_IMPROVEMENT.md`](docs/PHASE5_ACCURACY_IMPROVEMENT.md) | On-device AI: models, benchmarks, decisions |
| [`docs/CENSUS_FORM.md`](docs/CENSUS_FORM.md), [`docs/CENSUS_HANDWRITING_API.md`](docs/CENSUS_HANDWRITING_API.md) | The census sheet; the planned handwriting server |
| [`docs/AGENTS.md`](docs/AGENTS.md), [`CLAUDE.md`](CLAUDE.md) | Rules for contributors and coding agents |

## Stack

React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui, Dexie (IndexedDB), Workbox (PWA), Tesseract.js, ONNX Runtime Web, Transformers.js, WebLLM, pdf.js, SheetJS, zod. Tests use Vitest and Playwright.
