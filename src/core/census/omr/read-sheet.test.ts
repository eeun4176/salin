/**
 * Census Sheet Reader Tests
 * Synthetic sheets drawn from the layout, photographed at an angle and in
 * every orientation: the code strip, ticks, bubbles, double ticks, faint
 * marks, empty slots and inked letter boxes read back as filled in — and a
 * page that isn't a census sheet is refused. v2 and v3 sheets read with
 * their own layouts.
 */

import { describe, expect, it } from "vitest";

import { layoutFor, PAGE } from "@/core/census/census-layout";
import type { SheetCode } from "@/core/census/code-strip";
import { createGray } from "@/core/ocr/imaging/pixels";
import { bend, drawSheet, photograph } from "@/test/census-fixtures";

import { handwritingOnly, locateAndRead, readFlatSheet } from "./read-sheet";

const CENSUS_LAYOUT = layoutFor(1);
const code: SheetCode = { version: 1, continuation: false, barangay: 6, censusDate: "2026-10-22", sheetNumber: 7 };

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

  it("leaves double ticks, faint marks and blanks for the reviewer", () => {
    const read = readFlatSheet(filled)!;
    expect(read.answers["pet1.type"]).toMatchObject({ value: null, state: "multiple", marked: ["DOG", "CAT"] });
    // The only mark in the group, but light: offered as the answer, for a person to check.
    expect(read.answers["pet1.sex"]).toMatchObject({ value: "MALE", state: "faint" });
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

  it("still finds corner squares split by a thin printer or scanner line", () => {
    const split = drawSheet({ code, answers: { "pet0.type": "DOG" } });
    const bottom = CENSUS_LAYOUT.markers[2];
    const y = Math.round((bottom.y + bottom.height * 0.45) * 8);
    for (let row = y; row < y + 5; row++) split.data.fill(250, row * split.width, (row + 1) * split.width);
    expect(locateAndRead(photograph(split))?.read.code).toEqual(code);
  });

  it("returns null for a photo without the markers", () => {
    expect(locateAndRead(createGray(1200, 1600, 230))).toBeNull();
  });
});

describe("handwritingOnly", () => {
  it("keeps the letter boxes' insides and drops everything else", () => {
    const clean = handwritingOnly(filled, readFlatSheet(filled)!);
    const at = (x: number, y: number) => clean.data[Math.round(y * 8) * clean.width + Math.round(x * 8)];
    const first = CENSUS_LAYOUT.owner[0].rows[0][0];
    expect(at(first.x + first.width / 2, first.y + first.height / 2)).toBeLessThan(100);
    expect(at(CENSUS_LAYOUT.markers[0].x + 4, CENSUS_LAYOUT.markers[0].y + 4)).toBe(255);
  });
});

describe("v2 sheets", () => {
  const v2: SheetCode = { ...code, version: 2 };
  const sheet = drawSheet({
    code: v2,
    answers: { "pet0.type": "CAT", "pet0.age_years": "15", "pet0.age_months": "3", "pet0.color": "BROWN", "pet0.registered": "YEAR-2" },
    writing: { "owner.owner_name": [0, 1, 2, 3, 5, 6, 7, 8], "owner.contact": [0, 1, 2], "pet0.pet_name": [0, 1, 2] },
  });

  it("reads with the v2 layout: one-row age, color and year tick boxes, open writing lines", () => {
    const found = locateAndRead(photograph(sheet, 90))!;
    expect(found.read.code).toEqual(v2);
    const value = (key: string) => found.read.answers[key].value;
    expect([value("pet0.type"), value("pet0.age_years"), value("pet0.age_months"), value("pet0.color"), value("pet0.registered")]).toEqual(["CAT", "15", "3", "BROWN", "YEAR-2"]);
    // An open line is one box: written or not. The contact number keeps its 11 boxes.
    expect(found.read.inked["owner.owner_name"]).toEqual([[true]]);
    expect(found.read.inked["owner.address"]).toEqual([[false], [false]]);
    expect(found.read.inked["owner.contact"][0].slice(0, 4)).toEqual([true, true, true, false]);
    expect(found.read.inked["pet0.remarks"]).toEqual([[false]]);
    // Evenly spaced letters are one word; the skipped position in the owner's name is the one gap between words.
    expect(found.read.writing?.["owner.owner_name"][0]?.gaps).toHaveLength(1);
    expect(found.read.writing?.["pet0.pet_name"][0]?.gaps).toEqual([]);
  });
});

describe("v3 sheets", () => {
  const v3: SheetCode = { ...code, version: 3 };
  const sheet = drawSheet({
    code: v3,
    answers: { "pet0.type": "DOG", "pet0.sex": "MALE", "pet0.classification": "SEMI-CONFINED", "pet0.vaccination": "BOOSTER", "pet0.laps": "NO", "pet0.age_years": "4", "pet0.color": "MIXED/SPOTTED", "pet0.registered": "EARLIER", "pet2.color": "OTHER" },
    faint: { "pet1.sterilized": "UNKNOWN" },
    writing: { "owner.address": [0, 1, 2], "pet0.remarks": [0, 1] },
  });

  it("reads the grid of tick boxes, the one-line address and the side-by-side lines", () => {
    const found = locateAndRead(photograph(sheet, 180))!;
    expect(found.read.code).toEqual(v3);
    const value = (key: string) => found.read.answers[key].value;
    expect(["type", "sex", "classification", "vaccination", "laps", "age_years", "color", "registered"].map((k) => value(`pet0.${k}`))).toEqual(["DOG", "MALE", "SEMI-CONFINED", "BOOSTER", "NO", "4", "MIXED/SPOTTED", "EARLIER"]);
    expect(value("pet2.color")).toBe("OTHER");
    expect(found.read.answers["pet1.sterilized"]).toMatchObject({ value: "UNKNOWN", state: "faint" });
    expect(found.read.inked["owner.address"]).toEqual([[true]]);
    expect([found.read.inked["pet0.other_vaccines"], found.read.inked["pet0.remarks"]]).toEqual([[[false]], [[true]]]);
  });

  // A real printed sheet: category names sit just above each row and a grid line just below it, and paravets tick with one thin "/".
  const ticked = {
    "pet0.type": "DOG", "pet0.sex": "FEMALE", "pet0.sterilized": "NO", "pet0.breed": "PURE", "pet0.classification": "SEMI-CONFINED",
    "pet0.vaccination": "1ST", "pet0.laps": "NO", "pet0.color": "BROWN", "pet0.registered": "YEAR-5",
    "pet1.type": "CAT", "pet1.sex": "MALE", "pet1.sterilized": "YES", "pet1.breed": "MIX", "pet1.classification": "CONFINED",
    "pet1.vaccination": "1ST", "pet1.laps": "YES", "pet1.color": "WHITE", "pet1.registered": "YEAR-0",
  };
  const printed = drawSheet({ code: v3, answers: ticked, printed: true, tickStyle: "slash" });

  it.each([
    ["sharp", 0.04, 0, 0],
    ["at a steeper angle", 0.08, 0, 0],
    ["slightly out of focus", 0.04, 2, 0],
    // The middle of the page bows 1.5 mm: rows tilt a millimetre end to end, so each box finds its own outline.
    ["on paper that isn't flat", 0.04, 0, 1.5],
  ] as const)("reads thin slash ticks on a printed sheet, %s, without pulling boxes onto labels or grid lines", (_, tilt, soft, bow) => {
    const { read } = locateAndRead(photograph(bow ? bend(printed, bow) : printed, 0, tilt, soft))!;
    for (const [key, value] of Object.entries(ticked)) expect(read.answers[key], key).toMatchObject({ value, state: "answered" });
    // The empty third pet stays blank, row by row, rather than "unclear".
    for (const key of ["type", "sex", "sterilized", "laps", "color"]) expect(read.answers[`pet2.${key}`].state, key).toBe("unanswered");
  }, 30_000);
});
