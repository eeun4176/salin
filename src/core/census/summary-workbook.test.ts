/**
 * Official Census Workbook Tests
 * The office's template comes back with its logos and merged cells, the
 * Summary counts only Validated pets in the right D/C cells (with totals),
 * the Single sheet lists them, pending ones get their own sheet, more than
 * 20 owners continue on a copied page, and text that looks like a formula
 * stays text.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { COLUMN } from "./census-records";
import { buildCensusWorkbook, type CensusRecord } from "./summary-workbook";

const template = new Uint8Array(readFileSync(resolve(__dirname, "../../assets/census/census-form-template.xlsx")));

const pet = (sheet: number, petNo: number, owner: string, extra: CensusRecord): CensusRecord => ({
  [COLUMN.sheet]: sheet,
  [COLUMN.pet]: petNo,
  [COLUMN.owner]: owner,
  [COLUMN.continuedFrom]: null,
  [COLUMN.status]: "Validated",
  [COLUMN.notes]: null,
  "Name of pet": "BANTAY",
  "Type of pet": "Dog",
  Sex: "Male",
  ...extra,
});

const records: CensusRecord[] = [
  pet(1, 1, "JUAN DELA CRUZ", { Sterilized: "Yes", Classification: "Confined", "Vaccination status": "1st", "Age (years)": 3 }),
  pet(1, 2, "JUAN DELA CRUZ", { "Name of pet": "MING", "Type of pet": "Cat", Sex: "Female", Sterilized: "Yes", Classification: "Free roaming", "Vaccination status": "Booster", Breed: "Mix" }),
  pet(2, 1, "=HYPERLINK(\"x\")", { "Vaccination status": "2nd" }),
  pet(3, 1, "ANA REYES", { [COLUMN.status]: "Pending", [COLUMN.notes]: "Sex: Unreadable" }),
  pet(4, 4, "", { [COLUMN.continuedFrom]: 1, "Name of pet": "CHOCO", Classification: "Semi-confined" }),
];

function read(bytes: Uint8Array) {
  return XLSX.read(bytes, { type: "array" });
}

describe("buildCensusWorkbook", () => {
  const bytes = buildCensusWorkbook(template, { barangay: "Gumaok East", censusDate: "2026-10-22", records });
  const book = read(bytes);
  const summary = book.Sheets["SUMMARY OF CENSUS"];
  const single = book.Sheets["CENSUS REVISED 2022 SINGLE"];
  const v = (sheet: XLSX.WorkSheet, ref: string) => sheet[ref]?.v;

  it("keeps the template's sheets, logos and merged cells", () => {
    expect(book.SheetNames).toEqual(["CENSUS REVISED 2022 SINGLE", "CENSUS WORKING SHEET FORM", "SUMMARY OF CENSUS", "PENDING REVIEW"]);
    const files = Object.keys(unzipSync(bytes));
    expect(files).toEqual(expect.arrayContaining(["xl/media/image1.jpeg", "xl/media/image3.png", "xl/drawings/drawing3.xml", "xl/styles.xml"]));
    expect(summary["!merges"]?.map((m) => XLSX.utils.encode_range(m))).toContain("A29:B30");
    expect(v(summary, "A2")).toBe("City of San Jose del Monte");
  });

  it("counts validated pets per owner by dog and cat, with totals", () => {
    expect(v(summary, "A5")).toContain("BARANGAY: GUMAOK EAST");
    // Owner 1 (sheet 1 and its continuation sheet 4): 2 dogs, 1 cat.
    expect([v(summary, "B8"), v(summary, "C8"), v(summary, "D8")]).toEqual(["JUAN DELA CRUZ", 2, 1]);
    // Row 9: M D/C, F D/C, castrated D/C, spayed D/C, confined, semi, free, 1st, 2nd, 3rd.
    expect(["E9", "F9", "G9", "H9", "I9", "J9", "K9", "L9", "M9", "N9", "O9", "P9", "Q9", "R9", "S9", "T9", "U9"].map((ref) => v(summary, ref))).toEqual([
      2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0,
    ]);
    expect(v(summary, "V9")).toBe("Booster; Mix breed");
    expect([v(summary, "B10"), v(summary, "C10"), v(summary, "T10")]).toEqual(['=HYPERLINK("x")', 1, 1]);
    expect(summary.B10.f).toBeUndefined();
    // Pending owner 3 isn't counted anywhere.
    expect(v(summary, "B11")).toBeUndefined();
    expect([v(summary, "C29"), v(summary, "D29"), v(summary, "E29"), v(summary, "S29")]).toEqual([3, 1, 3, 1]);
  });

  it("lists validated pets on the Single sheet and pending ones separately", () => {
    expect([v(single, "A4"), v(single, "K4")]).toEqual(["BARANGAY: GUMAOK EAST", "DATE OF CENSUS: 10/22/2026"]);
    expect([v(single, "A7"), v(single, "B7"), v(single, "C7"), v(single, "E7"), v(single, "L7"), v(single, "N7"), v(single, "Q7")]).toEqual(["1. BANTAY", "JUAN DELA CRUZ", "✓", "3 yrs", "✓", "✓", "✓"]);
    expect([v(single, "A8"), v(single, "D8"), v(single, "M8"), v(single, "T8"), v(single, "U8")]).toEqual(["2. MING", "✓", "✓", "Booster", "Mix breed"]);
    expect(v(single, "A9")).toBe("3. CHOCO");
    const pending = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["PENDING REVIEW"], { header: 1 });
    expect(pending[2]).toEqual([3, 1, "ANA REYES", "BANTAY", "Dog", "Pending", "Sex: Unreadable"]);
  });

  it("continues on copies of the sheets past 20 owners", () => {
    const many = Array.from({ length: 23 }, (_, i) => pet(i + 1, 1, `OWNER ${i + 1}`, {}));
    const big = read(buildCensusWorkbook(template, { barangay: "Poblacion", censusDate: "2026-10-22", records: many }));
    expect(big.SheetNames).toEqual(expect.arrayContaining(["SUMMARY OF CENSUS (2)", "CENSUS REVISED 2022 SINGLE (2)"]));
    const second = big.Sheets["SUMMARY OF CENSUS (2)"];
    expect([second.A8?.v, second.B8?.v, second.B10?.v, second.C29?.v]).toEqual([21, "OWNER 21", "OWNER 22", 23]);
    expect(big.Sheets["SUMMARY OF CENSUS"].C29?.v).toBeUndefined();
  });
});
