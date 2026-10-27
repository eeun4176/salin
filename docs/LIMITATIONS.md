# e-Vet Limitations

What e-Vet Field and e-Vet Admin can't do, or do only under certain conditions. Read this before training users or presenting results. Items marked *(not yet tested)* still need checking on real devices.

---

## 1. Scope

- **Pet services only.** e-Vet covers dogs and cats: the census, anti-rabies vaccination, Kapon, microchipping, registration and program days. Livestock, meat inspection and clinic consultations are not covered.
- **Owners have no accounts.** Owners take part through the Paravet and the paper stub. There is no owner portal, online booking or SMS reminder.
- **No payments.** The services are free, so there is no billing or cashier module.
- **Two roles.** There is one staff role (Admin) and the Paravet role. Finer staff roles (encoder only, viewer only) are handled only through time-limited extra permissions.
- **English and Filipino only.** e-Vet Admin's interface is in both; e-Vet Field's interface is in English, with Filipino supported in OCR and AI Studio questions.

## 2. Devices and browsers

- **Built for Android with Chrome.** e-Vet Field is tested mainly on Chrome. iPhones and other browsers may lack WebGPU or behave differently with offline storage *(not yet tested)*.
- **The phone must have storage space.** The app, scans and datasets live on the phone; the full AI download adds about 600 MB.
- **Data on the phone can be lost** if the user clears the browser's site data, uninstalls the app, or loses the phone before sending. Unsent changes in the outbox go with it. *Backup / Restore* and sending promptly reduce the risk.
- **The camera needs HTTPS** (or localhost), and scanning works best with a phone camera of at least 8 MP.

## 3. Offline work and syncing

- **The first sign-in needs internet**, and so do sending records, downloading the day pack and downloading AI models.
- **The office sees new records only after the phone reconnects.** Until then, e-Vet Admin's attendance and census numbers are behind.
- **The offline session lasts about 14 days** (`SALIN_SESSION_DAYS`). A Paravet offline for longer must reconnect to sign in again.
- **Program day needs the day pack.** Stubs encoded after the day pack was downloaded are not on the phone until it is downloaded again. A scan counts only on the program's own date.
- **Server refusals wait for the Paravet.** If the server refuses a queued change (for example, a closed program), it stays in the outbox as "needs attention" until the Paravet fixes or discards it.

## 4. Scanning, OCR and handwriting

- **Handwriting is not perfect.** On the one real CVO form tested, about 18% of characters were wrong before review. Messy hands, pencil, blurry or dark photos make it worse. Every value must be reviewed, and readings under 75% confidence are left for the user to type.
- **Accuracy is not yet measured on many real forms.** It needs 10–20 sheets written by different people *(not yet tested)*.
- **The census sheet must be printed correctly:** on long bond paper at 100% scale, with the four corner markers visible. Heavy folds, cut-off corners, or photocopies of photocopies can make a sheet unreadable.
- **Other paper forms** are read as general text and tables unless a template exists for them. Label-and-value forms (like the dog registration sheet) aren't tables, so they need manual mapping.
- **The City Vet handwriting server isn't built yet.** The *Read on City Vet server* button stays disabled.

## 5. On-device AI

- **The assistant is optional and experimental.** Small language models still misread some requests: about 14 of 20 unseen requests are right with Qwen3-0.6B. Every answer shows how it was understood, and changes need a preview and confirmation.
- **Speed depends on the device.** With WebGPU an answer takes seconds to about 30 s; on the CPU (phones without WebGPU) it can take a minute or more. Low-memory phones get only *Off* or *Handwriting* mode.
- **It knows only the data on the phone.** It doesn't search the internet or the office's database, and it doesn't give veterinary advice.
- **The download is large:** about 600 MB on phones and 1 GB on laptops, once, preferably on Wi-Fi.
- **Phone speed and memory are not yet measured on real Android phones** *(not yet tested)*.

## 6. Programs, stubs and census

- **Stubs need the paper process.** Stubs are printed and handed out on paper. A lost stub can be looked up by number, owner or mobile, but owners without a stub must be recorded as walk-ins.
- **Up to three pets per stub**, and one owner per census sheet (a continuation sheet carries pets 4–6).
- **Only Validated pets are sent** in a census. Pending and unreadable records stay on the phone until fixed. One submission holds at most 200 owners and 1,000 pets (larger censuses are sent in parts).
- **Census addresses and contacts.** A missing address is replaced by the barangay, and a contact that isn't a Philippine mobile number (11 digits starting with 09) is left out.
- **Duplicates are not merged automatically.** Similar owners are flagged for staff to review; the system never merges people by name alone.

## 7. e-Vet Admin and hosting

- **It needs internet.** e-Vet Admin has no offline mode.
- **Imports are limited:** up to 8 MB and 10,000 rows per file, Excel or CSV only (PDFs and photos must go through e-Vet Field first). Only the last import can be undone, and only while its records are unchanged.
- **Exports are limited:** up to 10,000 records per export (30,000 pets for owners with pets).
- **Cloud limits.** Each API request has 60 seconds. Free tiers of Vercel and Supabase have usage limits and can pause inactive projects; Supabase's daily backups need the paid plan.
- **Email limits.** Password-reset codes go through the office Gmail account, which allows about 500 emails a day. Paravets without a confirmed email need an Admin to renew their temporary password.
- **Reports are only as good as the data entered.** KPIs count only what was recorded and approved. The vaccination coverage is "as recorded", not an exact field count.

## 8. Security and privacy

- **No database-level access rules.** The API checks every account and barangay itself; PostgreSQL row-level security is not used. A leaked database password would expose all data, so the API role is kept restricted and the password secret.
- **The phone is the weak point.** Anyone who unlocks a Paravet's phone and knows their password can open the data stored on it. Phones should have a screen lock.
- **Temporary passwords are shown to the Admin once**, who passes them to the Paravet in person. There is no automatic delivery by SMS.
- **Compliance is not automatic.** The system supports the Data Privacy Act (RA 10173), but the office must still name a data protection officer, publish a privacy notice and set retention rules.

## 9. Testing status

- **Automated tests cover the logic, the API and the main screens.** e-Vet Field has unit tests and Playwright end-to-end tests; e-Vet Admin's tests run against a local database.
- **Field conditions are not yet tested:** a physical Android phone at a venue with poor signal, real printed sheets on the CVO's printers, and AI speed on the Paravets' own phones. See [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) §2.
