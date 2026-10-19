/**
 * Sheet Warnings
 * Plain-language warnings for the parts of a worksheet that won't become
 * rows: chart sheets, charts, pictures, shapes and text boxes, pivot tables,
 * formulas without a saved result, formula errors, and sheets too large to
 * read in full. Shown on the "Choose tables" screen and kept with the
 * extraction.
 */

import { MAX_TABLE_ROWS } from "@/core/processing/parsers/parser-helpers";

import type { SheetModel } from "./workbook-reader";

/** Plain-language warnings for things in a sheet that won't become rows. */
export function sheetWarnings(sheet: SheetModel): string[] {
  const { charts, images, shapes, pivotTables } = sheet.objects;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const warnings: string[] = [];
  if (sheet.isChartSheet) warnings.push(`"${sheet.name}" is a chart sheet. Charts can't be turned into rows.`);
  const ignored = [charts && plural(charts, "chart"), images && plural(images, "picture"), shapes && plural(shapes, "shape or text box")].filter(Boolean);
  if (ignored.length) warnings.push(`"${sheet.name}" has ${ignored.join(", ")}. These are skipped — only cell values are extracted.`);
  if (pivotTables) warnings.push(`"${sheet.name}" has ${plural(pivotTables, "pivot table")}. Their saved values are read as plain cells and may be a summary, not records.`);
  if (sheet.uncalculated.size) {
    warnings.push(`"${sheet.name}" has ${plural(sheet.uncalculated.size, "formula")} with no saved result, so they read as empty. Open and save the file in Excel to calculate them.`);
  }
  if (sheet.errors.size) warnings.push(`"${sheet.name}" has ${plural(sheet.errors.size, "cell")} showing a formula error (like #DIV/0!).`);
  if (sheet.truncated) warnings.push(`Only the first ${MAX_TABLE_ROWS.toLocaleString()} rows of "${sheet.name}" were read.`);
  return warnings;
}
