/**
 * Excel Table Detection Tests
 * Real workbooks through the reader and detector: simple tables, several
 * worksheets (hidden ones too), several tables on one sheet, merged headers
 * and merged data cells, formulas (saved, missing and error results), blank
 * rows inside a table, an irregular report (title, notes, Total row), Excel
 * defined tables, manual ranges, and warnings for charts and pictures.
 */

import { describe, expect, it } from "vitest";

import { buildDatasetContent } from "@/core/processing/dataset-transformer";
import { parseXlsx } from "@/core/processing/parsers/xlsx.parser";
import type { ParseInput } from "@/core/processing/processing.service";
import { drawingXml, excelTableXml, withSheetParts, workbookBytes, type TestSheet } from "@/test/workbooks";
import type { WorkspaceFile } from "@/types/domain";
import type { TableSelection } from "@/types/processing";

import { columnLetter, formatRange, parseRange } from "./cell-range";
import { describeTable, detectTables, extractTable } from "./table-detection";
import { sheetWarnings } from "./sheet-warnings";
import { readWorkbook } from "./workbook-reader";

const read = (bytes: Uint8Array) => readWorkbook(new Blob([bytes as Uint8Array<ArrayBuffer>]), "book.xlsx");
const ranges = (sheet: Parameters<typeof detectTables>[0]) => detectTables(sheet).map((t) => formatRange(t.range));

async function sheetOf(sheet: TestSheet) {
  return (await read(workbookBytes([sheet]))).sheets[0];
}

describe("cell ranges", () => {
  it("converts between A1 notation and coordinates", () => {
    expect([columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(parseRange("g11:a2")).toEqual({ s: { r: 1, c: 0 }, e: { r: 10, c: 6 } });
    expect(formatRange(parseRange("$B$3:F20")!)).toBe("B3:F20");
    expect(parseRange("A0:B2")).toBeNull();
    expect(parseRange("hello")).toBeNull();
  });
});

describe("table detection", () => {
  it("finds a simple table with high confidence", async () => {
    const sheet = await sheetOf({ name: "Pets", rows: [["Name", "Pet", "Visits"], ["Ana", "Bantay", 3], ["Ben", "Choco", 1], ["Cara", "Ming", 5]] });
    const [table] = detectTables(sheet);
    expect(table).toMatchObject({ key: "Pets!A1:C4", headerRows: 1, confidence: "high", origin: "detected" });
    expect(table.stats).toMatchObject({ dataRows: 3, columns: 3 });
  });

  it("lists every worksheet with its visibility", async () => {
    const book = await read(
      workbookBytes([
        { name: "Barangay A", rows: [["Household", "Members"], ["Cruz", 4], ["Reyes", 2]] },
        { name: "Barangay B", rows: [["Household", "Members"], ["Lim", 6], ["Tan", 3]] },
        { name: "Lookup", rows: [["Code"], ["X"]], hidden: true },
      ]),
    );
    expect(book.sheets.map((s) => [s.name, s.visibility])).toEqual([
      ["Barangay A", "visible"],
      ["Barangay B", "visible"],
      ["Lookup", "hidden"],
    ]);
    expect(book.sheets.map((s) => ranges(s))).toEqual([["A1:B3"], ["A1:B3"], ["A1:A2"]]);
  });

  it("separates stacked and side-by-side tables, keeping their titles", async () => {
    const sheet = await sheetOf({
      name: "Report",
      rows: [
        ["Dogs", null, null, null, "Clinics"],
        ["Name", "Age", null, null, "Clinic", "Town"],
        ["Bantay", 3, null, null, "Vet Plus", "Poblacion"],
        ["Choco", 5, null, null, "Pet Care", "San Isidro"],
        [],
        [],
        ["Cats"],
        ["Name", "Age"],
        ["Ming", 2],
        ["Luna", 4],
      ],
    });
    const tables = detectTables(sheet);
    expect(tables.map((t) => [formatRange(t.range), t.title])).toEqual([
      ["A2:B4", "Dogs"],
      ["E2:F4", "Clinics"],
      ["A8:B10", "Cats"],
    ]);
    expect(tables.every((t) => t.headerRows === 1)).toBe(true);
  });

  it("combines a two-row header under merged cells and fills merged data down", async () => {
    const sheet = await sheetOf({
      name: "Sales",
      rows: [
        ["Region", "Q1", null, "Q2", null],
        [null, "Jan", "Feb", "Apr", "May"],
        ["North", 10, 12, 9, 11],
        [null, 8, 7, 6, 5],
        ["South", 4, 3, 2, 1],
      ],
      merges: ["B1:C1", "D1:E1", "A1:A2", "A3:A4"],
    });
    const [table] = detectTables(sheet);
    expect(table).toMatchObject({ headerRows: 2, confidence: "medium" });
    expect(table.reasons).toContain("Header spans 2 rows (names are combined)");

    const extracted = extractTable(sheet, { sheet: "Sales", range: formatRange(table.range), headerRows: 2 });
    expect(extracted.rows).toEqual([
      ["Region", "Q1 Jan", "Q1 Feb", "Q2 Apr", "Q2 May"],
      ["North", "10", "12", "9", "11"],
      ["North", "8", "7", "6", "5"],
      ["South", "4", "3", "2", "1"],
    ]);
    expect(extracted.firstRowNumber).toBe(2);
  });

  it("uses saved formula results and reports formulas Excel never calculated", async () => {
    const sheet = await sheetOf({
      name: "Budget",
      rows: [["Item", "Cost"], ["Food", 100], ["Rent", 400]],
      cells: {
        A4: { t: "s", v: "Fees" },
        B4: { t: "n", v: 50, f: "B2/2" },
        A5: { t: "s", v: "Tax" },
        B5: { t: "n", f: "B3*0.12" } as never,
        A6: { t: "s", v: "Ratio" },
        B6: { t: "e", v: 7, w: "#DIV/0!", f: "B2/0" },
      },
    });
    const [table] = detectTables(sheet);
    expect(table.stats).toMatchObject({ formulaCells: 3, uncalculated: 1, errors: 1 });
    expect(extractTable(sheet, { sheet: "Budget", range: "A1:B6", headerRows: 1 }).rows.slice(3)).toEqual([
      ["Fees", "50"],
      ["Tax", ""],
      ["Ratio", "#DIV/0!"],
    ]);
    const warnings = sheetWarnings(sheet).join(" ");
    expect(warnings).toMatch(/1 formula with no saved result/);
    expect(warnings).toMatch(/formula error/);
  });

  it("keeps a table together across a stray blank row", async () => {
    const sheet = await sheetOf({ name: "Log", rows: [["Date", "Count"], ["2026-10-01", 3], ["2026-10-02", 4], [], ["2026-10-04", 5]] });
    expect(ranges(sheet)).toEqual(["A1:B5"]);
  });

  it("reads an irregular report: title, notes and Total row are not records", async () => {
    const sheet = await sheetOf({
      name: "Monthly",
      rows: [
        ["Monthly Vaccination Report", null, null],
        ["Barangay Poblacion — October 2026"],
        [],
        ["Name", "Pet", "Doses"],
        ["Ana", "Bantay", 1],
        ["Ben", "Choco", 2],
        ["Cara", "Ming", 1],
        ["Total", null, 4],
        [],
        ["Prepared by: J. Cruz"],
      ],
      merges: ["A1:C1"],
    });
    const [table, ...rest] = detectTables(sheet);
    expect(rest).toEqual([]);
    expect(formatRange(table.range)).toBe("A4:C7");
    expect(table.reasons).toContain("Left out the Total row at the bottom");
  });

  it("uses Excel-defined tables as they are, without their totals row", async () => {
    const bytes = withSheetParts(workbookBytes([{ name: "Data", rows: [["Code", "Qty"], ["A", 1], ["B", 2], ["Total", 3]] }]), 1, [
      { type: "table", path: "xl/tables/table1.xml", xml: excelTableXml("A1:B4", "Stock", 1) },
    ]);
    const [table] = detectTables((await read(bytes)).sheets[0]);
    expect(table).toMatchObject({ origin: "excel-table", title: "Stock", confidence: "high", key: "Data!A1:B3" });
  });

  it("rates a headerless or tiny range low and names its columns by letter", async () => {
    const sheet = await sheetOf({ name: "Raw", rows: [[], [null, 1, 2], [null, 3, 4]] });
    const manual = describeTable(sheet, parseRange("B2:C3")!, 0, "manual");
    expect(manual.confidence).toBe("low");
    const extracted = extractTable(sheet, { sheet: "Raw", range: "B2:C3", headerRows: 0 });
    const content = buildDatasetContent([{ file: { id: "f", name: "raw.xlsx" }, extraction: { pages: [], tables: [extracted], warnings: [] } }]);
    expect(content.columns.map((c) => c.name)).toEqual(["Column B", "Column C"]);
    expect(content.rows.map((r) => r.source?.range)).toEqual(["B2:C2", "B3:C3"]);
  });

  it("warns about charts, pictures and shapes", async () => {
    const bytes = withSheetParts(workbookBytes([{ name: "Dashboard", rows: [["A", "B"], [1, 2]] }]), 1, [
      { type: "drawing", path: "xl/drawings/drawing1.xml", xml: drawingXml },
    ]);
    const [sheet] = (await read(bytes)).sheets;
    expect(sheet.objects).toEqual({ charts: 1, images: 1, shapes: 1, pivotTables: 0 });
    expect(sheetWarnings(sheet)[0]).toMatch(/1 chart, 1 picture, 1 shape or text box/);
  });
});

describe("Excel parser", () => {
  const input = (bytes: Uint8Array, tables?: TableSelection[]): ParseInput => ({
    file: { id: "f1", name: "census.xlsx" } as WorkspaceFile,
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>]),
    tables,
  });
  const context = { signal: new AbortController().signal, onProgress: () => undefined };
  const book = workbookBytes([
    { name: "A", rows: [["Household", "Members"], ["Cruz", 4], ["Reyes", 2]] },
    { name: "B", rows: [["Household", "Members"], ["Lim", 6], ["Tan", 3]] },
    { name: "Hidden", rows: [["x", "y"], [1, 2], [3, 4]], hidden: true },
  ]);

  it("reads every detected table on visible sheets by default", async () => {
    const result = await parseXlsx(input(book), context);
    expect(result.tables.map((t) => [t.sheet, t.range])).toEqual([
      ["A", "A1:B3"],
      ["B", "A1:B3"],
    ]);
  });

  it("reads only the confirmed tables, with sheet and cell references on every row", async () => {
    const result = await parseXlsx(input(book, [{ sheet: "B", range: "A1:B2", headerRows: 1 }]), context);
    const content = buildDatasetContent([{ file: { id: "f1", name: "census.xlsx" }, extraction: result }]);
    expect(content.rows).toHaveLength(1);
    expect(content.rows[0].source).toEqual({ fileId: "f1", page: null, sheet: "B", row: 2, range: "A2:B2" });
  });

  it("rejects an invalid confirmed range clearly", async () => {
    await expect(parseXlsx(input(book, [{ sheet: "A", range: "nope", headerRows: 1 }]), context)).rejects.toThrow(/A nope: Enter a range like A2:G11/);
  });
});
