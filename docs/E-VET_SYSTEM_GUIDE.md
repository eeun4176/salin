# e-Vet System Guide

**City Veterinary Office · City of San Jose del Monte**

e-Vet is two apps that work together:

| | **e-Vet Field** | **e-Vet Admin** |
|---|---|---|
| Who uses it | Paravets in the barangays (staff can also sign in) | City Vet office staff |
| What it is | Installable phone app (PWA) that works offline | Web dashboard |
| Main job | Capture paper forms, census sheets and spreadsheets in the field, turn them into clean data, and send values to the office | Review, approve and manage records, run programs, manage Paravets, and report |
| Data lives | On the phone (IndexedDB) until the user sends it | Central database (Supabase Postgres) |
| Code | `salin` repo | `city-vet-admin` repo (e-Kapon) |
| Hosted at | `https://field-evetsjdm.vercel.app` (Vercel) | `https://admin-evetsjdm.vercel.app` (Vercel) |

> Code, storage and database names keep the project names **Salin** (Field) and **e-Kapon** (Admin). Renaming them would lose users' saved data, so only the names people see changed.

---

## 1. How the two apps connect

```
e-Vet Field (phone)                          e-Vet Admin (office)
 IndexedDB: documents, datasets,              Web dashboard (staff, signed-in cookie)
 census, outbox, day packs                              │
        │  HTTPS + Bearer token                         ▼
        └──────────────────────────────▶  e-Kapon API /api/v1 (Vercel)
                                                        │
                                                        ▼
                                             Supabase Postgres (schema ekapon)
```

- **Documents and photos never leave the phone.** e-Vet Field sends only values: program request entries, stub and program-day updates, and census records.
- **Sending is queued.** A change is saved on the phone first (the outbox), then sent in order whenever the phone is online and signed in. A resend after a dropped connection is recognised and not counted twice.
- **One sign-in for both.** Accounts are created in e-Vet Admin. Paravets sign in only to e-Vet Field; e-Vet Admin refuses them.

Technical details: [`ADMIN_INTEGRATION.md`](ADMIN_INTEGRATION.md).

---

## 2. Accounts and roles

| Role (shown as) | Signs in to | Can do |
|---|---|---|
| **Admin** (stored as SuperAdmin) | e-Vet Admin and e-Vet Field | Everything in e-Vet Admin: Paravets, programs, census review, reports, data import/export, audit, access |
| **Paravet** | e-Vet Field only | Their own barangay: program requests, stubs, program day, census, sending records |

**New Paravet account**
1. In e-Vet Admin: **Paravets → Add Paravet**. Enter the name, mobile number and barangay.
2. e-Vet Admin shows an **Account Key** (e.g. `PV2026-TMP001-3023`) and a **temporary password**, once. The password expires in 15 minutes.
3. The Paravet opens e-Vet Field, chooses **First time? Use your temporary password**, then creates their own password and accepts the Paravet terms (English or Filipino).

**Forgotten password**
- If the Paravet confirmed an email in e-Vet Field (**Settings → Email for password reset**), they can use **Forgot password?** on the sign-in screen and get a 6-digit code by email.
- Otherwise, an Admin opens the Paravet in **Paravets → Edit** and chooses **Renew temporary password**.

---

## 3. e-Vet Field (for Paravets)

### 3.1 Signing in and working offline
- The first sign-in on a phone needs the internet. After that, the app opens, and signing in works, without signal.
- Install it from the browser menu (**Add to Home screen / Install app**) so it opens like a normal app.

### 3.2 Workspace
The home screen holds everything on the phone, organised like a file manager.
- **Workspace / Recents / Favorites / Trash**: the bottom bar on phones (sidebar on laptops).
- **Folders, search, sort and filters** (Type, Modified); list or grid view.
- The **+** button opens quick actions: **Scan**, **Import**, **AI Studio**.
- Shortcuts to **Datasets**, **Census** and **Programs** sit at the top.
- The storage badge in the header shows how much e-Vet Field stores on the phone.

### 3.3 Scan (camera) and Import (files)
- **Scan**: photograph a paper form. The app straightens and cleans the page, then reads it:
  - printed text with Tesseract (English and Filipino);
  - handwriting with an on-device handwriting model, only on lines the printed reader can't read. Readings below 75% confidence are marked **illegible** for the user to fix.
- **Import**: PDF, Excel, CSV and text files. Excel sheets and PDF tables are detected automatically.
- **Templates** (`src/core/ocr/templates/`) tell the app where fields are on known forms, such as the CVO census sheet.
- Every value found is a **suggestion with its source** (rule, handwriting or AI). Values not on the page are flagged **Not found on page**. Nothing is saved until the user reviews it.

### 3.4 Datasets
Reviewed tables become datasets that can be edited, cleaned and exported.
- Filter, sort, rename columns, change types, normalise values, find duplicates, delete rows, keep columns.
- Every change is **previewed first** and can be **undone**. The original file stays linked to the dataset.
- **Export** as Excel (XLSX), CSV or JSON. Exports are protected against spreadsheet formula injection.

### 3.5 Census
- **Print forms**: print the official CVO census working sheet (with corner markers and answer bubbles).
- **Scan sheets**: the app reads the bubbles (OMR) and handwriting, then shows each record for review. Records are **Pending**, **Validated** or **Unreadable**.
- **Summary workbook**: the official summary is filled from Validated records.
- **Send to City Vet**: sends Validated pets, grouped by owner, to e-Vet Admin for review. Only a Paravet can send, and only for their own barangay. Large censuses are sent in parts.

### 3.6 Programs (Kapon, anti-rabies, microchipping days)
Three tabs, all for the Paravet's barangay:
- **Requests**: the barangay's shared program request. Add interested owners, each with at least one pet, then submit the request to the City Vet. Other Paravets of the same barangay see the same request. Only one request runs at a time; once its program is **Completed**, the barangay can start the next.
- **Stubs**: the numbered blank stubs the office sent. They can be printed only when the barangay has requested (or already encoded) owners. After handing a stub to an owner, the Paravet encodes it on a sheet: the stub number, the owner, and one row per pet (up to three) with the services as columns. Stubs are listed as **Not encoded** and **Encoded**, and a search finds any stub by number, owner, pet or mobile.
- **Attendance** (program day): download the **day pack** before the event, then record attendance by scanning stub QR codes or adding **walk-ins**, even without signal. Every encoded stub shows as **present** once scanned and **absent** if it was never scanned by the end of the day. Everything is sent when the phone is back online.
- **Scan**: there is one scanner (**Scan**). Point it at a document to capture pages, or at a stub: its QR opens that stub's row (on program day, its attendance). Each QR holds a random code that belongs to exactly one stub number.
- **Refresh** (Programs and City Vet): loads the newest records; the page also refreshes by itself every minute while it is open and online.

### 3.7 City Vet page
Messages from the office (inbox), a search of City Vet records the Paravet may see, data-quality flags, and **Report an issue**.

### 3.8 AI Studio
Ask questions about a dataset in English, Filipino or Taglish: "ilan ang aso na hindi pa bakunado?", "who has no contact number?".
1. A **rule-based reader** answers first, instantly and without any model. It handles most everyday questions (counts, lists, filters).
2. Only questions it can't fully understand go to the **on-device AI model**: Qwen3-0.6B on phones (downloaded once), Qwen3-1.7B on capable laptops with WebGPU.
3. The model never answers from memory and never runs code. It picks an action from a fixed list (count, filter, list…), and the app runs it on every row.
4. Every answer starts with **"I read this as: …"**, with citation chips back to the rows. Changes to data open a preview first and can be undone.

**Being online does not make AI Studio stronger.** It never uses cloud AI: owner data stays on the device, and the internet is used only to download the model once. On devices without enough memory or WebGPU, AI features say **unsupported on this device**. Scanning, importing and exporting still work.

### 3.9 Settings and backup
Theme (light/dark), AI mode (Auto, Off, Handwriting, Handwriting and assistant), model downloads, email for password reset, storage use, and **Backup / Restore** of the phone's data to a file.

---

## 4. e-Vet Admin (for City Vet staff)

Sign in at the e-Vet Admin site with a username (or account key) and password. Large screens show a sidebar; phones use a menu.

### 4.1 Dashboard
Today's work at a glance: **Needs your attention** (pending reviews, requests, stubs, issues), **current and upcoming programs** with a link to the full calendar, **Quick access** shortcuts, and **Recent updates**.

### 4.2 Registry
- **Owners** and **Pets**: the official registry, with search, filters, history and edits.
- **Participants**: program participants.

### 4.3 Census
- **Submit / Import / My submissions**: staff can enter or import a census too.
- **Review: Pending, Approved, Rejected**: check each submission sent from e-Vet Field. Approving it publishes its owners and pets to the Registry; rejecting it needs a reason.
- **Census summary** and **Census front page**: the official summary reports.

### 4.4 Field operations
- **Programs**: every program, grouped as Current, Upcoming and Recent. Open a program for its tabs:
  - **Overview**: schedule, actual start and finish, assigned Paravets, stub stock, history;
  - **Interest**: the owners who signed up;
  - **Stubs**: generate, review, print and hand over stub batches;
  - **Attendance**: encode paper attendance.
- **Program day**: run the day itself (record start and finish, attendance).
- **Program interest**: barangay requests from e-Vet Field. Review, approve, merge, and turn them into scheduled programs.
- **Stubs**: stub batches across all programs.
- **Services**: service records (vaccinations, Kapon, microchips) outside programs.

### 4.5 Paravets
The list of Paravets and their sign-in accounts.
- **Details**: account key, mobile number, status, last sign-in (or "Not signed in yet").
- **Edit**: correct the name or mobile number, **renew the temporary password**, or **assign them to another barangay**. Before a move, e-Vet Admin says who stays in each barangay; the Paravets of both barangays are notified; the moved Paravet then sees only the new barangay's request, stubs and census. Past submissions stay under the barangay where they were made.
- **Deactivate**: the Paravet can no longer sign in to e-Vet Field and stops counting as an active Paravet. Their records and history stay. **Show archived → Restore** turns access back on.
- **Add Paravet**: creates the account (see section 2).

### 4.6 Barangays
The 62 official barangays, by district, each with its **number of active Paravets** and their names. A Paravet counts as soon as their account exists, even before their first sign-in; deactivated Paravets don't count.

### 4.7 Insights
- **Analytics** (the first tab): KPI cards (capacity use, attendance, completion and interest-conversion rates, programs, registered and recorded pets, vaccination coverage), each with its formula behind the (i), and column charts below them. It also has program operations with a live view of today's programs, barangay performance, reconciliation checks, and Print/PDF, CSV and Excel exports.
- **Reports**
  - **Program outcomes**: owner and pet visits, completed procedures, stub vs walk-in visits, and outcomes per process for a year and barangay.
  - **Registry statistics**: totals, year-on-year comparison, monthly charts and a barangay heatmap.
  - **Find records**, **Create report** (filtered reports to print) and **Monthly workbook** (import or download the Spay and Neuter monthly workbook).
  - Every chart has **Save image**, which downloads a PNG for presentations.
- **Data quality**: possible duplicate owners and pets to review.

**How the numbers are calculated**
- **Change vs last year** = (this year − last year) ÷ last year × 100, compared over the same completed months only.
- **Planning baseline** = the average of the last 3 months that have records.
- **Heatmap shading** = each cell's value ÷ the largest cell, in four steps (25%, 50%, 75%).
- Spay and Neuter Monthly Report rows count their monthly total; any other service record counts as one procedure.
- Sample data and voided entries are excluded.

### 4.8 Data → Import and Export
Bulk import from **Excel or CSV** (up to 8 MB / 10,000 rows): owners with their pets, pets, services, programs, Paravet directory, households, animals, historical stubs. Columns are matched to e-Vet fields (with suggestions), rows are reviewed before saving, and the **last import can be undone**. Export any record type as CSV or Excel; passwords, keys and photos are left out.

**Old paper records**: scan them in e-Vet Field, export the table as Excel/CSV, then import it here. (Census sheets use Census → Import; monthly workbooks use Reports → Monthly workbook.)

### 4.9 System
- **Audit**: every change, with who made it and when.
- **Access**: time-limited extra permissions (archive, restore, delete, export with IDs) and access requests.
- **Issues**: problem reports from staff and Paravets.

### 4.10 Inbox, Settings and Account
Notifications, theme and language (English / Filipino), and the staff member's own profile and photo.

---

## 5. Privacy and safety rules (both apps)

- **Local first.** e-Vet Field keeps documents, images and datasets on the phone. It sends only values, and only when the user chooses to send.
- **No cloud AI, no analytics with document text.**
- **AI proposes, the user approves.** AI output is a suggestion with its source, never saved silently.
- **Preview before change, Undo after.** This applies to dataset edits, imports and account changes.
- **Untrusted input is checked.** File types and sizes are validated, and spreadsheet exports are protected against formula injection.
- **Server security.** Passwords are stored only as bcrypt hashes; a Paravet's temporary password is shown once. Every request re-checks the account, so deactivating an account takes effect immediately. Cross-site writes are blocked. The API's database role reads only the account columns it needs.
- **Accessibility.** Status is never shown by colour alone, keyboard focus stays visible, and phone layouts have no sideways scrolling.

---

## 6. For developers

### Run locally

**e-Vet Field (`salin`)**
```bash
npm run dev        # Vite dev server
npm run build      # type check + production build
npm run preview    # production build on :4173 (needed for offline/PWA tests)
npm run verify     # lint + unit tests + build + e2e
```
`.env.local` sets `VITE_CITY_VET_API_URL` (the e-Vet Admin API). The camera needs HTTPS or localhost.

**e-Vet Admin (`city-vet-admin`)**
```bash
npm run dev:test       # local stack: UI :5175, API :3000, database :5433   (localadmin / LocalTest!123)
npm run preview:stubs  # disposable demo on :5176 with sample programs        (localstubadmin / StubDemo!2026)
npm run typecheck
npm test
npm run build
```
- `preview:stubs` serves the last **build** (`dist/`): run `npm run build` first or you will see old screens.
- `dev:test` doesn't always reload edited API files; restart it after server changes.

### Deploy
- **e-Vet Admin** deploys to Vercel on every push to `main` (`eeun4176/city-vet-admin`).
- Database changes are SQL files in `db/` (numbered migrations) and `hosting/`. The database owner applies them in the Supabase SQL Editor after a backup. `hosting/07-query-timeouts.sql` sets database time limits so one stuck request can't stall the API.

### Hosting notes (learned the hard way)
- Vercel freezes idle functions. The API reconnects to the database after 10 idle seconds and allows up to 5 database connections per instance (`server/db.ts`). With a single connection, the Field operations pages hung for 60 s and then signed users out.
- On Supabase the API role reads only specific `accounts` columns. Queries must not use other columns (such as `updated_at`). `tests/search-api-role.test.ts` runs the search as that role to catch this locally.
- e-Vet Admin signs a user out only when the server answers 401. A timeout or server error keeps the session.

### Further documentation (in `salin/docs/`)
| File | Topic |
|---|---|
| `ADMIN_INTEGRATION.md` | How e-Vet Field talks to e-Vet Admin, sending a census, migrations, password reset |
| `ARCHITECTURE.md` | How both apps are built, connected and deployed |
| `TECHNOLOGIES.md` | Technologies and AI models: purpose and why they fit |
| `LIMITATIONS.md` | What the system can't do, or does only under conditions |
| `DEVELOPMENT_PLAN.md` | Phases, status and what's left before going live |
| `CENSUS_FORM.md` | The CVO census sheet, OMR and its versions |
| `PHASE4_OCR.md`, `OCR_BENCHMARKS.md` | Scanning and text reading |
| `PHASE5_AI.md` | On-device AI: models, benchmarks, decisions |
| `DESIGN_SYSTEM.md` | Colours, type, components |

e-Vet Admin's own docs are in `city-vet-admin/docs/`, `README.md`, `README-BACKEND.md` and `hosting/README.md`.
