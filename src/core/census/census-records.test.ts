/**
 * Census Extraction & Records Tests
 * From a read sheet to records: capitals with spaces from empty letter
 * boxes, certain OMR answers as Validated, double ticks and unread writing
 * kept Pending/Unreadable, re-scans replacing their sheet's rows, and
 * continuation pets getting their owner once the main sheet is in.
 */

import { describe, expect, it } from "vitest";

import { CENSUS_LAYOUT } from "@/core/census/census-layout";
import { FORM_VERSION, type SheetCode } from "@/core/census/code-strip";
import { readFlatSheet, SHEET_SCALE } from "@/core/census/omr/read-sheet";
import { confirmValue } from "@/core/ocr/review/review-state";
import { drawSheet, type SheetFill } from "@/test/census-fixtures";
import type { OcrLine } from "@/types/ocr";

import { censusExtraction, letterBoxText } from "./census-extraction";
import { censusDatasetName, censusGroups, COLUMN, mergeCensusContent } from "./census-records";

const code: SheetCode = { version: FORM_VERSION, continuation: false, barangay: 6, censusDate: "2026-10-22", sheetNumber: 7 };
const pages = [{ page: 1, fileId: "f1", pdfPage: null, width: 216 * SHEET_SCALE, height: 330 * SHEET_SCALE }];

/** OCR "words" sitting in the first row of a letter-box field. */
function word(fieldKey: string, slot: number | null, text: string, from: number, to: number, confidence = 90): OcrLine {
  const field = slot === null ? CENSUS_LAYOUT.owner.find((f) => f.key === fieldKey)! : CENSUS_LAYOUT.pets[slot].writeIns.find((f) => f.key === fieldKey)!;
  const a = field.rows[0][from];
  const b = field.rows[0][to];
  const box = { x: a.x * SHEET_SCALE, y: a.y * SHEET_SCALE, width: (b.x + b.width - a.x) * SHEET_SCALE, height: a.height * SHEET_SCALE };
  return { text, confidence, box, block: 0, words: [{ text, confidence, box, unclear: "" }] };
}

const pet0 = { "pet0.type": "DOG", "pet0.sex": "MALE", "pet0.sterilized": "NO", "pet0.vaccination": "1ST", "pet0.age_years": "2" };

function scan(fill: SheetFill, lines: OcrLine[]) {
  const read = readFlatSheet(drawSheet(fill))!;
  return censusExtraction([{ page: 1, read, lines }]);
}

describe("letterBoxText", () => {
  it("puts spaces where letter boxes were left empty, in capitals", () => {
    const inked = [true, true, true, true, false, true, true, true, true, false, true, true, true, true];
    expect(letterBoxText(["juan", "dela", "cruz"], inked, false)).toBe("JUAN DELA CRUZ");
    expect(letterBoxText(["JUANDELA", "CRUZ"], inked, false)).toBe("JUAN DELA CRUZ");
    // Letters and boxes disagree: keep the recognised words as they are.
    expect(letterBoxText(["JUAN", "D3LA!"], inked, false)).toBe("JUAN D3LA");
    expect(letterBoxText(["O9I7-555-I234"], [], true)).toBe("09175551234");
  });
});

describe("censusExtraction", () => {
  it("reads the sheet fields from the code strip and the answers from the boxes", () => {
    const extraction = scan(
      { code, answers: { ...pet0, "pet1.type": ["DOG", "CAT"], "pet1.sex": "FEMALE" }, writing: { "owner.owner_name": [0, 1, 2, 3, 5, 6, 7, 8], "pet0.pet_name": [0, 1, 2, 3, 4, 5] }, emptySlots: [2] },
      [word("owner_name", null, "JUAN", 0, 3), word("owner_name", null, "DELA", 5, 8), word("pet_name", 0, "BANTAY", 0, 5)],
    );
    const form = extraction.forms[0].fields;
    expect(form.map((f) => [f.key, f.value.text])).toEqual([
      ["barangay", "Gumaok East"],
      ["census_date", "10/22/2026"],
      ["sheet_no", "7"],
      ["owner_name", "JUAN DELA"],
      ["address", ""],
      ["contact", ""],
    ]);
    const [first, second] = extraction.tables[0].rows;
    expect(extraction.tables[0].rows).toHaveLength(2);
    expect([first.cells.pet_name.text, first.cells.type.text, first.cells.sex.text, first.cells.vaccination.text, first.cells.age_years.text]).toEqual(["BANTAY", "Dog", "Male", "1st", "2"]);
    expect(second.cells.type).toMatchObject({ text: "", flags: ["multiple-marks"] });
    expect(first.cells.type.box).not.toBeNull();
  });

  it("flags writing that couldn't be read, and says when a slot is blank", () => {
    const extraction = scan({ code, answers: pet0, writing: { "owner.owner_name": [0, 1, 2] } }, []);
    expect(extraction.forms[0].fields.find((f) => f.key === "owner_name")!.value.flags).toContain("illegible");
    expect(extraction.tables[0].rows).toHaveLength(1);
    expect(extraction.warnings).toEqual(expect.arrayContaining([expect.stringContaining("pet 2 is blank")]));
  });
});

describe("census records", () => {
  const value = (content: ReturnType<typeof censusGroups>[number]["content"], row: number, column: string) => content.rows[row].values[content.columns.find((c) => c.name === column)!.id];

  it("validates certain rows only, and confirmed values count as checked", () => {
    const extraction = scan(
      { code, answers: { ...pet0, "pet1.type": ["DOG", "CAT"], "pet1.sex": "FEMALE" }, writing: { "owner.owner_name": [0, 1, 2, 3] } },
      [word("owner_name", null, "JUAN", 0, 3)],
    );
    let [group] = censusGroups(extraction, "doc1", pages);
    expect([group.barangay, group.censusDate, group.sheetNumbers]).toEqual(["Gumaok East", "2026-10-22", [7]]);
    expect(censusDatasetName(group.barangay, group.censusDate)).toBe("Census · Gumaok East · Oct 22, 2026");
    expect(value(group.content, 0, COLUMN.status)).toBe("Validated");
    expect(value(group.content, 1, COLUMN.status)).toBe("Unreadable");
    expect(value(group.content, 1, COLUMN.notes)).toContain("Type of pet: Unreadable");
    expect(group.content.rows[0].source?.ocr?.cells).not.toEqual({});

    // A read word below full confidence needs a look until the reviewer confirms it.
    const unsure = scan({ code, answers: pet0, writing: { "owner.owner_name": [0, 1, 2, 3] } }, [word("owner_name", null, "JUAN", 0, 3, 60)]);
    [group] = censusGroups(unsure, "doc1", pages);
    expect(value(group.content, 0, COLUMN.status)).toBe("Pending");
    [group] = censusGroups(confirmValue(unsure, { kind: "form", group: 0, id: "owner_name" }), "doc1", pages);
    expect(value(group.content, 0, COLUMN.status)).toBe("Validated");
  });

  it("replaces a re-scanned sheet's rows and fills continuation owners from the main sheet", () => {
    const main = censusGroups(scan({ code, answers: pet0, writing: { "owner.owner_name": [0, 1, 2, 3] } }, [word("owner_name", null, "JUAN", 0, 3)]), "doc1", pages)[0].content;
    const continuation = censusGroups(
      scan({ code: { ...code, continuation: true, sheetNumber: 8 }, answers: { "owner.continued_from": "7", ...pet0 } }, []),
      "doc2",
      pages,
    )[0].content;

    // Continuation first: it waits for its main sheet.
    let merged = mergeCensusContent(null, continuation);
    expect(value(merged, 0, COLUMN.status)).toBe("Pending");
    expect(value(merged, 0, COLUMN.notes)).toContain("Main sheet 7 isn't scanned yet");

    merged = mergeCensusContent(merged, main);
    expect(merged.rows.map((_, i) => [value(merged, i, COLUMN.sheet), value(merged, i, COLUMN.pet), value(merged, i, COLUMN.owner), value(merged, i, COLUMN.status)])).toEqual([
      [7, 1, "JUAN", "Validated"],
      [8, 4, "JUAN", "Validated"],
    ]);

    // Scanning sheet 7 again replaces its row instead of adding a second one.
    merged = mergeCensusContent(merged, main);
    expect(merged.rows).toHaveLength(2);
  });
});
