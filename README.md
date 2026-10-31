# e-Vet Field

**The offline field app of the City Veterinary Office, City of San Jose del Monte, Bulacan.**

e-Vet Field is an installable phone app (PWA) for Paravets and City Vet staff. It turns paper census sheets, forms, PDFs and spreadsheets into reviewed, structured data on the phone, and runs the barangay's program requests, stubs and program-day attendance. It works without signal, reads documents on the device, and sends only values to the office's dashboard, **[e-Vet Admin](https://github.com/eeun4176/e-Vet-Admin)**.

Code name **Salin**: *mula dokumento, tungo sa datos* (from documents to data).

| | |
|---|---|
| **Live app** | https://field-evetsjdm.vercel.app |
| **Who signs in** | Paravets (their own barangay) and City Vet Admins. Accounts are created in e-Vet Admin. |
| **Works offline** | Yes, after the first sign-in. Changes for the office wait in an outbox until the phone is online. |
| **Sends to the office** | Values only: program requests, stub and program-day updates, census records. Never documents or photos. |

## Features

- **Scan and import:** camera capture with page detection; PDF, Excel and CSV import; printed-text OCR (Tesseract, English and Filipino); on-device handwriting reading (PP-OCRv5); optical mark reading for the CVO census sheet.
- **Review first:** every value is a suggestion with its source (rule, handwriting or AI). Nothing is saved until the user checks it, and values not on the page are flagged "Not found on page".
- **Datasets:** filter, sort, clean, rename, find duplicates, and export to XLSX, CSV or JSON, with a preview before each change and Undo after it.
- **Census:** print the CVO working sheet, scan it, review records, fill the official summary workbook, and send Validated records to the office.
- **Programs:** the barangay's shared program request, stub sheets and encoding, and program day: QR scans, walk-ins, present and absent, all offline.
- **AI Studio:** ask about a dataset in English, Filipino or Taglish. A rule-based reader answers first; an on-device model (Qwen3) handles the rest. There is no cloud AI.
- **Works on modest phones:** everything except the assistant works without a model download or WebGPU.

## How it works

```text
e-Vet Field (phone)                          e-Vet Admin (office)
 IndexedDB: documents, datasets,              web dashboard
 census, outbox, day packs                         │
        │   HTTPS + sign-in token                  ▼
        └───────────────────────────────▶  e-Kapon API /api/v1  ──▶  Supabase Postgres
```

Documents, images and datasets stay in the phone's storage (IndexedDB). OCR and AI models are downloaded once from an approved host, checked against pinned sizes, and run in Web Workers on the device.

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local   # set VITE_CITY_VET_API_URL to the e-Vet Admin site
npm run dev                  # http://localhost:5173
```

Signing in needs an e-Vet Admin account. For local work, run e-Vet Admin with `npm run dev:test` and point `VITE_CITY_VET_API_URL` at it. The camera needs HTTPS or localhost.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type check and production build |
| `npm run preview` | Serve the production build on port 4173 (use it to test offline, PWA and camera) |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run verify` | Lint, unit tests, build and end-to-end tests |

## Deployment

Hosted on Vercel as a static build. Set `VITE_CITY_VET_API_URL` (and optionally `VITE_AI_MODEL_HOST`) under **Settings → Environment Variables**, then redeploy. The e-Vet Admin server must list this site in its `ALLOWED_ORIGINS`.

## Documentation

| Document | What |
|---|---|
| [System guide](docs/E-VET_SYSTEM_GUIDE.md) | How to use e-Vet Field and e-Vet Admin: accounts, roles, every page |
| [Architecture](docs/ARCHITECTURE.md) | How the two apps are built, connected and deployed |
| [Technologies](docs/TECHNOLOGIES.md) | Technologies and AI models: their purpose and why they fit |
| [Limitations](docs/LIMITATIONS.md) | What the system can't do, or does only under conditions |
| [Admin integration](docs/ADMIN_INTEGRATION.md) | The e-Vet Admin API, census sending, migrations |
| [Design system](docs/DESIGN_SYSTEM.md) | Colours, type and components shared by both apps |
| [Development plan](docs/DEVELOPMENT_PLAN.md) | Phases, status and what's left |
| [OCR](docs/PHASE4_OCR.md) · [OCR benchmarks](docs/OCR_BENCHMARKS.md) | Scanning and OCR |
| [On-device AI](docs/PHASE5_AI.md) | Models, benchmarks and decisions |
| [Census form](docs/CENSUS_FORM.md) · [Handwriting server](docs/CENSUS_HANDWRITING_API.md) | The census sheet; the planned handwriting server |
| [Contributing notes](docs/AGENTS.md) · [CLAUDE.md](CLAUDE.md) | Rules for contributors and coding agents |

## Stack

React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui, React Router, Zustand, Dexie (IndexedDB), Workbox (PWA), Tesseract.js, ONNX Runtime Web, Transformers.js, WebLLM, pdf.js, SheetJS, Papa Parse, zod. Tests: Vitest and Playwright.

## Privacy

- Documents and photos never leave the phone; there are no analytics with document text and no cloud AI.
- AI proposes, validation checks, the user approves. The AI never runs code; it picks from a fixed list of checked dataset commands.
- Imported files are type- and size-checked, and spreadsheet exports are protected against formula injection.
- A content security policy limits network calls to this site, the e-Vet Admin API and the model host.

---

Built for the City Veterinary Office, City of San Jose del Monte, Bulacan.
