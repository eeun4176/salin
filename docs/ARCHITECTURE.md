# e-Vet Architecture

How the two e-Vet applications are built, how they connect and communicate, and how they work together.

| | **e-Vet Field** | **e-Vet Admin** |
|---|---|---|
| Repository | `salin` (code name **Salin**) | `city-vet-admin` (code name **e-Kapon**) |
| Users | Paravets in the barangays; staff on program day | City Vet office staff |
| Kind of app | Installable progressive web app (PWA), offline-first | Web dashboard and REST API |
| Runs on | The phone or laptop browser | Browser (UI) + Vercel serverless function (API) |
| Data lives in | The device: IndexedDB and Cache Storage | Supabase PostgreSQL (schema `ekapon`) and private Supabase Storage |
| Hosted on | Vercel (static files) | Vercel (static files + one API function), region `sin1` (Singapore) |

The code, storage and database names keep **Salin** and **e-Kapon**. Renaming them would lose data already saved on phones and in the database, so only the names people see changed.

---

## 1. The big picture

```
            BARANGAY (often weak or no signal)                         CITY VET OFFICE
 ┌───────────────────────────────────────────────┐        ┌──────────────────────────────────┐
 │ e-Vet Field (PWA on the Paravet's phone)      │        │ e-Vet Admin web dashboard        │
 │                                               │        │ (staff browser, signed-in cookie)│
 │  Camera / files ─► OCR, handwriting, OMR      │        └───────────────┬──────────────────┘
 │                    (Web Workers, on device)   │                        │ same-origin HTTPS
 │  Review ─► Datasets, census records           │                        ▼
 │  Programs: requests, stubs, day pack          │   HTTPS + Bearer  ┌────────────────────────┐
 │  Outbox (changes waiting to be sent) ─────────┼──────────────────►│ e-Kapon API  /api/v1   │
 │  AI Studio (on-device AI, optional)           │◄──── JSON ────────│ (Vercel, Node 24, TS)  │
 │                                               │                   └───────────┬────────────┘
 │  IndexedDB · Cache Storage · Service worker   │                               │ SQL (pooler)
 └───────────────────────────────────────────────┘                               ▼
          ▲ one-time model download                          ┌──────────────────────────────────┐
          │ (Hugging Face, pinned files)                     │ Supabase PostgreSQL  (ekapon)    │
                                                             │ Supabase Storage (private files) │
                                                             └──────────────────────────────────┘
                                                              Gmail SMTP ◄─ password reset codes
```

**The rule that shapes everything:** e-Vet Field keeps documents, photos and datasets on the phone. It sends e-Vet Admin only **values** (program request entries, stub and attendance updates, census records), and only when the user chooses to send them. e-Vet Admin is the single shared record for the office.

---

## 2. e-Vet Field (Salin)

### 2.1 Stack

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui (Radix UI), lucide-react icons, React Router |
| State | zustand stores (`src/stores/`) |
| Storage | Dexie over IndexedDB (database `SalinAI`, schema v6); Cache Storage for the app shell and AI models |
| Offline | vite-plugin-pwa / Workbox service worker; installable manifest |
| Files | pdf.js (PDF), SheetJS `xlsx` (Excel), PapaParse (CSV), fflate (zip backups) |
| Recognition | Tesseract.js (printed text, English + Filipino), PP-OCRv5 handwriting model on ONNX Runtime Web, custom OMR for the census sheet |
| AI | Transformers.js (Qwen3-0.6B) and WebLLM (Qwen3-1.7B on laptops), in a Web Worker |
| QR | `qrcode` (printing stubs), jsQR in a worker (scanning) |
| Validation | zod, for every server reply and every AI reply |
| Tests | Vitest (+ fake-indexeddb), Playwright end-to-end on a production build |

### 2.2 Code layout

```
src/
  app/          router, PWA registration
  components/   layout (sidebar, header, bottom bar), ui (shadcn), common, brand
  core/         framework-free logic, unit-tested
    storage/    Dexie database, repositories, backup and restore
    processing/ parsers, dataset inference/validation/transform/export, dataset commands
    ocr/        imaging, layout, Tesseract engine, model manager, templates, review
    ai/         model catalogue, AI worker, handwriting, prompts, grounding, question reader
    census/     census sheet layout, code strip, OMR, extraction, records, summary workbook, sending
    programs/   program requests, stubs, day pack, offline scans and walk-ins, QR worker
    auth/       sign-in through the City Vet API, sealed offline session
    admin/      the City Vet API client and the City Vet page (inbox, search, issues)
    sync/       outbox
  features/     screens per area (thin; logic stays in core/)
  stores/       zustand stores
```

### 2.3 Where data is kept on the phone

| IndexedDB table | Holds |
|---|---|
| `files`, `fileBlobs`, `folders`, `thumbnails` | The workspace: imported and scanned files, folders, card thumbnails |
| `ocrDocuments`, `ocrPages`, `templates` | Scans, their pages and extracted values, form templates |
| `datasets`, `datasetRows`, `processingJobs`, `extractedDocuments` | Reviewed tables (datasets) and how they were made |
| `benchmarks` | On-device OCR and AI speed tests |
| `settings` | Preferences, the sealed sign-in session, cached program data and day packs |
| `outbox` | Changes for the City Vet office waiting to be sent |

Cache Storage holds the app shell (precached by the service worker) and the AI model files (`salin-ocr-models`, plus WebLLM's own caches), so Salin opens and works in airplane mode.

### 2.4 Heavy work never blocks the screen

Parsing, OCR, handwriting reading, QR scanning and AI inference each run in a **Web Worker**. Only one AI model is loaded at a time: OCR and the assistant unload each other, and the AI worker shuts down after a minute of not being used.

---

## 3. e-Vet Admin (e-Kapon)

### 3.1 Stack

| Layer | Technology |
|---|---|
| UI | React 18, TypeScript, Vite, Tailwind CSS v3 (same colour tokens as e-Vet Field), lucide-react, React Router |
| API | One Vercel serverless function (`api/index.ts`) that routes every `/api/v1/*` path to its handler in `api-handlers/v1/` (dispatcher: `server/api-dispatch.ts`) |
| Validation | zod on every request body and query |
| Database | Supabase PostgreSQL through the `postgres` driver and Supabase's transaction pooler; schema `ekapon` |
| Files | Private Supabase Storage bucket (`ekapon-private`) for uploaded files |
| Auth | `jose` (signed JWT sessions), bcrypt password hashes in PostgreSQL (`pgcrypto`) |
| Email | `nodemailer` through the office Gmail account (password-reset and email-confirmation codes) |
| Reports | ExcelJS (Excel exports and the Spay and Neuter monthly workbook), browser print to PDF |
| Tests | Vitest against a disposable local PostgreSQL (PGlite) |

### 3.2 Code layout

```
api/index.ts          the single Vercel function
api-handlers/v1/      one handler per endpoint (auth, records, census, program-interest, stub-workflow, program-kpis, …)
server/               shared server logic: auth, db, http (CORS, origin checks), census, registry, stubs, KPIs, phone rules
shared/               code used by both the UI and the API (programs, navigation badges, import fields)
src/                  the React dashboard (pages, components, i18n English/Filipino)
db/                   numbered SQL migrations (000 … 032)
hosting/              ready-to-run SQL for a new Supabase project (01 fresh schema … 08 clear records)
```

### 3.3 Database

All tables live in the `ekapon` schema. The main groups:

| Group | Tables (examples) |
|---|---|
| Accounts and access | `accounts`, `policy_acceptances`, `email_codes`, feature access, `audit_log` |
| Registry | `dashboard_records` (owners, pets, services, programs, Paravet directory), `registry_owners`, `registry_pets` |
| Census | `census_submissions`, `census_owners`, `census_pets`, review history |
| Programs | `program_interest_campaigns`, `program_interest_people`, `stub_batches`, `stub_tickets`, `program_attendance`, `standalone_services` |
| Operations | `notifications`, `navigation_changes`, imports, data-quality reviews, issue reports |

The API connects as a restricted role (`ekapon_api`) that may read only the columns it needs. Every change is attributed to the signed-in account and written to `audit_log`. Schema changes are numbered SQL files in `db/`. The database owner applies them in the Supabase SQL editor after a backup.

---

## 4. How the two apps connect and communicate

### 4.1 One API, two kinds of session

| | e-Vet Admin (staff dashboard) | e-Vet Field (phone app) |
|---|---|---|
| Address | Same origin (`/api/v1`) | `VITE_CITY_VET_API_URL` + `/api/v1`, cross-origin |
| Session | Signed JWT in an `HttpOnly`, `SameSite=Strict` cookie; lasts `SESSION_HOURS` (default 8) | Signed JWT returned in the reply and sent back as `Authorization: Bearer …`; lasts `SALIN_SESSION_DAYS` (default 14) so Paravets can work offline in the field |
| Who signs in | Staff (Admin) only; Paravets are refused | Paravets, and staff for program day |
| Cross-site protection | Writes must come from the same origin | The e-Vet Field site is listed in `ALLOWED_ORIGINS`; the API sends CORS headers only to listed origins, on error replies too |

On **every** request the API verifies the token and re-reads the account from the database. Deactivating a Paravet or resetting a password therefore takes effect immediately. A password reset also sets `sessions_valid_after`, which ends sessions on other phones.

### 4.2 Signing in on the phone

1. **First sign-in (online):** an Admin creates the Paravet in e-Vet Admin and gives them the Account Key and a 15-minute temporary password. In e-Vet Field the Paravet uses them, sets their own password and accepts the Paravet terms (`/auth/first-signin`, `/auth/set-password`).
2. **Offline afterwards:** e-Vet Field keeps the session **sealed** on the device (AES-GCM, under a key derived from the password with PBKDF2-SHA-256, 600,000 rounds), so the Paravet can sign in again without signal.
3. **Renewal:** when online, e-Vet Field renews the token (`/auth/renew`) before it expires.
4. **Forgotten password:** a 6-digit code goes to the Paravet's confirmed email through Gmail (`/auth/email`, `/auth/forgot-password`). Without a confirmed email, an Admin renews the temporary password.

### 4.3 Sending changes: the outbox

Every change e-Vet Field makes for the office goes through the **outbox** (`src/core/sync/outbox.ts`):

```
 user action ─► save locally ─► outbox item {id, path, body}  ── online & signed in ──►  POST /api/v1/...
                 (works offline)       │                                                     │
                                       │◄──────────── 2xx: mark sent, refresh views ─────────┤
                                       │◄──────────── 4xx: "needs attention" + server message┘
```

- Items are sent **in order**, whenever the phone is online and signed in. Nothing is lost if the signal drops mid-way.
- Each item's id is also its **`requestId`**. If the reply is lost and the item is sent again, the server recognises the id and does not count it twice (program entries, stub redemptions, walk-ins, census submissions).
- A refusal from the server (for example, a closed program or a stub already used) marks the item **needs attention** with the server's message, for the Paravet to fix or discard.

### 4.4 What each side sends and reads

| Workflow | e-Vet Field | e-Vet Admin |
|---|---|---|
| **Program requests** | The barangay's shared request: interested owners and pets, then *Submit request* (`/program-interest`) | Review, approve, merge requests from several barangays, and schedule the program day |
| **Stubs** | Reads the stub sheets sent to the barangay (`/stub-workflow?mode=print`), prints them, encodes the owner and pets on each stub after handing it over (`issue`) | Generates numbered blank stub batches per barangay, sends them for printing, tracks stock, issues stubs from the office too |
| **Program day** | Downloads the **day pack** (`mode=day-pack`) beforehand; scans stub QR codes and records walk-ins offline (`redeem`, `walk-in`); everything goes through the outbox | Shows attendance live, present and absent stubs, voids wrong entries, and feeds the KPIs |
| **Census** | Scans the census sheets, reviews them, then *Send to City Vet*: Validated pets grouped by owner, at most 200 owners and 1,000 pets per submission (`/census/submissions`) | Pending → Approved/Rejected review; approval publishes the owners and pets to the Registry |
| **City Vet page** | Inbox, records search, data-quality flags, *Report an issue* (`/notifications`, `/search`, `/data-quality`, `/issues`) | Sends notices; receives issue reports |
| **Refresh** | Re-reads program data when online, every minute while a page is open, and on the Refresh button | Same: auto-refresh and a Refresh button |

### 4.5 Program day, step by step (the hardest offline case)

```
 Day before (online)          Program day (maybe offline)                    Later (online)
 ───────────────────          ───────────────────────────────                ──────────────
 Download day pack ─►  Scan stub QR ─► stub found in day pack? ─ yes ─► record present ─► outbox ─► /stub-workflow redeem
 (encoded stubs,        │                                     no ─► "not in this program" message
  owners, pets)         └─ walk-in ─► owner + pets form ─────────────────────► outbox ─► /stub-workflow walk-in
                       End of day: every encoded stub never scanned shows "absent"
```

A scan only counts on the program's own date. A stub already scanned on this phone is refused at once, even before the server has confirmed it.

---

## 5. Security and privacy across both apps

- **Data minimisation:** documents, scans and photos stay on the phone; only values are sent.
- **No cloud AI:** models run on the device. The AI worker cannot use the network; it reads model files only from the cache.
- **Content Security Policy** (e-Vet Field): the browser may contact only e-Vet Field itself, the City Vet API and the model host (`VITE_AI_MODEL_HOST`, default Hugging Face). `vercel.json` adds `frame-ancestors 'none'`, `nosniff` and a strict referrer policy.
- **Pinned models:** every model file is pinned to a repository revision and an exact byte size, and checked after download.
- **Server:** bcrypt password hashes; temporary passwords shown once; sign-in lockout per account and per IP; cross-site write blocking; role checks on every handler; an audit log of every change; exports leave out passwords, keys and photos; spreadsheet exports neutralise formulas.
- **Roles:** one staff role (shown as **Admin**, stored as `SuperAdmin`) and **Paravet**. A Paravet sees and changes only their own barangay's requests, stubs and census.

---

## 6. Deployment and environments

| | e-Vet Field | e-Vet Admin |
|---|---|---|
| Deploys | Vercel (static build; every path serves the app) | Vercel on every push to `main`; one function, 60 s limit, `sin1` region; daily maintenance cron |
| Build-time settings | `VITE_CITY_VET_API_URL`, `VITE_AI_MODEL_HOST` | — |
| Server settings | — | `DATABASE_URL` (Supabase pooler), `JWT_SECRET`, `CRON_SECRET`, `ALLOWED_ORIGINS` (the e-Vet Field site), `SESSION_HOURS`, `SALIN_SESSION_DAYS`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, Supabase Storage settings |
| Local development | `npm run dev` (port 5173); `npm run preview` (4173) for offline/PWA tests | `npm run dev:test`: UI 5175, API 3000, local database 5433 |
| Database changes | — | Numbered SQL in `db/`, applied by the database owner after a backup; `hosting/` for a new project |

**Connections on Vercel:** Vercel freezes idle functions, so the API reconnects to the database after 10 idle seconds and keeps up to 5 connections per instance. Database time limits (`hosting/07-query-timeouts.sql`) stop one stuck query from stalling the API.

---

## 7. Where to read more

| Topic | Document |
|---|---|
| Using both apps, accounts and roles | [`E-VET_SYSTEM_GUIDE.md`](E-VET_SYSTEM_GUIDE.md) |
| API calls, census sending, migrations, password reset, CSP | [`ADMIN_INTEGRATION.md`](ADMIN_INTEGRATION.md) |
| Scanning and OCR | [`PHASE4_OCR.md`](PHASE4_OCR.md), [`OCR_BENCHMARKS.md`](OCR_BENCHMARKS.md) |
| On-device AI: models and benchmarks | [`PHASE5_AI.md`](PHASE5_AI.md), [`PHASE5_ACCURACY_IMPROVEMENT.md`](PHASE5_ACCURACY_IMPROVEMENT.md) |
| The census sheet and OMR | [`CENSUS_FORM.md`](CENSUS_FORM.md) |
| Colours, type and components | [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) |
| Phases and what's left | [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) |
| Technologies and AI models: purpose and fit | [`TECHNOLOGIES.md`](TECHNOLOGIES.md) |
| Limitations | [`LIMITATIONS.md`](LIMITATIONS.md) |
| e-Vet Admin hosting and database | `city-vet-admin/hosting/README.md`, `city-vet-admin/README-BACKEND.md`, `city-vet-admin/docs/README.md` |
