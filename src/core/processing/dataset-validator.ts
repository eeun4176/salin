/**
 * Dataset Validator
 * Zod schemas for every stored dataset record (columns, rows, cells, source
 * references), a structural check run before a dataset is saved (unique,
 * named columns; rows only use known columns), and cell checks that flag
 * empty required cells and values that don't match their column's type.
 */

import { z } from "zod";

import { WorkspaceError } from "@/core/storage/errors";
import { MAX_NAME_LENGTH, normalizeName } from "@/core/storage/names";
import type { CellValue, ColumnType, DatasetColumn, DatasetRowDraft } from "@/types/processing";

export const MAX_COLUMNS = 500;
export const MAX_COLUMN_NAME_LENGTH = 120;

const id = z.string().min(1).max(100);
const timestamp = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();

// z.number() already rejects NaN and Infinity.
export const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const columnSchema = z.object({
  id,
  name: z.string().trim().min(1).max(MAX_COLUMN_NAME_LENGTH),
  type: z.enum(["text", "number", "date", "boolean"]),
  required: z.boolean(),
  sourceHeader: z.string().nullable(),
});

const unit = z.number().min(0).max(1);
const normalizedBox = z.object({ x: unit, y: unit, width: unit, height: unit });

export const sourceReferenceSchema = z.object({
  fileId: id,
  page: positiveInt.nullable(),
  sheet: z.string().nullable(),
  row: positiveInt.nullable(),
  // Added with Excel table detection; older records and backups have no range.
  range: z.string().max(40).nullable().default(null),
  // Added with OCR (Phase 4): where on the scanned page the row and each value came from.
  ocr: z
    .object({
      documentId: id,
      page: positiveInt,
      region: normalizedBox.nullable(),
      cells: z.record(z.string(), normalizedBox),
      original: z.record(z.string(), z.string()),
    })
    .optional(),
});

export const datasetSchema = z.object({
  id,
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  sourceFileIds: z.array(id),
  jobId: id.nullable(),
  columns: z.array(columnSchema).max(MAX_COLUMNS),
  rowCount: z.number().int().nonnegative(),
  status: z.enum(["needs_review", "reviewed"]),
  version: positiveInt,
  createdAt: timestamp,
  updatedAt: timestamp,
  lastExportedAt: timestamp.nullable(),
  origin: z.object({ kind: z.literal("ocr"), documentId: id, templateId: z.string().min(1).max(100) }).optional(),
});

export const datasetRowSchema = z.object({
  id,
  datasetId: id,
  position: z.number().int().nonnegative(),
  values: z.record(z.string(), cellValueSchema),
  source: sourceReferenceSchema.nullable(),
});

const rowDraftSchema = datasetRowSchema.pick({ values: true, source: true });

function invalid(message: string): never {
  throw new WorkspaceError("validation", message);
}

/**
 * Throws a validation WorkspaceError unless the columns and rows form a
 * well-formed dataset. Cell *content* problems (empty required cells, a word
 * in a number column) are allowed here — they are flagged for review by
 * `findCellIssues` instead of blocking the save.
 */
export function assertValidContent(columns: DatasetColumn[], rows: DatasetRowDraft[]) {
  if (columns.length === 0) invalid("A dataset needs at least one column.");
  if (columns.length > MAX_COLUMNS) invalid(`A dataset can have at most ${MAX_COLUMNS} columns.`);

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const column of columns) {
    const parsed = columnSchema.safeParse(column);
    if (!parsed.success) invalid(`Column "${column.name}" is not valid: a name (up to ${MAX_COLUMN_NAME_LENGTH} characters) and a known type are required.`);
    if (ids.has(column.id)) invalid("Two columns share the same id.");
    ids.add(column.id);
    const key = normalizeName(column.name).toLowerCase();
    if (names.has(key)) invalid(`There is more than one column named "${normalizeName(column.name)}".`);
    names.add(key);
  }

  for (const [index, row] of rows.entries()) {
    if (!rowDraftSchema.safeParse(row).success) invalid(`Row ${index + 1} has a value that can't be stored.`);
    for (const key of Object.keys(row.values)) {
      if (!ids.has(key)) invalid(`Row ${index + 1} has a value for a column that doesn't exist.`);
    }
  }
}

export interface CellIssue {
  /** 0-based row index. */
  row: number;
  columnId: string;
  message: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const TYPE_LABEL: Record<ColumnType, string> = {
  text: "text",
  number: "a number",
  date: "a date (YYYY-MM-DD)",
  boolean: "yes or no",
};

function matchesType(type: ColumnType, value: Exclude<CellValue, null>) {
  switch (type) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "date":
      return typeof value === "string" && isValidIsoDate(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

/** Why a single cell needs attention, or `null` if it's fine. */
export function cellIssue(column: DatasetColumn, value: CellValue | undefined): string | null {
  const empty = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  if (empty) return column.required ? `${column.name} is required.` : null;
  return matchesType(column.type, value) ? null : `${column.name} should be ${TYPE_LABEL[column.type]}.`;
}

/** Every cell that needs attention, in row then column order. */
export function findCellIssues(columns: DatasetColumn[], rows: Pick<DatasetRowDraft, "values">[]): CellIssue[] {
  const issues: CellIssue[] = [];
  rows.forEach((row, index) => {
    for (const column of columns) {
      const message = cellIssue(column, row.values[column.id]);
      if (message) issues.push({ row: index, columnId: column.id, message });
    }
  });
  return issues;
}
