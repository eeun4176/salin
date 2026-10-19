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
      .flatMap((sheet) => detectTables(sheet).map((t) => ({ sheet: sheet.name, range: t.key.slice(sheet.name.length + 1), headerRows: t.headerRows })));

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

  for (const name of new Set(chosen.map((s) => s.sheet))) {
    const sheet = workbook.sheets.find((s) => s.name === name);
    if (sheet) warnings.push(...sheetWarnings(sheet));
  }
  onProgress(1);
  return { pages: [], tables, warnings };
};
