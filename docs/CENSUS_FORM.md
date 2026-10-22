# CVO-CENSUS v1 — the scannable Dog & Cat working sheet

One owner and up to three pets per sheet, on long bond paper (216 × 330 mm), printed black and white from **Census → Print forms**. A continuation sheet carries pets 4–6 of an owner. Salin reads it on the device: no model is needed for the boxes; handwriting goes through the normal on-device OCR.

## How it's read

| Step | Code | What happens |
|---|---|---|
| Find the sheet | `src/core/census/omr/find-markers.ts` | The four 9 mm black corner squares (Otsu threshold, solid square blobs, outermost toward each corner). The top-left one has a white centre, which gives the orientation. |
| Flatten | `read-sheet.ts` → `flatten` | Homography from the marker centres to the layout's, extended to the whole page, at 8 px/mm (1728 × 2640). |
| Code strip | `code-strip.ts` | 44 squares: version (4 bits), main/continuation (1), barangay index (7), census date as days since 2024-01-01 (14), sheet number (12), position-weighted checksum (6). Any single misread square is rejected. A bad strip means "not a census sheet" and the page goes through normal OCR. All four orientations are tried, the hollow-marker one first. |
| Tick boxes and bubbles | `read-sheet.ts` → `answer` | Ink share inside the box (outline left out, 20 % inset): ≥ 0.10 ticked, ≤ 0.035 empty, in between "unclear" (same thresholds as `findCheckboxes`). Exactly one tick is the answer, none is unanswered, two or more is `multiple-marks`. |
| Letter boxes | `handwritingOnly` + `census-extraction.ts` | OCR reads a copy that holds only the insides of the letter boxes, so printed words and box lines can't be mistaken for values. Text is uppercased and limited to capitals, digits and `. , ' # / -`. Look-alike letters in the contact number are turned into digits. When as many letters were read as boxes hold ink, the empty boxes decide where the spaces go. |

The layout (`src/core/census/census-layout.ts`) is the only source of positions, for printing (`features/census/components/census-sheet.tsx`) and reading alike. **Never move anything within a version**: bump `FORM_VERSION` and add a new layout instead. Barangays are encoded by their position in `barangays.ts`, so only append to that list.

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
