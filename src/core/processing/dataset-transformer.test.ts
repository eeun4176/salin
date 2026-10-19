/**
 * Dataset Transformer Tests
 * Tables become columns and rows (merged across documents by header name,
 * with source references, then typed); text-only documents become one row
 * per line.
 */

import { describe, expect, it } from "vitest";

import type { ExtractedContent, ExtractedTable } from "@/types/processing";

import { buildDatasetContent, type TransformSource } from "./dataset-transformer";

const table = (rows: string[][], extra: Partial<ExtractedTable> = {}): ExtractedTable => ({
  name: "Sheet1",
  sheet: "Sheet1",
  page: null,
  rows,
  firstRowNumber: 1,
  ...extra,
});

const source = (id: string, extraction: Partial<ExtractedContent>): TransformSource => ({
  file: { id, name: `${id}.csv` },
  extraction: { pages: [], tables: [], warnings: [], ...extraction },
});

/** Rows as plain objects keyed by column name, for readable assertions. */
function byName(result: ReturnType<typeof buildDatasetContent>) {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((c) => [c.name, row.values[c.id]])));
}

describe("buildDatasetContent", () => {
  it("uses the first table row as headers and keeps source references", () => {
    const result = buildDatasetContent([
      source("f1", { tables: [table([["Name", "Pet"], [" Ana ", "Bantay"], ["", ""], ["Ben", ""]], { firstRowNumber: 3 })] }),
    ]);
    expect(result.columns.map((c) => [c.name, c.type, c.sourceHeader])).toEqual([
      ["Name", "text", "Name"],
      ["Pet", "text", "Pet"],
    ]);
    expect(byName(result)).toEqual([
      { Name: "Ana", Pet: "Bantay" },
      { Name: "Ben", Pet: null },
    ]);
    // Header is source row 3, so data starts at row 4; the blank row 5 is skipped.
    expect(result.rows.map((r) => r.source)).toEqual([
      { fileId: "f1", page: null, sheet: "Sheet1", row: 4, range: null },
      { fileId: "f1", page: null, sheet: "Sheet1", row: 6, range: null },
    ]);
  });

  it("names blank and repeated headers, and covers ragged rows", () => {
    const result = buildDatasetContent([source("f1", { tables: [table([["Name", "", "Name"], ["a", "b", "c", "d"]])] })]);
    expect(result.columns.map((c) => c.name)).toEqual(["Name", "Column 2", "Name (2)", "Column 4"]);
    expect(byName(result)).toEqual([{ Name: "a", "Column 2": "b", "Name (2)": "c", "Column 4": "d" }]);
  });

  it("merges tables from several documents by header name", () => {
    const result = buildDatasetContent([
      source("f1", { tables: [table([["Name", "Pet"], ["Ana", "Bantay"]])] }),
      source("f2", { tables: [table([["pet", "Owner Age"], ["Choco", "41"]])] }),
    ]);
    expect(result.columns.map((c) => [c.name, c.type])).toEqual([
      ["Name", "text"],
      ["Pet", "text"],
      ["Owner Age", "number"],
    ]);
    expect(byName(result)).toEqual([
      { Name: "Ana", Pet: "Bantay", "Owner Age": undefined },
      { Name: undefined, Pet: "Choco", "Owner Age": 41 },
    ]);
    expect(result.rows[1].source?.fileId).toBe("f2");
  });

  it("falls back to one row per line of text", () => {
    const result = buildDatasetContent([
      source("f1", { pages: [{ number: 1, text: "Census Form\n\n  Ana Cruz  " }, { number: 2, text: "Signed" }] }),
    ]);
    expect(result.columns.map((c) => c.name)).toEqual(["Text"]);
    expect(byName(result)).toEqual([{ Text: "Census Form" }, { Text: "Ana Cruz" }, { Text: "Signed" }]);
    expect(result.rows.map((r) => [r.source?.page, r.source?.row])).toEqual([
      [1, 1],
      [1, 3],
      [2, 1],
    ]);
  });

  it("returns no rows when nothing was extracted", () => {
    expect(buildDatasetContent([source("f1", { pages: [{ number: 1, text: "  \n" }] })]).rows).toEqual([]);
  });
});
