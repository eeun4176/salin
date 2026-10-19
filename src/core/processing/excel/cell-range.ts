/**
 * Cell Ranges
 * Spreadsheet coordinates in A1 notation: column letters ↔ numbers, and
 * parsing/formatting ranges such as "B3:F20". Coordinates are 0-based and
 * inclusive internally (row 0 = spreadsheet row 1, column 0 = column A).
 */

export interface CellAddress {
  r: number;
  c: number;
}

export interface CellRange {
  s: CellAddress;
  e: CellAddress;
}

/** Excel's limits. */
export const MAX_SHEET_ROWS = 1_048_576;
export const MAX_SHEET_COLUMNS = 16_384;

/** Map key for a cell, e.g. formulas and merged-cell lookups. */
export const cellKey = (r: number, c: number) => `${r},${c}`;

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(c: number) {
  let n = c + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function columnIndex(letters: string) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function formatAddress({ r, c }: CellAddress) {
  return `${columnLetter(c)}${r + 1}`;
}

export function formatRange(range: CellRange) {
  const start = formatAddress(range.s);
  const end = formatAddress(range.e);
  return start === end ? start : `${start}:${end}`;
}

const ADDRESS = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i;

function parseAddress(text: string): CellAddress | null {
  const match = ADDRESS.exec(text.trim());
  if (!match) return null;
  const c = columnIndex(match[1]);
  const r = Number(match[2]) - 1;
  if (r < 0 || r >= MAX_SHEET_ROWS || c < 0 || c >= MAX_SHEET_COLUMNS) return null;
  return { r, c };
}

/** "B3:F20" (or "F20:B3", or a single cell "C4") → a normalised range; `null` if it isn't a valid range. */
export function parseRange(text: string): CellRange | null {
  const [first, second, extra] = text.split(":");
  if (extra !== undefined) return null;
  const a = parseAddress(first ?? "");
  const b = second === undefined ? a : parseAddress(second);
  if (!a || !b) return null;
  return {
    s: { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
    e: { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
  };
}

export function rangeRows(range: CellRange) {
  return range.e.r - range.s.r + 1;
}

export function rangeColumns(range: CellRange) {
  return range.e.c - range.s.c + 1;
}

export function contains(range: CellRange, { r, c }: CellAddress) {
  return r >= range.s.r && r <= range.e.r && c >= range.s.c && c <= range.e.c;
}

export function overlaps(a: CellRange, b: CellRange) {
  return a.s.r <= b.e.r && b.s.r <= a.e.r && a.s.c <= b.e.c && b.s.c <= a.e.c;
}
