/**
 * Requested Column Tests
 * Turning "Name, Address" into a template with only those columns, guessing
 * one-record-per-page vs a list, offering labels already found on the page,
 * and filling a list by position when its headings don't match — with the
 * built-in "doesn't look like" warnings left out.
 */

import { describe, expect, it } from "vitest";

import { analyzeLayout } from "@/core/ocr/layout/layout-analysis";
import { extractDocument, type MappingPage } from "@/core/ocr/templates/field-mapping";
import { extractRequested, foundLabels, guessShape, parseColumnList, requestedColumns, requestedTemplate } from "@/core/ocr/templates/requested-columns";
import { emptyMarks, line, pageResult } from "@/test/ocr-fixtures";
import type { OcrLine } from "@/types/ocr";

function page(n: number, lines: OcrLine[]): MappingPage {
  return { page: n, width: 1000, height: 1400, result: pageResult(lines), layout: analyzeLayout({ width: 1000, height: 1400, lines, marks: emptyMarks() }) };
}

const form = page(1, [line(100, [[100, "Name: Juan Dela Cruz"]]), line(150, [[100, "Address: Purok 2, Poblacion"]]), line(200, [[100, "Religion: None"]])]);
const list = (header: boolean) =>
  page(1, [
    ...(header ? [line(100, [[100, "Name"], [400, "Barangay"], [700, "Age"]])] : []),
    line(150, [[100, "Ana Cruz"], [400, "Muzon"], [700, "25"]]),
    line(190, [[100, "Ben Ramos"], [400, "Poblacion"], [700, "31"]]),
  ]);

describe("requested columns", () => {
  it("reads a typed list without repeats or blanks", () => {
    expect(parseColumnList(" Name, address;\nNAME,, Birthday ")).toEqual(["Name", "address", "Birthday"]);
    expect(parseColumnList(Array.from({ length: 30 }, (_, i) => `C${i}`).join(","))).toHaveLength(20);
  });

  it("makes a form or list template with only those columns, in order", () => {
    const formTemplate = requestedTemplate("asked-1", ["Name", "name!", "Address"], "form");
    expect(formTemplate.fields.map((f) => f.key)).toEqual(["name", "name_2", "address"]);
    expect(requestedColumns(formTemplate)).toEqual(["Name", "name!", "Address"]);
    const listTemplate = requestedTemplate("asked-2", ["Name", "Age"], "table");
    expect(listTemplate).toMatchObject({ kind: "table", fields: [], tables: [{ minMatched: 1 }] });
    expect(requestedColumns(listTemplate)).toEqual(["Name", "Age"]);
  });

  it("fills only the asked fields, without the built-in 'doesn't look like' warnings", () => {
    const extraction = extractRequested(requestedTemplate("asked-1", ["Name", "Address", "Birthday"], "form"), [form]);
    expect(extraction.forms[0].fields.map((f) => [f.label, f.value.text])).toEqual([
      ["Name", "Juan Dela Cruz"],
      ["Address", "Purok 2, Poblacion"],
      ["Birthday", ""],
    ]);
    expect(extraction.unsupported).toBeNull();
    const nothing = extractRequested(requestedTemplate("asked-1", ["Pet", "Breed"], "form"), [form]);
    expect(nothing.unsupported).toBeNull();
    expect(nothing.warnings.join(" ")).not.toMatch(/look like/);
  });

  it("matches a list by its headings, or fills it by position when they don't match", () => {
    const byHeading = extractRequested(requestedTemplate("asked-2", ["Age", "Name"], "table"), [list(true)]);
    expect(byHeading.tables[0].rows.map((r) => [r.cells.age.text, r.cells.name.text])).toEqual([
      ["25", "Ana Cruz"],
      ["31", "Ben Ramos"],
    ]);
    const byPosition = extractRequested(requestedTemplate("asked-2", ["Owner", "Place"], "table"), [list(false)]);
    expect(byPosition.tables[0].rows.map((r) => [r.cells.owner.text, r.cells.place.text])).toEqual([
      ["Ana Cruz", "Muzon"],
      ["Ben Ramos", "Poblacion"],
    ]);
    expect(byPosition.warnings.join(" ")).toMatch(/order they appear/);
    expect(extractRequested(requestedTemplate("asked-2", ["Owner"], "table"), [form]).unsupported).toMatch(/Redraw table area/);
  });

  it("guesses the shape and offers the labels already found", () => {
    expect(guessShape(extractDocument(null, [list(true)]))).toBe("table");
    expect(guessShape(extractDocument(null, [form]))).toBe("form");
    expect(guessShape(null)).toBe("form");
    expect(foundLabels(extractDocument(null, [form]))).toEqual(["Name", "Address", "Religion"]);
    expect(foundLabels(extractDocument(null, [list(true)]))).toEqual(["Name", "Barangay", "Age"]);
  });
});
