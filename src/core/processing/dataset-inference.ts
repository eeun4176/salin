/**
 * Column Type Detection
 * Gives each structured column a type (number, date, yes/no or text) when
 * every filled cell agrees, and converts the cells to match: "1,250" → 1250,
 * "10/18/2026" → "2026-10-18", "Yes" → true. Columns that look like codes
 * (IDs, phone numbers, ZIP codes, values with leading zeros) stay text so
 * nothing is lost. Also converts single values when a reviewer changes a
 * column's type.
 */

import type { CellValue, ColumnType, DatasetContent } from "@/types/processing";

const IDENTIFIER_HEADER = /\b(id|code|zip|postal|phone|mobile|telephone|tel|account|tin|sss)\b/i;
const NUMBER = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TRUE_WORDS = /^(true|yes|y)$/i;
const FALSE_WORDS = /^(false|no|n)$/i;

export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  // "007" and "0917…" are codes, not numbers; "0.5" is fine.
  if (/^[+-]?0\d/.test(text) || !NUMBER.test(text)) return null;
  const value = Number(text.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Accepts YYYY-MM-DD and month-first M/D/YYYY (as Excel shows dates in the Philippines and US). */
export function parseDate(raw: string): string | null {
  const text = raw.trim();
  const iso = ISO_DATE.exec(text);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = SLASH_DATE.exec(text);
  return slash ? isoDate(Number(slash[3]), Number(slash[1]), Number(slash[2])) : null;
}

export function parseBoolean(raw: string): boolean | null {
  const text = raw.trim();
  if (TRUE_WORDS.test(text)) return true;
  if (FALSE_WORDS.test(text)) return false;
  return null;
}

/**
 * Converts a cell to `type`. Values that don't fit are kept as typed so
 * nothing is lost — validation then flags them for review.
 */
export function convertValue(value: CellValue, type: ColumnType): CellValue {
  if (value === null || value === "") return null;
  if (type === "text") return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  if (typeof value !== "string") return value;
  const parsed = type === "number" ? parseNumber(value) : type === "date" ? parseDate(value) : parseBoolean(value);
  return parsed ?? value;
}

const PARSERS: [ColumnType, (raw: string) => unknown][] = [
  ["boolean", parseBoolean],
  ["date", parseDate],
  ["number", parseNumber],
];

function detectType(header: string, values: string[]): ColumnType {
  if (values.length === 0) return "text";
  for (const [type, parse] of PARSERS) {
    if (type === "number" && IDENTIFIER_HEADER.test(header)) continue;
    if (values.every((value) => parse(value) !== null)) return type;
  }
  return "text";
}

/** Detects each column's type from its filled cells and converts those cells. */
export function inferColumnTypes(content: DatasetContent): DatasetContent {
  const rows = content.rows.map((row) => ({ ...row, values: { ...row.values } }));
  const columns = content.columns.map((column) => {
    const filled = rows.map((row) => row.values[column.id]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
    const type = detectType(column.sourceHeader ?? column.name, filled);
    if (type !== "text") {
      for (const row of rows) if (column.id in row.values) row.values[column.id] = convertValue(row.values[column.id], type);
    }
    return { ...column, type };
  });
  return { columns, rows };
}
