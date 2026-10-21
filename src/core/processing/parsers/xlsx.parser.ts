/**
 * Excel Parser
 * Reads an .xlsx workbook into tables. When the user confirmed tables on the
 * "Choose tables" screen, exactly those (sheet, cell range, header rows) are
 * read; otherwise every table detected on the visible worksheets is used.
 * Values are what Excel displays — formula cells give their saved results.
 * Charts, pictures, pivot tables and uncalculated formulas are reported as
 * warnings. The workbook file itself is only read, never changed.
 */

import { extractTable, detectTables } from "@/core/processing/excel/table-detection";
import { sheetWarnings } from "@/core/processing/excel/sheet-warnings";
import { readWorkbook } from "@/core/processing/excel/workbook-reader";
import { ProcessingError } from "@/core/processing/processing-errors";
import type { ParseFn } from "@/core/processing/processing.service";
import type { ExtractedTable, TableSelection } from "@/types/processing";

import { assertTableSize } from "./parser-helpers";

export const parseXlsx: ParseFn = async ({ file, blob, tables: selections }, { signal, onProgress }) => {
  const workbook = await readWorkbook(blob, file.name);
  signal.throwIfAborted();
  onProgress(0.5);

  const warnings: string[] = [];
  if (workbook.externalLinks) warnings.push("This workbook links to other workbooks. Linked values are the ones last saved in this file.");

  const chosen: TableSelection[] =
    selections ??
    workbook.sheets
      .filter((sheet) => sheet.visibility === "visible")
      .flatMap((sheet) =>
        detectTables(sheet)
          // Titles, signature lines ("_______" over "Paravet") and a lone column of row numbers aren't tables; a one-column list with a header still is.
          .filter((t) => {
            const major = t.issues.filter((issue) => issue.major).map((issue) => issue.code);
            const top = sheet.cells[t.range.s.r]?.[t.range.s.c]?.trim() ?? "";
            const signature = t.stats.dataRows <= 1 && major.includes("one-column") && /^_{3,}$|:\s*_*$/.test(top);
            return !major.includes("no-rows") && !signature && !(major.includes("one-column") && major.includes("no-header"));
          })
          .map((t) => ({ sheet: sheet.name, range: t.key.slice(sheet.name.length + 1), headerRows: t.headerRows })),
      );

  const tables: ExtractedTable[] = [];
  for (const selection of chosen) {
    const sheet = workbook.sheets.find((s) => s.name === selection.sheet);
    if (!sheet) {
      warnings.push(`The sheet "${selection.sheet}" isn't in this workbook anymore.`);
      continue;
    }
    let table: ExtractedTable;
    try {
      table = extractTable(sheet, selection);
    } catch (error) {
      throw new ProcessingError("parse-failed", `${selection.sheet} ${selection.range}: ${(error as Error).message}`);
    }
    assertTableSize(table.rows.length, table.rows[0]?.length ?? 0, `${sheet.name} ${table.range}`);
    tables.push(table);
  }

  // Read in one step (no tables confirmed), a workbook is one dataset: its main table plus tables with the same columns (the same form on
  // several sheets). Tables of other shapes would mix unrelated columns into it, so they're left out, with a pointer to Extract data.
  if (!selections && tables.length > 1) {
    const records = (t: ExtractedTable) => t.rows.slice(t.headerRows ? 1 : 0).filter((row) => row.filter((cell) => cell.trim()).length > 1).length;
    const main = tables.reduce((best, t) => (records(t) * 1000 + (t.rows[0]?.length ?? 0) > records(best) * 1000 + (best.rows[0]?.length ?? 0) ? t : best));
    const shape = (t: ExtractedTable) => (t.headerRows ? t.rows[0].map((name) => name.trim().toLowerCase()).join("|") : null);
    const kept = tables.filter((t) => t === main || (shape(t) !== null && shape(t) === shape(main)));
    if (kept.length < tables.length) warnings.push(`This workbook has tables of different shapes; used ${main.sheet ?? "the main one"}${kept.length > 1 ? ` and ${kept.length - 1} more like it` : ""}. Use Extract data to pick the others.`);
    tables.splice(0, tables.length, ...kept);
  }

  for (const name of new Set(chosen.map((s) => s.sheet))) {
    const sheet = workbook.sheets.find((s) => s.name === name);
    if (sheet) warnings.push(...sheetWarnings(sheet));
  }
  onProgress(1);
  return { pages: [], tables, warnings };
};
