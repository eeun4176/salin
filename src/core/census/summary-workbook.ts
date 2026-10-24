/**
 * Official Census Workbook
 * Fills the City Veterinary Office's own census workbook (its template,
 * logos and layout untouched) from a barangay's census records: the SUMMARY
 * OF CENSUS sheet counts each owner's dogs (D) and cats (C) by sex,
 * castrated/spayed, classification and vaccination, with a TOTAL row; the
 * CENSUS REVISED 2022 SINGLE sheet lists every pet. Only Validated records
 * are counted — Pending and Unreadable ones go on a separate PENDING REVIEW
 * sheet. More than 20 owners or pets continue on copies of the sheets.
 */

import { byOwner, COLUMN } from "@/core/census/census-records";
import { Workbook, type CellInput } from "@/core/census/xlsx-patch";
import type { CellValue } from "@/types/processing";

/** A census record by column name (a row of a census dataset). */
export type CensusRecord = Record<string, CellValue>;

export interface CensusWorkbookInput {
  barangay: string;
  /** ISO date. */
  censusDate: string;
  records: CensusRecord[];
}

const SUMMARY = "SUMMARY OF CENSUS";
const SINGLE = "CENSUS REVISED 2022 SINGLE";
const PER_PAGE = 20;

// SUMMARY OF CENSUS: owner 1 sits on row 8 (its name and dog/cat counts, merged over rows 8–9;
// row 8 also holds the D/C headings) with its other counts on row 9; owners 2–20 on rows 10–28.
const summaryRow = (i: number) => (i === 0 ? 9 : 9 + i);
const SUMMARY_TOTAL_ROW = 29;
const D_C_COLUMNS: [string, string, (r: CensusRecord) => boolean][] = [
  ["E", "F", (r) => is(r, "Sex", "Male")],
  ["G", "H", (r) => is(r, "Sex", "Female")],
  ["I", "J", (r) => is(r, "Sex", "Male") && is(r, "Sterilized", "Yes")],
  ["K", "L", (r) => is(r, "Sex", "Female") && is(r, "Sterilized", "Yes")],
  ["M", "N", (r) => is(r, "Classification", "Confined")],
  ["O", "P", (r) => is(r, "Classification", "Semi-confined")],
  ["Q", "R", (r) => is(r, "Classification", "Free roaming")],
];
const VACCINE_COLUMNS: [string, string][] = [
  ["S", "1st"],
  ["T", "2nd"],
  ["U", "3rd"],
];

const text = (r: CensusRecord, column: string) => String(r[column] ?? "").trim();
const is = (r: CensusRecord, column: string, value: string) => text(r, column).toLowerCase() === value.toLowerCase();
const dog = (r: CensusRecord) => is(r, "Type of pet", "Dog");
const cat = (r: CensusRecord) => is(r, "Type of pet", "Cat");
const TICK = "✓";

function displayDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** What the template has no column for, kept as words: booster shots, other vaccines, mixed breed, laps, registration, remarks. */
function extras(r: CensusRecord, includeRemarks: boolean) {
  return [
    is(r, "Vaccination status", "Booster") && "Booster",
    text(r, "Other vaccines") && `Other vaccines: ${text(r, "Other vaccines")}`,
    is(r, "Breed", "Mix") && "Mix breed",
    is(r, "Laps", "Yes") && "Laps",
    text(r, "Registered in") && `Registered ${text(r, "Registered in")}`,
    includeRemarks && text(r, "Remarks"),
  ].filter(Boolean) as string[];
}

function age(r: CensusRecord) {
  const years = text(r, "Age (years)");
  const months = text(r, "Age (months)");
  return [years && `${years} yr${years === "1" ? "" : "s"}`, months && months !== "0" && `${months} mo${months === "1" ? "" : "s"}`].filter(Boolean).join(" ");
}

const pageName = (base: string, page: number) => (page === 0 ? base : `${base} (${page + 1})`);

function chunk<T>(items: T[]) {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += PER_PAGE) pages.push(items.slice(i, i + PER_PAGE));
  return pages.length ? pages : [[]];
}

/** The filled workbook (.xlsx bytes). `template` is the office's Census Form.xlsx. */
export function buildCensusWorkbook(template: Uint8Array, { barangay, censusDate, records }: CensusWorkbookInput): Uint8Array {
  const book = new Workbook(template);
  const validated = records.filter((r) => r[COLUMN.status] === "Validated");
  const pending = records.filter((r) => r[COLUMN.status] !== "Validated");
  const heading = `BARANGAY: ${barangay.toUpperCase()}`;
  const date = `DATE OF CENSUS: ${displayDate(censusDate)}`;

  // SUMMARY OF CENSUS, 20 owners a page; TOTAL on the last page counts everyone.
  const owners = byOwner(validated);
  const summaryPages = chunk(owners);
  summaryPages.forEach((_, p) => p > 0 && book.copySheet(SUMMARY, pageName(SUMMARY, p)));
  summaryPages.forEach((pageOwners, p) => {
    const cells: Record<string, CellInput> = { A5: `${heading}     ${date}` };
    for (let i = 0; i < PER_PAGE; i++) {
      const pets = pageOwners[i];
      const row = summaryRow(i);
      // Owner 1's name and Dog/Cat are merged cells starting on row 8.
      const top = i === 0 ? 8 : row;
      cells[`A${top}`] = p * PER_PAGE + i + 1;
      cells[`B${top}`] = pets ? text(pets[0], COLUMN.owner) : null;
      cells[`C${top}`] = pets ? pets.filter(dog).length : null;
      cells[`D${top}`] = pets ? pets.filter(cat).length : null;
      for (const [d, c, test] of D_C_COLUMNS) {
        cells[`${d}${row}`] = pets ? pets.filter((r) => dog(r) && test(r)).length : null;
        cells[`${c}${row}`] = pets ? pets.filter((r) => cat(r) && test(r)).length : null;
      }
      for (const [col, value] of VACCINE_COLUMNS) cells[`${col}${row}`] = pets ? pets.filter((r) => is(r, "Vaccination status", value)).length : null;
      cells[`V${row}`] = pets ? [...new Set(pets.flatMap((r) => extras(r, false)))].join("; ") || null : null;
    }
    if (p === summaryPages.length - 1) {
      cells[`C${SUMMARY_TOTAL_ROW}`] = validated.filter(dog).length;
      cells[`D${SUMMARY_TOTAL_ROW}`] = validated.filter(cat).length;
      for (const [d, c, test] of D_C_COLUMNS) {
        cells[`${d}${SUMMARY_TOTAL_ROW}`] = validated.filter((r) => dog(r) && test(r)).length;
        cells[`${c}${SUMMARY_TOTAL_ROW}`] = validated.filter((r) => cat(r) && test(r)).length;
      }
      for (const [col, value] of VACCINE_COLUMNS) cells[`${col}${SUMMARY_TOTAL_ROW}`] = validated.filter((r) => is(r, "Vaccination status", value)).length;
    }
    book.setCells(pageName(SUMMARY, p), cells);
  });

  // CENSUS REVISED 2022 SINGLE: one pet per row, rows 7–26.
  const pets = owners.flat();
  const singlePages = chunk(pets);
  singlePages.forEach((_, p) => p > 0 && book.copySheet(SINGLE, pageName(SINGLE, p)));
  singlePages.forEach((pagePets, p) => {
    const cells: Record<string, CellInput> = { A4: heading, K4: date };
    pagePets.forEach((r, i) => {
      const row = 7 + i;
      const mark = (yes: boolean) => (yes ? TICK : null);
      Object.assign(cells, {
        [`A${row}`]: `${p * PER_PAGE + i + 1}. ${text(r, "Name of pet") || "(no name)"}`,
        [`B${row}`]: text(r, COLUMN.owner),
        [`C${row}`]: mark(dog(r)),
        [`D${row}`]: mark(cat(r)),
        [`E${row}`]: age(r) || null,
        [`F${row}`]: mark(is(r, "Breed", "Mongrel mix")),
        [`G${row}`]: mark(is(r, "Breed", "Pure")),
        [`I${row}`]: text(r, "Color") || null,
        [`J${row}`]: mark(is(r, "Sex", "Male")),
        [`K${row}`]: mark(is(r, "Sex", "Female")),
        [`L${row}`]: mark(is(r, "Sex", "Male") && is(r, "Sterilized", "Yes")),
        [`M${row}`]: mark(is(r, "Sex", "Female") && is(r, "Sterilized", "Yes")),
        [`N${row}`]: mark(is(r, "Classification", "Confined")),
        [`O${row}`]: mark(is(r, "Classification", "Semi-confined")),
        [`P${row}`]: mark(is(r, "Classification", "Free roaming")),
        [`Q${row}`]: mark(is(r, "Vaccination status", "1st")),
        [`R${row}`]: mark(is(r, "Vaccination status", "2nd")),
        [`S${row}`]: mark(is(r, "Vaccination status", "3rd")),
        [`T${row}`]: [is(r, "Vaccination status", "Booster") && "Booster", text(r, "Other vaccines")].filter(Boolean).join("; ") || null,
        [`U${row}`]: [...extras(r, true).filter((e) => !e.startsWith("Booster") && !e.startsWith("Other vaccines"))].join("; ") || null,
      });
    });
    book.setCells(pageName(SINGLE, p), cells);
  });

  if (pending.length) {
    book.addTableSheet("PENDING REVIEW", [
      ["Not counted above — these records still need review.", null, null, null, null, null, null],
      [COLUMN.sheet, COLUMN.pet, COLUMN.owner, "Name of pet", "Type of pet", COLUMN.status, COLUMN.notes],
      ...pending.map((r) => [Number(r[COLUMN.sheet]) || null, Number(r[COLUMN.pet]) || null, text(r, COLUMN.owner) || null, text(r, "Name of pet") || null, text(r, "Type of pet") || null, text(r, COLUMN.status), text(r, COLUMN.notes) || null]),
    ]);
  }
  return book.toBytes();
}
