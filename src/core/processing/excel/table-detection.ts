/**
 * Table Detection
 * Finds the tables in a worksheet so a messy report becomes clean rows:
 * - Excel's own defined tables are used as-is.
 * - Other cells are split into separate regions wherever a fully blank row or
 *   column divides them, so stacked and side-by-side tables (or report
 *   sections) come out separately.
 * - A one-line title above a region is kept as its name; a "Total" row at the
 *   bottom is left out.
 * - The header row(s) are suggested from the text pattern, including two-row
 *   headers under merged cells.
 * - Each table gets a high / medium / low confidence with the reasons, so the
 *   user knows what to check.
 * Also turns a confirmed table into extracted rows, filling merged cells so
 * every value lands in the right row and column.
 */

import { parseDate, parseNumber } from "@/core/processing/dataset-inference";
import type { ExtractedTable, TableSelection } from "@/types/processing";

import { cellKey, contains, formatRange, overlaps, parseRange, rangeColumns, rangeRows, type CellRange } from "./cell-range";
import type { SheetModel } from "./workbook-reader";

export type Confidence = "high" | "medium" | "low";

/**
 * Something about a table worth knowing, as a code the UI can turn into
 * advice. `major` issues make it unlikely to be a real table (low confidence).
 */
export type TableIssueCode = "no-header" | "no-rows" | "one-row" | "one-column" | "sparse" | "merged-data" | "multi-header" | "mixed-types";

export interface TableIssue {
  code: TableIssueCode;
  major: boolean;
}

export interface DetectedTable {
  /** Stable id within the workbook: "Sheet1!B3:F20". */
  key: string;
  sheet: string;
  range: CellRange;
  headerRows: number;
  /** Text of a title line just above the table, or the Excel table name. */
  title: string | null;
  origin: "excel-table" | "detected" | "manual";
  /** What detection adjusted, e.g. leaving out a Total row (also listed in `reasons`). */
  notes: string[];
  confidence: Confidence;
  /** Why the confidence is what it is, in plain words. */
  reasons: string[];
  /** The same problems as codes (empty for a clean table). */
  issues: TableIssue[];
  stats: TableStats;
}

export interface TableStats {
  dataRows: number;
  columns: number;
  mergedCells: number;
  formulaCells: number;
  uncalculated: number;
  errors: number;
}

export const MAX_HEADER_ROWS = 3;
const TOTAL_ROW = /^\s*(grand\s+)?(sub)?totals?\b|^\s*kabuuan\b/i;

/* ------------------------------------------------------------------
   Cell helpers
------------------------------------------------------------------- */

/** Maps every merged-over cell (not the top-left one) to its merge. */
function mergeIndex(sheet: SheetModel) {
  const covered = new Map<string, CellRange>();
  for (const merge of sheet.merges) {
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) if (r !== merge.s.r || c !== merge.s.c) covered.set(cellKey(r, c), merge);
    }
  }
  return covered;
}

const text = (sheet: SheetModel, r: number, c: number) => sheet.cells[r]?.[c]?.trim() ?? "";

type Occupancy = (r: number, c: number) => boolean;

function occupancy(sheet: SheetModel, covered: Map<string, CellRange>): Occupancy {
  return (r, c) => {
    if (text(sheet, r, c) !== "" || sheet.formulas.has(cellKey(r, c))) return true;
    const merge = covered.get(cellKey(r, c));
    return merge !== undefined && text(sheet, merge.s.r, merge.s.c) !== "";
  };
}

function rowFilled(filled: Occupancy, r: number, range: CellRange) {
  for (let c = range.s.c; c <= range.e.c; c++) if (filled(r, c)) return true;
  return false;
}

function columnFilled(filled: Occupancy, c: number, range: CellRange) {
  for (let r = range.s.r; r <= range.e.r; r++) if (filled(r, c)) return true;
  return false;
}

/** Runs of consecutive filled rows (or columns) within `range`. */
function runs(from: number, to: number, isFilled: (i: number) => boolean) {
  const result: [number, number][] = [];
  let start = -1;
  for (let i = from; i <= to + 1; i++) {
    const f = i <= to && isFilled(i);
    if (f && start === -1) start = i;
    if (!f && start !== -1) {
      result.push([start, i - 1]);
      start = -1;
    }
  }
  return result;
}

/** Recursive XY-cut: split on fully blank rows, then fully blank columns, until nothing splits. */
function regions(range: CellRange, filled: Occupancy): CellRange[] {
  const rowRuns = runs(range.s.r, range.e.r, (r) => rowFilled(filled, r, range));
  if (rowRuns.length === 0) return [];
  if (rowRuns.length > 1) return rowRuns.flatMap(([s, e]) => regions({ s: { r: s, c: range.s.c }, e: { r: e, c: range.e.c } }, filled));
  const [[rs, re]] = rowRuns;
  const rows = { s: { r: rs, c: range.s.c }, e: { r: re, c: range.e.c } };
  const colRuns = runs(rows.s.c, rows.e.c, (c) => columnFilled(filled, c, rows));
  if (colRuns.length > 1) return colRuns.flatMap(([s, e]) => regions({ s: { r: rs, c: s }, e: { r: re, c: e } }, filled));
  const [[cs, ce]] = colRuns;
  return [{ s: { r: rs, c: cs }, e: { r: re, c: ce } }];
}

type Kind = "number" | "date" | "text";

function kindOf(value: string): Kind {
  if (parseNumber(value) !== null) return "number";
  if (parseDate(value) !== null) return "date";
  return "text";
}

/** Filled cells in a row of `range` (merged-over cells count as their merge). */
function filledCount(filled: Occupancy, r: number, range: CellRange) {
  let n = 0;
  for (let c = range.s.c; c <= range.e.c; c++) if (filled(r, c)) n++;
  return n;
}

/** Distinct values in a row of `range`: a merged cell counts once. */
function valueCount(sheet: SheetModel, r: number, range: CellRange, covered: Map<string, CellRange>) {
  let n = 0;
  for (let c = range.s.c; c <= range.e.c; c++) if (!covered.has(cellKey(r, c)) && (text(sheet, r, c) || sheet.formulas.has(cellKey(r, c)))) n++;
  return n;
}

/** A header-like row: mostly filled with distinct text, not numbers or dates. */
function isHeaderLike(sheet: SheetModel, r: number, range: CellRange, filled: Occupancy, covered: Map<string, CellRange>) {
  const width = rangeColumns(range);
  // At least half the columns, and never a lone label in a wider table.
  if (filledCount(filled, r, range) < Math.max(Math.min(width, 2), Math.ceil(width * 0.5))) return false;
  const seen = new Set<string>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (covered.has(cellKey(r, c))) continue;
    const value = text(sheet, r, c);
    if (!value) continue;
    if (kindOf(value) !== "text" || sheet.formulas.has(cellKey(r, c))) return false;
    if (seen.has(value.toLowerCase())) return false;
    seen.add(value.toLowerCase());
  }
  // One title merged across the table isn't a header row.
  return seen.size >= Math.min(2, width);
}

/** A form's fill-in label ("BARANGAY: ________", "DATE OF CENSUS:", "Prepared by"): part of the form, not a column name or a record. */
const FORM_LABEL = /:\s*_*\s*$|_{3,}/;

/** A row holding only form labels ("Prepared By:", "Noted By:", "________"). */
function isFormLine(sheet: SheetModel, r: number, range: CellRange, covered: Map<string, CellRange>) {
  const values: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) if (!covered.has(cellKey(r, c)) && text(sheet, r, c)) values.push(text(sheet, r, c));
  return values.length > 0 && values.every((v) => FORM_LABEL.test(v));
}

/** A line above a table: one value (a title, often merged across), or only form labels. */
function isLabelLine(sheet: SheetModel, r: number, range: CellRange, covered: Map<string, CellRange>) {
  const values: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) if (!covered.has(cellKey(r, c)) && text(sheet, r, c)) values.push(text(sheet, r, c));
  return values.length === 1 || (values.length > 0 && values.every((v) => FORM_LABEL.test(v)));
}

/**
 * A lower header row under group labels ("Dog", "Cat" under "Type of Pet"; "D", "C" under each "Sex" column): short text only,
 * under a row with merged group labels. Unlike a top header, its labels may repeat and may leave columns blank.
 */
function isSubHeader(sheet: SheetModel, r: number, range: CellRange, covered: Map<string, CellRange>) {
  if (!hasWideMerge(r - 1, range, sheet)) return false;
  let labels = 0;
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (covered.has(cellKey(r, c))) continue;
    const value = text(sheet, r, c);
    if (!value) continue;
    if (kindOf(value) !== "text" || value.length > 40 || sheet.formulas.has(cellKey(r, c))) return false;
    labels++;
  }
  return labels >= 2;
}

/** True if row `r` has a merge that spans several columns inside `range`. */
function hasWideMerge(r: number, range: CellRange, sheet: SheetModel) {
  return sheet.merges.some((m) => m.s.r === r && m.e.c > m.s.c && overlaps(m, range));
}

/** Suggests how many of the range's top rows are headers (0–3). */
export function suggestHeaderRows(sheet: SheetModel, range: CellRange) {
  const covered = mergeIndex(sheet);
  const filled = occupancy(sheet, covered);
  const top = range.s.r;
  if (rangeRows(range) < 2 || !isHeaderLike(sheet, top, range, filled, covered)) return 0;
  // Two- or three-row headers: merged group labels ("Q1", "Type of Pet") over their sub-columns ("Jan", "Feb"; "Dog", "Cat").
  let rows = 1;
  while (rows < MAX_HEADER_ROWS && rangeRows(range) > rows + 1 && hasWideMerge(top + rows - 1, range, sheet) && (isHeaderLike(sheet, top + rows, range, filled, covered) || isSubHeader(sheet, top + rows, range, covered))) rows++;
  return rows;
}

/* ------------------------------------------------------------------
   Confidence
------------------------------------------------------------------- */

function measure(sheet: SheetModel, range: CellRange, headerRows: number, filled: Occupancy, covered: Map<string, CellRange>) {
  const firstData = range.s.r + headerRows;
  let dataRows = 0;
  let filledCells = 0;
  let mergedInData = 0;
  let formulaCells = 0;
  let uncalculated = 0;
  let errors = 0;
  let consistency = 0;
  let consistencyColumns = 0;

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = cellKey(r, c);
      if (sheet.formulas.has(key)) formulaCells++;
      if (sheet.uncalculated.has(key)) uncalculated++;
      if (sheet.errors.has(key)) errors++;
      if (r >= firstData && covered.has(key)) mergedInData++;
    }
  }
  for (let r = firstData; r <= range.e.r; r++) {
    const n = filledCount(filled, r, range);
    // A blank form line keeps only its number ("1", "2." …): not a record (the dataset leaves it out too).
    if (n === 0 || (n === 1 && rangeColumns(range) > 2 && /^\d{1,4}\.?$/.test(text(sheet, r, range.s.c)))) continue;
    dataRows++;
    filledCells += n;
  }
  for (let c = range.s.c; c <= range.e.c; c++) {
    const kinds: Record<Kind, number> = { number: 0, date: 0, text: 0 };
    let total = 0;
    for (let r = firstData; r <= range.e.r; r++) {
      const value = text(sheet, r, c);
      if (!value) continue;
      kinds[kindOf(value)]++;
      total++;
    }
    if (total >= 2) {
      consistency += Math.max(kinds.number, kinds.date, kinds.text) / total;
      consistencyColumns++;
    }
  }

  const mergedCells = sheet.merges.filter((m) => overlaps(m, range)).length;
  return {
    stats: { dataRows, columns: rangeColumns(range), mergedCells, formulaCells, uncalculated, errors },
    fill: dataRows ? filledCells / (dataRows * rangeColumns(range)) : 0,
    consistency: consistencyColumns ? consistency / consistencyColumns : 1,
    mergedInData,
  };
}

/** Builds the full description (stats, confidence, reasons) for a table at `range`. */
export function describeTable(
  sheet: SheetModel,
  range: CellRange,
  headerRows: number,
  origin: DetectedTable["origin"],
  title: string | null = null,
  notes: string[] = [],
): DetectedTable {
  const covered = mergeIndex(sheet);
  const filled = occupancy(sheet, covered);
  const { stats, fill, consistency, mergedInData } = measure(sheet, range, headerRows, filled, covered);

  const issues: TableIssue[] = [];
  const major: string[] = [];
  const minor: string[] = [];
  const flag = (code: TableIssueCode, isMajor: boolean, reason: string) => {
    issues.push({ code, major: isMajor });
    (isMajor ? major : minor).push(reason);
  };
  if (headerRows === 0) flag("no-header", true, "No header row found — columns will be named by letter");
  if (stats.dataRows === 0) flag("no-rows", true, "No rows of data");
  if (stats.dataRows === 1) flag("one-row", false, "Only one row of data");
  if (stats.columns < 2) flag("one-column", true, "Only one column");
  if (fill < 0.5 && stats.dataRows > 0) flag("sparse", false, "Many empty cells");
  if (mergedInData) flag("merged-data", false, "Merged cells inside the data (values are filled down)");
  if (headerRows > 1) flag("multi-header", false, `Header spans ${headerRows} rows (names are combined)`);
  if (consistency < 0.8) flag("mixed-types", false, "Some columns mix numbers and text");

  const confidence: Confidence = origin === "excel-table" ? "high" : major.length ? "low" : minor.length ? "medium" : "high";
  const reasons =
    origin === "excel-table"
      ? ["Defined as a table in Excel", ...minor]
      : confidence === "high"
        ? ["Clear header row", "Consistent columns", ...notes]
        : [...major, ...minor, ...notes];

  return { key: `${sheet.name}!${formatRange(range)}`, sheet: sheet.name, range, headerRows, title, origin, notes, confidence, reasons, issues, stats };
}

/* ------------------------------------------------------------------
   Detection
------------------------------------------------------------------- */

/** Title or note lines: up to six rows each holding a single value or only form labels ("BARANGAY: ____"), or one row with two values. */
function isTitleLine(sheet: SheetModel, range: CellRange, covered: Map<string, CellRange>) {
  if (rangeRows(range) === 1) return valueCount(sheet, range.s.r, range, covered) <= 2;
  if (rangeRows(range) > 6) return false;
  for (let r = range.s.r; r <= range.e.r; r++) if (valueCount(sheet, r, range, covered) > 0 && !isLabelLine(sheet, r, range, covered)) return false;
  return true;
}

/** Every table found in the sheet, top-to-bottom then left-to-right. */
export function detectTables(sheet: SheetModel): DetectedTable[] {
  if (!sheet.used || sheet.isChartSheet) return [];
  const covered = mergeIndex(sheet);
  const base = occupancy(sheet, covered);

  const tables: DetectedTable[] = sheet.excelTables.map((t) =>
    describeTable(sheet, t.totalsRows ? { s: t.range.s, e: { r: t.range.e.r - t.totalsRows, c: t.range.e.c } } : t.range, t.headerRows, "excel-table", t.name),
  );
  // Excel tables are taken as-is; detection only looks at the other cells.
  const filled: Occupancy = (r, c) => base(r, c) && !sheet.excelTables.some((t) => contains(t.range, { r, c }));

  const blocks = joinGaps(sheet, regions(sheet.used, filled).sort((a, b) => a.s.r - b.s.r || a.s.c - b.s.c), filled, covered);
  const titles = new Set<CellRange>();
  for (const block of blocks) {
    if (titles.has(block)) continue;
    if (isTitleLine(sheet, block, covered)) {
      // A title belongs to the next block below that shares its columns.
      const below = blocks.find((b) => b.s.r > block.e.r && b.s.r - block.e.r <= 3 && b.s.c <= block.e.c && b.e.c >= block.s.c && !isTitleLine(sheet, b, covered));
      if (below) {
        titles.add(block);
        continue;
      }
      // A lone line is a note; several lines with nothing below may be a one-column list.
      if (rangeRows(block) === 1) continue;
    }

    let range = { s: { ...block.s }, e: { ...block.e } };
    const notes: string[] = [];
    let title: string | null = null;
    const above = [...titles].find((t) => t.e.r < range.s.r && range.s.r - t.e.r <= 3 && t.s.c <= range.e.c && t.e.c >= range.s.c);
    if (above) title = rowText(sheet, above);

    // Title and form lines glued to the top of the block ("City of …", "CENSUS FORM", "BARANGAY: ____  DATE: ____"), down to the first header row.
    const headerAt = rangeColumns(range) >= 2 ? Array.from({ length: 6 }, (_, k) => range.s.r + k).find((r) => r < range.e.r - 1 && isHeaderLike(sheet, r, range, filled, covered)) : undefined;
    if (headerAt !== undefined && headerAt > range.s.r && Array.from({ length: headerAt - range.s.r }, (_, k) => range.s.r + k).every((r) => !rowFilled(filled, r, range) || isLabelLine(sheet, r, range, covered))) {
      title ??= rowText(sheet, { s: range.s, e: { r: range.s.r, c: range.e.c } });
      range = { s: { r: headerAt, c: range.s.c }, e: range.e };
    }

    const headerRows = suggestHeaderRows(sheet, range);
    // A "Total" row at the bottom summarises the rows above; it isn't a record.
    if (rangeRows(range) - headerRows > 2 && TOTAL_ROW.test(rowText(sheet, { s: { r: range.e.r, c: range.s.c }, e: range.e }))) {
      range = { s: range.s, e: { r: range.e.r - 1, c: range.e.c } };
      notes.push("Left out the Total row at the bottom");
    }
    // Sign-off lines glued to the bottom of a form ("Prepared By:", "Noted By:") aren't records either.
    let signOff = false;
    while (rangeRows(range) - headerRows > 1 && isFormLine(sheet, range.e.r, range, covered)) {
      range = { s: range.s, e: { r: range.e.r - 1, c: range.e.c } };
      signOff = true;
    }
    if (signOff) notes.push("Left out the sign-off lines at the bottom");
    tables.push(describeTable(sheet, range, headerRows, "detected", title, notes));
  }
  return tables.sort((a, b) => a.range.s.r - b.range.s.r || a.range.s.c - b.range.s.c);
}

/**
 * Rejoins a table that a stray blank row (or two) split in half: the part
 * below has the same columns and continues with data, not a new header.
 */
function joinGaps(sheet: SheetModel, blocks: CellRange[], filled: Occupancy, covered: Map<string, CellRange>) {
  const joined: CellRange[] = [];
  for (const block of blocks) {
    const previous = joined.at(-1);
    const sameColumns = previous && previous.s.c === block.s.c && previous.e.c === block.e.c;
    const gap = previous ? block.s.r - previous.e.r - 1 : Infinity;
    if (
      previous &&
      sameColumns &&
      gap <= 2 &&
      rangeRows(previous) >= 2 &&
      rangeColumns(block) >= 2 &&
      isHeaderLike(sheet, previous.s.r, previous, filled, covered) &&
      !isHeaderLike(sheet, block.s.r, block, filled, covered)
    ) {
      joined[joined.length - 1] = { s: previous.s, e: block.e };
    } else {
      joined.push(block);
    }
  }
  return joined;
}

function rowText(sheet: SheetModel, range: CellRange) {
  for (let c = range.s.c; c <= range.e.c; c++) {
    const value = text(sheet, range.s.r, c);
    if (value) return value;
  }
  return "";
}

/* ------------------------------------------------------------------
   Extraction
------------------------------------------------------------------- */

/** Validates a user-entered range against the sheet; returns an error message or the range. */
export function checkRange(sheet: SheetModel, input: string): CellRange | string {
  const range = parseRange(input);
  if (!range) return "Enter a range like A2:G11.";
  if (rangeColumns(range) > 500) return "That range is too wide (500 columns at most).";
  if (sheet.used && !overlaps(range, sheet.used)) return "That range has no data.";
  return range;
}

/**
 * Turns a confirmed table into rows. Merged cells are filled so values land
 * where they belong: a header label spans every column under it; a value
 * merged down a column repeats on each row; a value merged across a data row
 * stays in its first column. A multi-row header becomes one row of combined
 * names ("Q1 Jan").
 */
export function extractTable(sheet: SheetModel, selection: TableSelection): ExtractedTable {
  const checked = checkRange(sheet, selection.range);
  if (typeof checked === "string") throw new Error(checked);
  const range = checked;
  const headerRows = Math.max(0, Math.min(selection.headerRows, MAX_HEADER_ROWS, rangeRows(range) - 1));
  const covered = mergeIndex(sheet);

  const grid: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const merge = covered.get(cellKey(r, c));
      let value = text(sheet, r, c);
      if (merge) {
        const anchor = text(sheet, merge.s.r, merge.s.c);
        const inHeader = r < range.s.r + headerRows;
        value = inHeader || merge.s.c === c ? anchor : "";
      }
      row.push(value);
    }
    grid.push(row);
  }

  let rows = grid;
  if (headerRows > 0) {
    const names = grid[0].map((_, i) => {
      const parts: string[] = [];
      for (let h = 0; h < headerRows; h++) {
        const part = grid[h][i];
        if (part && parts.at(-1) !== part) parts.push(part);
      }
      return parts.join(" ");
    });
    rows = [names, ...grid.slice(headerRows)];
  }

  return {
    name: `${sheet.name} ${formatRange(range)}`,
    sheet: sheet.name,
    page: null,
    rows,
    // rows[0] is the (last) header row, or the first data row when there's no header.
    firstRowNumber: headerRows > 0 ? range.s.r + headerRows : range.s.r + 1,
    headerRows: headerRows > 0 ? 1 : 0,
    range: formatRange(range),
    firstColumn: range.s.c,
  };
}
