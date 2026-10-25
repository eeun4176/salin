# City Vet admin integration (e-Kapon)

Salin is the paravets' field app for the City Veterinary Office's admin system, **e-Kapon** (`city-vet-admin` repo). Salin keeps everything on the device and sends e-Kapon only what the user chooses to send.

```
Salin PWA ──HTTPS + Bearer token──▶ e-Kapon /api/v1 (Vercel) ──▶ Supabase Postgres (schema ekapon)
  IndexedDB: datasets, census, outbox,        e-Kapon web (staff, cookie) ──┘
  program requests, day packs, stub sheets
```

## Rules

- **Documents, scans and photos are never uploaded.** Salin sends only values: program request edits, stub and program-day updates, and census records.
- **One way in.** Every call goes through `src/core/admin/admin-api.ts` to `${VITE_CITY_VET_API_URL}/api/v1`. It uses a Bearer token, never a cookie, and checks every reply with zod.
- **Writes go through the outbox** (`src/core/sync/outbox.ts`). A change is saved first and sent later, in order, whenever Salin is online and signed in. Each item's id is also the server's `requestId`, so a resend after a dropped reply is recognised and isn't counted twice. A refusal from the server marks the item "needs attention" and shows the server's message.
- **Roles.** Paravets use only Salin and are refused by the e-Kapon web app. Staff (SuperAdmin) can also sign in to Salin, for program day.

## What Salin calls

| Area | Endpoint | Code |
|---|---|---|
| Sign-in | `POST /auth/login`, `/auth/first-signin`, `/auth/set-password`, `/auth/renew`, `GET /auth/me` | `src/core/auth/local-auth.ts` |
| Forgotten password | `POST /auth/email` (`send`, `verify`: the paravet's confirmed email), `POST /auth/forgot-password` (`send`, `reset`) | `src/core/auth/local-auth.ts` |
| Program requests | `GET /program-interest`, `POST /program-interest` (`create-demand`, `add-interest`, `update-interest`, `withdraw-interest`, `submit-request`) | `src/core/programs/program-requests.ts` |
| Stubs and program day | `GET /stub-workflow` (`mode=print`, `day-pack`, `attendance`), `POST /stub-workflow` (`confirm-print`, `confirm-owner`, `redeem`, `walk-in`) | `src/core/programs/stubs.ts` |
| Census | `POST /census/submissions` | `src/core/census/admin-submission.ts` |
| City Vet page | `/notifications`, `/issues`, `/search`, `/data-quality`, `/health` | `src/core/admin/city-vet.ts` |

## Sending a census

Go to **Census → Send to City Vet**. Only a Paravet can send, and only for their own barangay, because e-Kapon files the submission under the account's barangay.

- Only **Validated** pets are sent, the same ones the official workbook counts. Pending and Unreadable pets stay on the device until they're fixed.
- Pets are grouped by owner. The pets on a continuation sheet join the owner on the sheet they continue.
- Sheet answers are mapped onto e-Kapon's fields:
  - Mongrel mix → Mongrel; Free roaming → Free-roaming.
  - Unknown → `null`. Unknown is never sent as No.
  - Vaccination None → every dose No.
  - The age is sent in months.
  - A "Registered in" value that isn't a year (Before 2019, Not registered) goes into the remarks.
- e-Kapon requires an address and accepts only PH mobile numbers. If the address is missing, the barangay is sent instead. A contact that isn't a mobile number is left out. The preview says how many owners each of these affects.
- One submission holds at most 200 owners and 1,000 pets. A larger census is sent in parts, each with its own request id.
- The dataset records `lastSentAt`. Sending again makes another submission, and the preview warns about it.

## e-Kapon migrations (the database Owner applies them)

| File | What |
|---|---|
| `026_salin_integration.sql` | Merged requests, `request_id` on program-interest entries |
| `027_salin_stubs.sql` | Batches sent to a barangay for printing in Salin, stubs that follow owner edits, owner names confirmed on blank stubs |
| `028_superadmin_only.sql` | One staff role |
| `029_census_request_id.sql` | `request_id` on census submissions, so a resent census isn't counted twice |
| `030_password_reset_email.sql` | The paravet's confirmed email, the emailed 6-digit codes, and `sessions_valid_after` (a reset signs out other devices) |

## Forgotten password

- **Set the email first.** In Salin's **Settings → Email for password reset**, the paravet enters an email, gets a 6-digit code there and enters it. e-Kapon saves the address only then, so a typo never receives reset codes.
- **Reset.** On the sign-in screen, **Forgot password?** → Account Key → **Email me a code**, then the code and a new password (8+ characters, with a letter and a number). Salin signs in with the new password and forgets this phone's offline copy sealed with the old one. e-Kapon ends the account's sessions on other devices.
- **Limits.** Codes last 10 minutes and allow 5 tries, and at most 3 are sent per account in 30 minutes. They're stored hashed. The reply is the same whether or not the account or email exists.
- **No confirmed email?** The office issues a new temporary password, as before.
- **Mail is sent from the office Gmail account** through e-Kapon's `GMAIL_USER` and `GMAIL_APP_PASSWORD`. The app password comes from Google Account → Security → 2-Step Verification → App passwords. Gmail allows about 500 emails a day. Outside production with no Gmail set up, mail goes to an in-memory outbox (`devOutbox`) for tests and local work. In production, the endpoints answer "not set up yet" until it is configured.

Each file is idempotent and has rollback notes. Back up the database before applying them, and check `ekapon.schema_migrations` first.

## Content Security Policy

`vite.config.ts` writes a `<meta>` CSP into every production build:

- Scripts come only from Salin itself. `blob:` and `'wasm-unsafe-eval'` are allowed for the OCR engine, plus the hash of the theme script in `index.html`.
- `connect-src` allows only these:
  - Salin
  - the `VITE_CITY_VET_API_URL` origin
  - `VITE_AI_MODEL_HOST` (default `https://huggingface.co`)
  - Hugging Face's download CDN (`*.hf.co`)

The CSP follows each build's environment variables, so changing the API or model host only needs a rebuild. If a new server must be reached, add it there. `vercel.json` adds `frame-ancestors 'none'`, `nosniff` and a same-origin referrer policy as headers.

Dev mode (`npm run dev`) has no CSP. To check it, use `npm run build && npm run preview`, or the e2e suite, which runs on a production build.

## Testing

- Unit tests (Vitest): API errors, sessions, the outbox, program requests, stubs, the census mapping (`admin-submission.test.ts`).
- E2E (Playwright): the API is mocked with `page.route` at `https://ekapon.test`.
- e-Kapon: `npm test` (local Postgres) covers Bearer sign-in, CORS, shared requests, merging, stubs and the census `requestId` replay.
- Still to do: a physical Android test at a venue with poor signal (program day offline, then reconnecting), and an end-to-end run on the shared project with `TEST-` accounts.
