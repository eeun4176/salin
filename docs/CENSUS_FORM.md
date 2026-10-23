# CVO-CENSUS — the scannable Dog & Cat working sheet

One owner and up to three pets per sheet, on long bond paper (216 × 330 mm), printed black and white from **Census → Print forms**. A continuation sheet carries pets 4–6 of an owner. Salin reads it on the device: tick boxes and bubbles need no model. Handwriting is read by the on-device handwriting reader (or printed-text OCR when the reader isn't installed), and later, when online, by the City Vet server.

## Versions

The code strip says which version a sheet is, so every version keeps scanning. **Print forms** prints the newest.

| Field | v1 | v2 | **v3 (printed now)** |
|---|---|---|---|
| Owner name, address, pet name | One letter box per character | **Open writing lines** (address: 2 lines) | Open writing lines (**address: 1 line**) |
| Contact number | 11 digit boxes | 11 digit boxes | 11 digit boxes |
| Color | Letter boxes | **Tick boxes**: Black, White, Brown, Gray, Orange, Mixed/spotted, Other (other colors go in Remarks) | Tick boxes |
| Age | Tens and ones bubbles (easy to misfill) | **One row**: 0–20+ years, 0–11 months | One row |
| Registered In | "20" + tens and ones bubbles | **Tick boxes**: the 8 years up to the census year, Earlier, Not yet | Tick boxes |
| Other vaccines, remarks | Letter boxes | Open writing lines | Open writing lines, side by side, named left of the line |
| Type of pet … Registered In | Rows of tick boxes, each starting where the last ended | Same as v1 | **A grid**: each category in its own cell, its name on top; tick boxes sit on 12 shared columns, so they line up from row to row |

The v2 mix keeps letter boxes only where a fixed count matters (11 digits). Names and addresses are written naturally, which is what handwriting readers are trained on. Everything with a short list of answers is a tick box, which reads near-perfectly. v3 keeps the v2 fields and makes the pet record easier to fill in and check: Type / Sex / Sterilized, Breed / Classification, Vaccination status / Laps, Color, Registered In, then Other vaccines / Remarks. The title reads "DOG & CAT CENSUS WORKING SHEET FORM".

## How it's read

| Step | Code | What happens |
|---|---|---|
| Find the sheet | `src/core/census/omr/find-markers.ts` | The four 9 mm black corner squares (Otsu threshold, solid square blobs, outermost toward each corner). Pieces of a square split by a thin printer or scanner line are joined first. The top-left one has a white centre, which gives the orientation. |
| Flatten | `read-sheet.ts` → `flatten` | Homography from the marker centres to the layout's, extended to the whole page, at 8 px/mm (1728 × 2640). |
| Code strip | `code-strip.ts` | 44 squares: version (4 bits), main/continuation (1), barangay index (7), census date as days since 2024-01-01 (14), sheet number (12), position-weighted checksum (6). Any single misread square is rejected. A bad strip means "not a census sheet" and the page goes through normal OCR. All four orientations are tried, the hollow-marker one first. |
| Local alignment | `read-sheet.ts` → `alignment` | Printers, scanner apps and paper curl leave boxes up to ~1 mm from where the corners put them. Each row of boxes, bubbles or letter boxes is shifted (±1.2 mm) onto its own printed outlines before anything is measured. Then each box settles on its own outline near that (±1.2 mm), because paper that isn't quite flat tilts a long row by a millimetre or more from end to end. A shift only counts where opposite sides of a box both meet ink, so the category label just above a v3 grid row or the grid line just below it can't pull a box onto itself; each code square takes its best spot within ±1 mm. |
| Tick boxes and bubbles | `read-sheet.ts` → `answer` | Ink share inside the box (bubbles: the middle 40 %) (outline left out, 20 % inset): ≥ 0.10 ticked, ≤ 0.035 empty, in between "unclear" (same thresholds as `findCheckboxes`). Exactly one tick is the answer, none is unanswered, two or more is `multiple-marks`. One light mark with every other box clean is offered as the answer but flagged (`checkbox-unclear`, "The mark is faint"), so the reviewer confirms it instead of finding a blank. |
| Handwriting | `handwritingOnly` + `census-extraction.ts` | Readers see a copy that holds only the insides of the letter boxes and writing lines, so printed words and box lines can't be mistaken for values. Text is uppercased and limited to capitals, digits and `. , ' # / -` (digits only for the contact number). Letter boxes: the empty boxes decide where the spaces go. Open lines: read as written. |

The layout (`src/core/census/census-layout.ts`) is the only source of positions, for printing (`features/census/components/census-sheet.tsx`) and reading alike. **Never move anything within a version**: bump `FORM_VERSION` and add a new layout instead. Barangays are encoded by their position in `barangays.ts`, so only append to that list.

### Handwriting

Tesseract reads print well and handwriting poorly (47 % character errors on handwriting in the Phase 5 benchmark). Two readers do better:

- **On the device, automatic.** When the handwriting reader (PP-OCRv5 mobile, about 35 MB with its engine) is installed, every census scan reads its handwriting with it while scanning, whatever the AI mode. Its readings are the values in review, with their confidence; Tesseract is only the fallback. A census review without the reader offers the download once, then "Read handwriting now".
  - Letter boxes (the contact number; every field on v1) are decoded **one character per written box** (`decodeSlots`). It can't skip, double or invent a box.
  - Open lines are decoded as a line, limited to the field's characters (`decodeLine` with `allowed`). Lowercase and look-alikes are folded in (o → O; O → 0 in digit boxes).
- **Online (Read on City Vet server).** Only the written rows go to the city's own server (see [CENSUS_HANDWRITING_API.md](CENSUS_HANDWRITING_API.md)). Readings that don't fit are dropped. The button stays disabled until `VITE_CITY_VET_READER_URL` is set.

The reviewer still checks every value, and readings below 0.75 confidence are flagged for typing.

**Larger model tried:** the PP-OCRv5 *server* recognizer (84 MB ONNX, `monkt/paddleocr-onnx` @ `7b02d0a`) loads in ONNX Runtime but crashed the browser tab when loaded next to the mobile model. It's not used on devices. It's the suggested model for the City Vet server instead.

**Measured:**

- **Synthetic, v2 sheets** (`e2e/census-benchmark.spec.ts`, `SALIN_CENSUS_BENCH=1`): 12 sheets in 8 handwriting fonts, a third each neat, messy and thin-pen, with tilt, blur and shading. Read automatically while scanning. Results in `docs/benchmarks/census/synthetic.json`.
  - **4.9 % character errors, 75 % of fields exactly right** (owner, address, contact, pet name).
  - Tick boxes and bubbles (type, sex, vaccination, color): 100 %.
  - Neat sheets: almost every field exact. Remaining errors are stray spaces and dropped letters in messy and thin-pen writing, and one thin-pen contact number that lost three digits.
  - Open lines are cropped to the writing. Spaces are put back where the ink shows a word gap: wider than the writer's own letter spacing, between 2 and 3.5 mm. Faint ink is stretched to full contrast before reading.
  - A handwriting read that goes silent for 45 s is stopped (`READ_STALL_MS`), retried once, then read with Tesseract, so a scan can't hang.
- **Synthetic, v1 sheets** (same benchmark, earlier):
  - Tesseract: 21.7 % character errors, 38 % of fields exactly right.
  - Reader, one character per box: **8.8 %, 82 %**.
  - Tick boxes and bubbles: 100 %.
  - Most remaining errors are thin-stroke fonts, where some letters don't register as ink in their box.
  - Fonts are neater than real hands, so these numbers are an upper bound.
- **One real sheet:** owner "IAN CARAL**A**UINTO" (2 letters off), contact, pet name exact, color "**R**ROWN".

## Review and records

- Barangay, date and sheet number come from the code strip (confidence 100). Everything else uses the normal review states.
- **Validated** means every value of the pet and its owner is Ready: read for certain, or confirmed/edited by the reviewer. Otherwise the pet is **Pending**, or **Unreadable** if any value is unreadable. The *Review notes* column says what's left.
- Records gather in one dataset per barangay and census date (`origin.kind = "census"`). A re-scanned sheet number asks first, then replaces its earlier rows. A blank pet slot is skipped with a warning (tick N/A to make it explicit).
- Continuation pets take their owner from the main sheet. Until that sheet is scanned they stay Pending.

## Official workbook

`src/core/census/summary-workbook.ts` fills the office's own `Census Form.xlsx` (`src/assets/census/census-form-template.xlsx`) by patching sheet XML (`xlsx-patch.ts`). Styles, merges and logos are untouched. Text is written as inline strings, never formulas.

- **SUMMARY OF CENSUS**: one row per owner (owner 1 on rows 8–9, owners 2–20 on rows 10–28). Dog/cat counts by M, F, castrated (male + sterilized), spayed (female + sterilized), confined, semi-confined and free roaming, plus 1st/2nd/3rd vaccination. TOTAL is on row 29.
- **CENSUS REVISED 2022 SINGLE**: one validated pet per row (rows 7–26).
- Each 20 owners or 20 pets past the first page goes on a copy of the sheet ("… (2)"), without the logos.
- **PENDING REVIEW**: Pending and Unreadable pets, which are never counted above.

Assumed mapping (confirm with City Vet): Booster, Mix breed, Laps, Registered in and Other vaccines have no column in the template, so they go into *Others/Remarks* as words.

## Still to test on real devices

- [ ] Print on long bond at 100 % scale on the CVO's printers, including a photocopy of a printed sheet.
- [ ] Ballpoint (blue/black), felt pen and pencil; ticks vs. fills; light and heavy hands.
- [ ] Daylight, shade, indoor fluorescent, phone flash; slight curl and folds.
- [ ] Two or three Android phones (low-end included), photos at an angle and rotated.
- [ ] Real handwriting: compare letter-box OCR with and without the PP-OCRv5 handwriting reader (Review → handwriting).
- [ ] Record per-field accuracy in `docs/benchmarks/census/`.
