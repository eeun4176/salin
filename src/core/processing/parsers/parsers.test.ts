/**
 * Document Parser Tests
 * Each local parser on real file contents: CSV (Unicode, quoting errors,
 * trailing newline), TXT (BOM, legacy encoding), XLSX (every sheet, damaged
 * or mislabeled files) and PDF (text lines per page, broken files).
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { ProcessingError } from "@/core/processing/processing-errors";
import type { ParseInput } from "@/core/processing/processing.service";
import { minimalPdf } from "@/test/minimal-pdf";
import type { WorkspaceFile } from "@/types/domain";

import { parseCsv } from "./csv.parser";
import { parsePdf } from "./pdf.parser";
import { parseText } from "./text.parser";
import { parseXlsx } from "./xlsx.parser";

function input(name: string, data: BlobPart): ParseInput {
  return { file: { id: "file-1", name, blobId: "blob-1" } as WorkspaceFile, blob: new Blob([data]) };
}

const context = () => ({ signal: new AbortController().signal, onProgress: () => undefined });

function workbook(sheets: Record<string, unknown[][]>) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("CSV parser", () => {
  it("reads rows with Unicode, quoted commas and a trailing newline", async () => {
    const result = await parseCsv(input("pets.csv", 'Name,Note\nAna,"Bantay, aspin"\n林,小咪\n'), context());
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows).toEqual([
      ["Name", "Note"],
      ["Ana", "Bantay, aspin"],
      ["林", "小咪"],
    ]);
  });

  it("rejects a quoted value that never closes", async () => {
    await expect(parseCsv(input("broken.csv", 'Name,Note\nAna,"unfinished'), context())).rejects.toThrow(/never closes/);
  });
});

describe("text parser", () => {
  it("drops a UTF-8 BOM and keeps the text", async () => {
    const result = await parseText(input("notes.txt", "﻿你好\nSalin"), context());
    expect(result.pages).toEqual([{ number: 1, text: "你好\nSalin" }]);
  });

  it("falls back to Windows-1252 for legacy files", async () => {
    const result = await parseText(input("legacy.txt", new Uint8Array([0x63, 0x61, 0x66, 0xe9])), context());
    expect(result.pages[0].text).toBe("café");
  });
});

describe("Excel parser", () => {
  it("reads every non-empty sheet as displayed text", async () => {
    const bytes = workbook({ Records: [["Name", "Count"], ["林", 3]], Empty: [], Later: [["Name"], ["Ben"]] });
    const result = await parseXlsx(input("records.xlsx", bytes), context());
    expect(result.tables.map((t) => [t.sheet, t.rows])).toEqual([
      ["Records", [["Name", "Count"], ["林", "3"]]],
      ["Later", [["Name"], ["Ben"]]],
    ]);
  });

  it("rejects damaged or mislabeled workbooks", async () => {
    await expect(parseXlsx(input("text.xlsx", "Name,Count"), context())).rejects.toBeInstanceOf(ProcessingError);
    await expect(parseXlsx(input("zip.xlsx", new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), context())).rejects.toThrow(/isn't a readable Excel workbook/);
  });
});

describe("PDF parser", () => {
  it("extracts each page's text as lines", async () => {
    const pdf = minimalPdf([["Census Form", "Name: Ana Cruz"], ["Signed (2026)"]]);
    const result = await parsePdf(input("form.pdf", pdf), context());
    expect(result.pages).toEqual([
      { number: 1, text: "Census Form\nName: Ana Cruz" },
      { number: 2, text: "Signed (2026)" },
    ]);
  });

  it("rejects files that aren't PDFs or are damaged", async () => {
    await expect(parsePdf(input("broken.pdf", "not a PDF"), context())).rejects.toThrow(/isn't a valid PDF/);
    await expect(parsePdf(input("damaged.pdf", "%PDF-1.7\nnot a document"), context())).rejects.toThrow(/damaged or couldn't be read/);
  });
});
