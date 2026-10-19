/**
 * Dataset Export Tests
 * CSV, Excel and JSON exports keep headers, Unicode and typed values, can be
 * read back by Salin's own parsers (round trip), and CSV exports can't smuggle
 * spreadsheet formulas.
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import type { ParseInput } from "@/core/processing/processing.service";
import { content } from "@/test/fixtures";
import type { WorkspaceFile } from "@/types/domain";

import { exportDataset } from "./dataset-export";
import { parseCsv } from "./parsers/csv.parser";
import { parseXlsx } from "./parsers/xlsx.parser";

const asInput = (name: string, blob: Blob): ParseInput => ({ file: { id: "f", name } as WorkspaceFile, blob });
const context = { signal: new AbortController().signal, onProgress: () => undefined };

describe("dataset export", () => {
  it("writes CSV with a BOM that Salin's CSV parser reads back unchanged", async () => {
    const data = content(["Name", "Note"], [["林", 'comma, and "quotes"'], ["Ana", "café"]]);
    const blob = exportDataset({ name: "Animals", content: data }, "csv");
    expect(new Uint8Array(await blob.slice(0, 3).arrayBuffer())).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    const back = await parseCsv(asInput("back.csv", blob), context);
    expect(back.tables[0].rows).toEqual([["Name", "Note"], ["林", 'comma, and "quotes"'], ["Ana", "café"]]);
  });

  it("stops CSV cells from running as spreadsheet formulas", async () => {
    const data = content(["Formula"], [["=HYPERLINK(\"http://x\")"], ["+1"], ["@SUM(A1)"], ["plain"]]);
    // Blob.text() drops the BOM.
    const text = await exportDataset({ name: "Unsafe", content: data }, "csv").text();
    expect(text.split("\r\n")).toEqual(["Formula", `"'=HYPERLINK(""http://x"")"`, `"'+1"`, `"'@SUM(A1)"`, "plain"]);
  });

  it("writes Excel with typed numbers and yes/no values, named after the dataset", async () => {
    const data = content(["Name", "Count", "Active"], [["Ming", 4, true]]);
    const blob = exportDataset({ name: "Pets: 2026/10", content: data }, "xlsx");
    const book = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    expect(book.SheetNames).toEqual(["Pets  2026 10"]);
    expect(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 })).toEqual([["Name", "Count", "Active"], ["Ming", 4, true]]);
    const back = await parseXlsx(asInput("back.xlsx", blob), context);
    expect(back.tables[0].rows).toEqual([["Name", "Count", "Active"], ["Ming", "4", "TRUE"]]);
  });

  it("writes JSON keyed by column name, with types and source references", async () => {
    const data = content(["Name"], [["林"]]);
    data.rows[0].source = { fileId: "f1", page: 2, sheet: null, row: 4, range: null };
    const json = JSON.parse(await exportDataset({ name: "Pets", content: data, sourceNames: new Map([["f1", "form.pdf"]]) }, "json").text());
    expect(json).toMatchObject({
      format: "salin-dataset",
      name: "Pets",
      columns: [{ name: "Name", type: "text", required: false }],
      rows: [{ values: { Name: "林" }, source: { file: "form.pdf", page: 2, sheet: null, row: 4, range: null } }],
    });
  });
});
