/**
 * Dataset Transformer
 * Turns extracted document content into a structured dataset (columns +
 * rows with source references). Each table's first row is its header (or,
 * for a table without one, columns are named by letter: "Column B"),
 * tables from every source (sheets, files) are merged by header name, and
 * documents without tables become one "Text" row per line. Column types are
 * then detected and values converted (see dataset-inference.ts).
 */

import { inferColumnTypes } from "@/core/processing/dataset-inference";
import { columnLetter } from "@/core/processing/excel/cell-range";
import { MAX_COLUMN_NAME_LENGTH } from "@/core/processing/dataset-validator";
import type { WorkspaceFile } from "@/types/domain";
import type {
  CellValue,
  DatasetColumn,
  DatasetContent,
  DatasetRowDraft,
  ExtractedContent,
  ExtractedTable,
} from "@/types/processing";

/** One processed document: the file it came from and what was extracted. */
export interface TransformSource {
  file: Pick<WorkspaceFile, "id" | "name">;
  extraction: ExtractedContent;
}

export type DatasetTransformer = (sources: TransformSource[]) => DatasetContent;

function newColumn(name: string, sourceHeader: string | null): DatasetColumn {
  return { id: crypto.randomUUID(), name, type: "text", required: false, sourceHeader };
}

function cell(raw: string | undefined): CellValue {
  const text = raw?.trim() ?? "";
  return text === "" ? null : text;
}

const isBlankRow = (row: string[]) => row.every((c) => c.trim() === "");

const hasHeader = (table: ExtractedTable) => table.headerRows !== 0;

/** Unnamed columns: "Column B" when the spreadsheet column is known, otherwise "Column 2". */
const fallbackName = (table: ExtractedTable, i: number) =>
  `Column ${table.firstColumn === undefined ? i + 1 : columnLetter(table.firstColumn + i)}`;

/** Header names for a table: blanks become "Column …", repeats get " (2)", " (3)"… */
function headerNames(table: ExtractedTable, width: number) {
  const seen = new Map<string, number>();
  const header = hasHeader(table) ? table.rows[0] : [];
  return Array.from({ length: width }, (_, i) => {
    const base = (header[i] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_COLUMN_NAME_LENGTH - 5) || fallbackName(table, i);
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function fromTables(sources: TransformSource[]): DatasetContent {
  const columns: DatasetColumn[] = [];
  const byName = new Map<string, DatasetColumn>();
  const rows: DatasetRowDraft[] = [];

  for (const { file, extraction } of sources) {
    for (const table of extraction.tables) {
      if (table.rows.length === 0) continue;
      // reduce, not Math.max(...rows): spreading 200k rows overflows the call stack.
      const width = table.rows.reduce((max, r) => Math.max(max, r.length), 0);
      const columnIds = headerNames(table, width).map((name, i) => {
        let column = byName.get(name.toLowerCase());
        if (!column) {
          column = newColumn(name, (hasHeader(table) && table.rows[0][i]?.trim()) || null);
          byName.set(name.toLowerCase(), column);
          columns.push(column);
        }
        return column.id;
      });

      const firstData = hasHeader(table) ? 1 : 0;
      table.rows.forEach((cells, index) => {
        if (index < firstData || isBlankRow(cells)) return;
        const values: Record<string, CellValue> = {};
        columnIds.forEach((id, i) => (values[id] = cell(cells[i])));
        const row = table.firstRowNumber + index;
        const range =
          table.firstColumn === undefined ? null : `${columnLetter(table.firstColumn)}${row}:${columnLetter(table.firstColumn + width - 1)}${row}`;
        rows.push({ values, source: { fileId: file.id, page: table.page, sheet: table.sheet, row, range } });
      });
    }
  }
  return { columns, rows };
}

function fromText(sources: TransformSource[]): DatasetContent {
  const column = newColumn("Text", null);
  const rows: DatasetRowDraft[] = [];
  for (const { file, extraction } of sources) {
    for (const page of extraction.pages) {
      page.text.split(/\r?\n/).forEach((line, index) => {
        const value = cell(line);
        if (value === null) return;
        rows.push({ values: { [column.id]: value }, source: { fileId: file.id, page: page.number, sheet: null, row: index + 1, range: null } });
      });
    }
  }
  return { columns: [column], rows };
}

/** Default transformer: tables when any source has them, otherwise lines of text; then typed columns. */
export const buildDatasetContent: DatasetTransformer = (sources) => {
  const hasTables = sources.some((s) => s.extraction.tables.some((t) => t.rows.length > 0));
  return inferColumnTypes(hasTables ? fromTables(sources) : fromText(sources));
};
