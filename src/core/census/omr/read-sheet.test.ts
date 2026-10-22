/**
 * Census Sheet Reader Tests
 * Synthetic sheets drawn from the layout, photographed at an angle and in
 * every orientation: the code strip, ticks, bubbles, double ticks, faint
 * smudges, empty slots and inked letter boxes read back as filled in — and a
 * page that isn't a census sheet is refused.
 */

import { describe, expect, it } from "vitest";

import { CENSUS_LAYOUT, PAGE } from "@/core/census/census-layout";
import { FORM_VERSION, type SheetCode } from "@/core/census/code-strip";
import { createGray } from "@/core/ocr/imaging/pixels";
import { drawSheet, photograph } from "@/test/census-fixtures";

import { handwritingOnly, locateAndRead, readFlatSheet } from "./read-sheet";

const code: SheetCode = { version: FORM_VERSION, continuation: false, barangay: 6, censusDate: "2026-10-22", sheetNumber: 7 };

const filled = drawSheet({
  code,
  answers: {
    "pet0.type": "DOG",
    "pet0.sex": "FEMALE",
    "pet0.sterilized": "YES",
    "pet0.breed": "MONGREL MIX",
    "pet0.classification": "FREE ROAMING",
    "pet0.vaccination": "2ND",
    "pet0.laps": "NO",
    "pet0.age_years": "3",
    "pet0.age_months": "11",
    "pet0.registered": "2024",
    "pet1.type": ["DOG", "CAT"],
    "pet1.age_years": "12",
  },
  faint: { "pet1.sex": "MALE" },
  writing: { "owner.owner_name": [0, 1, 2, 3, 5, 6, 7] },
  emptySlots: [2],
});

describe("readFlatSheet", () => {
  it("reads the code, ticks, bubbles and letter boxes", () => {
    const read = readFlatSheet(filled)!;
    expect(read.code).toEqual(code);
    const value = (key: string) => read.answers[key].value;
    expect([value("pet0.type"), value("pet0.sex"), value("pet0.sterilized"), value("pet0.breed"), value("pet0.classification"), value("pet0.vaccination"), value("pet0.laps")]).toEqual([
      "DOG",
      "FEMALE",
      "YES",
      "MONGREL MIX",
      "FREE ROAMING",
      "2ND",
      "NO",
    ]);
    expect([value("pet0.age_years"), value("pet0.age_months"), value("pet0.registered")]).toEqual(["3", "11", "2024"]);
    expect(read.answers["pet1.age_years"].value).toBe("12");
    expect(read.inked["owner.owner_name"][0].slice(0, 9)).toEqual([true, true, true, true, false, true, true, true, false]);
    expect(read.emptySlots).toEqual([false, false, true]);
  });

  it("leaves double ticks, faint smudges and blanks for the reviewer", () => {
    const read = readFlatSheet(filled)!;
    expect(read.answers["pet1.type"]).toMatchObject({ value: null, state: "multiple", marked: ["DOG", "CAT"] });
    expect(read.answers["pet1.sex"]).toMatchObject({ value: null, state: "unclear" });
    expect(read.answers["pet1.breed"]).toMatchObject({ value: null, state: "unanswered" });
    expect(read.answers["pet2.registered"]).toMatchObject({ value: null, state: "unanswered" });
  });

  it("reads a continuation sheet's 'continued from' number", () => {
    const read = readFlatSheet(drawSheet({ code: { ...code, continuation: true, sheetNumber: 8 }, answers: { "owner.continued_from": "7" } }))!;
    expect(read.code.continuation).toBe(true);
    expect(read.answers["owner.continued_from"].value).toBe("7");
    expect(read.inked["owner.owner_name"]).toBeUndefined();
  });

  it("refuses a page without a valid code strip", () => {
    expect(readFlatSheet(createGray(PAGE.width * 8, PAGE.height * 8, 250))).toBeNull();
  });
});

describe("locateAndRead", () => {
  it.each([0, 90, 180, 270] as const)("finds and straightens a photo turned %i°", (turn) => {
    const found = locateAndRead(photograph(filled, turn));
    expect(found?.read.code).toEqual(code);
    expect(found?.read.answers["pet0.vaccination"].value).toBe("2ND");
    expect(found?.read.answers["pet0.registered"].value).toBe("2024");
    expect(found?.sheet.width).toBe(PAGE.width * 8);
  });

  it("returns null for a photo without the markers", () => {
    expect(locateAndRead(createGray(1200, 1600, 230))).toBeNull();
  });
});

describe("handwritingOnly", () => {
  it("keeps the letter boxes' insides and drops everything else", () => {
    const clean = handwritingOnly(filled, false);
    const at = (x: number, y: number) => clean.data[Math.round(y * 8) * clean.width + Math.round(x * 8)];
    const first = CENSUS_LAYOUT.owner[0].rows[0][0];
    expect(at(first.x + first.width / 2, first.y + first.height / 2)).toBeLessThan(100);
    expect(at(CENSUS_LAYOUT.markers[0].x + 4, CENSUS_LAYOUT.markers[0].y + 4)).toBe(255);
  });
});
