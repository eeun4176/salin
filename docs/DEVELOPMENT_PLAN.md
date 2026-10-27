# e-Vet Development Plan

The phases e-Vet was built in, their status, and what is left before and after going live. Last updated 2026-10-27.

**Workflow:** capture or import → read and extract → structure → review → save → organise → search → export, then send values to the City Vet office.

---

## 1. Phases

| Phase | Scope | App | Status |
|---|---|---|---|
| 1. Foundation | React/Vite PWA shell, routing, layout, IndexedDB storage, backup and restore | Field | Done |
| 2. Workspace | Files and folders, recents, favourites, trash, search, sort, grid and list views | Field | Done |
| 3. Data processing | Import PDF/Excel/CSV, table detection, datasets, type inference, validation, transforms with preview and undo, XLSX/CSV/JSON export | Field | Done |
| 4. On-device OCR | Camera capture, page cleanup, Tesseract OCR (English + Filipino), layout analysis, templates, review | Field | Done |
| 5. Offline AI | Handwriting reader (PP-OCRv5), on-device assistant (Qwen3), AI Studio, the rule-based question reader, model manager | Field | Done; Android benchmarks pending |
| 6. Sign-in and census | Login, dashboard layout, CVO census working sheet (print, OMR, handwriting), census records, summary workbook | Field | Done; tests with real printed sheets pending |
| 7. City Vet integration | Sign-in through e-Vet Admin, outbox, program requests, stubs, program day, sending censuses, City Vet page, CSP, password reset by email | Field + Admin | Done; physical Android test pending |
| 8. Admin operations | Registry, census review, programs, stub batches, attendance, Paravet accounts, barangays, import and export, audit, access | Admin | Done |
| 9. Analytics and polish | KPI dashboard with charts, reports and exports, phone-number rules, status labels, shared colour palette, data-clearing script | Admin | Done |

---

## 2. Before going live

**Field tests on real devices**
- [ ] Run *AI benchmark* on two or three Android phones, including a low-end one, and record the results in `PHASE5_AI.md` §6.
- [ ] Repeat with the installed app in airplane mode.
- [ ] Program day at a venue with poor signal: scan stubs and add walk-ins offline, then reconnect and check that nothing is lost or counted twice.

**Census sheet**
- [ ] Print on long bond paper at 100% on the CVO's printers, including photocopies.
- [ ] Test ballpoint, felt pen and pencil, in daylight, shade and indoor light.
- [ ] Scan 10–20 sheets written by different people and record per-field accuracy in `docs/benchmarks/census/`.
- [ ] Confirm with the City Vet how census fields map onto the summary workbook.

**Hosted system**
- [ ] Apply migrations 026–032 to the live database, after a backup.
- [ ] Set `ALLOWED_ORIGINS`, `SALIN_SESSION_DAYS` and the Gmail settings in Vercel.
- [ ] Run an end-to-end test with `TEST-` accounts, then clear the test records (`hosting/08-clear-records.sql`).

**People and data**
- [ ] Hold the 2-day training for staff and Paravets.
- [ ] Import the office's old records through Data → Import.
- [ ] Register the system with the office's data protection officer (RA 10173).

---

## 3. Rollout

1. **Pilot:** a few barangays per district for one census cycle, with paper and e-Vet side by side.
2. **Compare:** check that e-Vet's totals match the paper reports.
3. **Citywide:** all 62 barangays; e-Vet becomes the official record.
4. **Review monthly:** audit log, access requests, data-quality flags and issue reports.

---

## 4. Future work

| Idea | Why |
|---|---|
| City Vet handwriting server (`CENSUS_HANDWRITING_API.md`) | A stronger reader for letter-box rows when online; the button is ready in e-Vet Field |
| Exact templates for more CVO forms | Better field mapping beyond the census sheet |
| SMS reminders to owners before program days | Fewer no-shows |
| Public pet-registration lookup | Owners can check their pet's record |
| Database row-level security policies | A second layer under the API's own checks |
| Cross-origin isolation (COOP/COEP) on e-Vet Field | Multi-threaded AI on the CPU, for phones without WebGPU |
| Links to the Provincial Veterinary Office | Shared reporting |

---

## 5. How work is done

- **Branch per phase or feature;** `main` is the base for pull requests. Commits only when the developer asks.
- **Logic in `src/core/`** with unit tests next to each file; screens in `src/features/` stay thin.
- **Before calling work done:** run lint, a type check and the unit tests, plus the affected end-to-end specs when screens change (`npm run verify` runs everything).
- **e-Vet Admin:** `npm run typecheck`, `npm test` (local database) and `npm run build`. Never run tests or migrations against the live database.
