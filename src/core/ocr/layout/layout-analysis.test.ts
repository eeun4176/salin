/**
 * Layout Analysis Tests
 * Synthetic pages check that labels and values, fill-in lines, checkbox
 * choices, aligned tables (with wrapped rows), ruled tables (with merged
 * cells and several records per band), headings, two-column text,
 * decorative frames, empty grids and overlapping marks are recognised —
 * and that blank cells stay blank.
 */

import { describe, expect, it } from "vitest";

import { analyzeLayout } from "@/core/ocr/layout/layout-analysis";
import { checkbox, emptyMarks, hLine, line, vLine } from "@/test/ocr-fixtures";

const W = 1000;
const H = 1400;

describe("fields", () => {
  it("reads 'Label: value' pairs, several per line, and blank fields over a fill-in line", () => {
    const layout = analyzeLayout({
      width: W,
      height: H,
      lines: [
        line(100, [[100, "Owner's Name: Juan Dela Cruz"], [600, "Age: 5"]]),
        line(160, [[100, "Date of Birth: 01/02/2020 Breed: Aspin"]]),
        line(220, [[100, "Contact No.:"]]),
      ],
      marks: emptyMarks({ horizontal: [hLine(240, 241, 300)] }),
    });
    const kv = Object.fromEntries(layout.keyValues.map((k) => [k.label, k.value]));
    expect(kv).toEqual({ "Owner's Name": "Juan Dela Cruz", Age: "5", "Date of Birth": "01/02/2020", Breed: "Aspin", "Contact No.": "" });
    // The blank field still knows where its value would be (above the line).
    expect(layout.keyValues.find((k) => k.label === "Contact No.")?.valueBox).not.toBeNull();
  });

  it("turns ticked checkboxes into the field's value and keeps their labels", () => {
    const layout = analyzeLayout({
      width: W,
      height: H,
      lines: [line(300, [[100, "Species:"], [230, "Dog"], [330, "Cat"]])],
      marks: emptyMarks({ checkboxes: [checkbox(205, 301, "unchecked"), checkbox(305, 301, "checked")] }),
    });
    expect(layout.checkboxes.map((c) => [c.label, c.state])).toEqual([
      ["Dog", "unchecked"],
      ["Cat", "checked"],
    ]);
    expect(layout.keyValues).toEqual([expect.objectContaining({ label: "Species", value: "Cat" })]);
  });
});

describe("tables", () => {
  it("rebuilds an unruled table from aligned columns, joining wrapped rows and keeping blank cells blank", () => {
    const layout = analyzeLayout({
      width: W,
      height: H,
      lines: [
        line(400, [[100, "Owner"], [400, "Pet"], [600, "Species"], [800, "Age"]]),
        line(440, [[100, "Ana Cruz"], [400, "Bantay"], [600, "Dog"], [800, "3"]]),
        line(480, [[100, "Ben Reyes"], [400, "Ming"], [600, "Cat"]]),
        line(503, [[400, "(stray)"]]),
        line(540, [[100, "Cara Lim"], [400, "Choco"], [600, "Dog"], [800, "1"]]),
      ],
      marks: emptyMarks(),
    });
    expect(layout.tables).toHaveLength(1);
    const table = layout.tables[0];
    expect(table.source).toBe("aligned");
    expect(table.headerRows).toBe(1);
    expect(table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ["Owner", "Pet", "Species", "Age"],
      ["Ana Cruz", "Bantay", "Dog", "3"],
      ["Ben Reyes", "Ming (stray)", "Cat", ""],
      ["Cara Lim", "Choco", "Dog", "1"],
    ]);
    expect(table.rows[2].cells[3].confidence).toBeNull();
  });

  it("reads a ruled grid, merging cells where a column line is missing and splitting unruled bands into records", () => {
    const top = 300;
    const marks = emptyMarks({
      // Rows: header band, then one band holding two records (no line between them), then a third record.
      horizontal: [hLine(100, top, 600), hLine(100, top + 50, 600), hLine(100, top + 150, 600), hLine(100, top + 200, 600)],
      // Column lines; the one at x=500 stops after the header band (merged cell in the last row is tested via the band split).
      vertical: [vLine(100, top, 200), vLine(300, top, 200), vLine(500, top, 200), vLine(700, top, 200)],
    });
    const layout = analyzeLayout({
      width: W,
      height: H,
      lines: [
        line(top + 15, [[110, "Owner"], [310, "Pet"], [510, "Vaccinated"]]),
        line(top + 65, [[110, "Ana"], [310, "Bantay"], [510, "Yes"]]),
        line(top + 110, [[110, "Ben"], [310, "Ming"]]),
        line(top + 165, [[110, "All checked"]]),
      ],
      marks,
    });
    const table = layout.tables[0];
    expect(table.source).toBe("ruled");
    expect(table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ["Owner", "Pet", "Vaccinated"],
      ["Ana", "Bantay", "Yes"],
      ["Ben", "Ming", ""],
      ["All checked", "", ""],
    ]);

    // Without the column line in the last band, its cells are merged.
    const merged = analyzeLayout({
      width: W,
      height: H,
      lines: [line(top + 15, [[110, "Owner"], [310, "Pet"], [510, "Vaccinated"]]), line(top + 65, [[110, "Ana"], [310, "Bantay"], [510, "Yes"]]), line(top + 165, [[110, "Remarks:"], [310, "all"], [510, "checked"]])],
      marks: emptyMarks({ ...marks, vertical: [vLine(100, top, 200), vLine(300, top, 150), vLine(500, top, 200), vLine(700, top, 200)] }),
    });
    const last = merged.tables[0].rows.at(-1)!;
    expect(last.cells[0]).toMatchObject({ text: "Remarks: all", merged: true });
    expect(last.cells[1]).toMatchObject({ text: "", merged: true });
  });

  it("ignores a decorative page frame and reports an empty grid instead of extracting it", () => {
    const layout = analyzeLayout({
      width: W,
      height: H,
      lines: [line(100, [[200, "Certificate of Vaccination"]])],
      marks: emptyMarks({
        vertical: [vLine(20, 20, 1360), vLine(978, 20, 1360), vLine(100, 600, 200), vLine(300, 600, 200), vLine(500, 600, 200)],
        horizontal: [hLine(20, 20, 960), hLine(20, 1378, 960), hLine(100, 600, 402), hLine(100, 700, 402), hLine(100, 798, 402)],
      }),
    });
    expect(layout.tables).toHaveLength(0);
    expect(layout.issues.map((i) => i.kind).sort()).toEqual(["decorative", "empty-table"]);
  });
});

describe("text", () => {
  it("finds headings and reads two-column pages column by column", () => {
    // Running text: each column's lines are about 35% of the page wide.
    const left = (y: number, text: string) => line(y, [[60, `${text} of the left column text`]]);
    const right = (y: number, text: string) => line(y, [[560, `${text} of the right column text`]]);
    const heading = line(40, [[300, "CITY VETERINARY OFFICE"]]);
    const layout = analyzeLayout({
      width: W,
      height: H,
      lines: [heading, left(200, "left one"), right(200, "right one"), left(240, "left two"), right(240, "right two"), left(280, "left three"), right(280, "right three")],
      marks: emptyMarks(),
    });
    expect(layout.headings.map((h) => h.text)).toEqual(["CITY VETERINARY OFFICE"]);
    expect(layout.columns).toBe(2);
    expect(layout.text.map((t) => t.text.split(" of ")[0])).toEqual(["left one", "left two", "left three", "right one", "right two", "right three"]);
    expect(layout.tables).toHaveLength(0);
  });

  it("flags overlapping marks and hard-to-read words", () => {
    const stamp = line(205, [[110, "RECEIVED", 30]]);
    const layout = analyzeLayout({ width: W, height: H, lines: [line(200, [[100, "Signature over printed name"]]), stamp], marks: emptyMarks() });
    expect(layout.issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["overlap", "low-confidence"]));
  });

  it("returns an empty layout for a page with no words", () => {
    expect(analyzeLayout({ width: W, height: H, lines: [], marks: null })).toMatchObject({ tables: [], keyValues: [], text: [] });
  });
});
