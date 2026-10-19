/**
 * Dataset Export
 * Turns a dataset into a downloadable CSV, Excel (.xlsx) or JSON file.
 * CSV is UTF-8 with a BOM (so Excel shows accents and non-Latin text) and
 * neutralises cells that a spreadsheet would run as formulas. Excel keeps
 * numbers and yes/no values typed. JSON keeps column types and each row's
 * source document reference.
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";

import type { CellValue, DatasetContent } from "@/types/processing";

export type ExportFormat = "csv" | "xlsx" | "json";

export interface ExportInput {
  name: string;
  content: DatasetContent;
  /** File names for source references in JSON exports, keyed by file id. */
  sourceNames?: Map<string, string>;
}

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json;charset=utf-8",
};

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ] */
function sheetName(name: string) {
  return name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Dataset";
}

function toJson({ name, content, sourceNames }: ExportInput) {
  return JSON.stringify(
    {
      format: "salin-dataset",
      version: 1,
      name,
      exportedAt: new Date().toISOString(),
      columns: content.columns.map(({ name, type, required }) => ({ name, type, required })),
      rows: content.rows.map(({ values, source }) => ({
        values: Object.fromEntries(content.columns.map((c) => [c.name, values[c.id] ?? null])),
        source: source && {
          file: sourceNames?.get(source.fileId) ?? null,
          page: source.page,
          sheet: source.sheet,
          row: source.row,
          range: source.range ?? null,
        },
      })),
    },
    null,
    2,
  );
}

export function exportDataset(input: ExportInput, format: ExportFormat): Blob {
  if (format === "json") return new Blob([toJson(input)], { type: MIME.json });

  const { columns, rows } = input.content;
  const header = columns.map((c) => c.name);
  const records: CellValue[][] = rows.map(({ values }) => columns.map((c) => values[c.id] ?? null));

  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...records]), sheetName(input.name));
    return new Blob([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], { type: MIME.xlsx });
  }

  // escapeFormulae prefixes "'" to text starting with = + - @ so spreadsheets show it instead of running it.
  const csv = Papa.unparse({ fields: header, data: records }, { newline: "\r\n", escapeFormulae: true });
  return new Blob(["﻿", csv], { type: MIME.csv });
}
