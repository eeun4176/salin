/**
 * Census Sheet Code
 * What the row of small filled/empty squares under a census sheet's header
 * says: the form version, whether it's a main or a continuation sheet, the
 * barangay, the census date and the sheet number — plus a checksum, so a
 * misread strip (or a page that isn't a Salin census sheet) is rejected
 * instead of guessed. Printing encodes it; scanning decodes it.
 */

/** The version printed now; every version in SUPPORTED_VERSIONS still scans. */
export const FORM_VERSION = 3;
export const SUPPORTED_VERSIONS = [1, 2, 3];

export interface SheetCode {
  version: number;
  continuation: boolean;
  /** Position in BARANGAYS. */
  barangay: number;
  /** ISO date, e.g. "2026-10-22". */
  censusDate: string;
  sheetNumber: number;
}

// Field widths, in strip order. Dates count days from EPOCH (good until 2068).
const FIELDS = [
  ["version", 4],
  ["continuation", 1],
  ["barangay", 7],
  ["day", 14],
  ["sheetNumber", 12],
] as const;
const CHECK_BITS = 6;
export const CODE_BITS = FIELDS.reduce((n, [, bits]) => n + bits, 0) + CHECK_BITS;
export const MAX_SHEET_NUMBER = 2 ** 12 - 1;

const EPOCH = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

const toDay = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - EPOCH) / DAY_MS);
const fromDay = (day: number) => new Date(EPOCH + day * DAY_MS).toISOString().slice(0, 10);

// Position-weighted sum: catches any single misread square and most swaps.
const checksum = (bits: number[]) => bits.reduce((sum, bit, i) => sum + bit * (i + 1), 0) % 2 ** CHECK_BITS;

function pushNumber(bits: number[], value: number, width: number) {
  for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
}

function readNumber(bits: number[], start: number, width: number) {
  let value = 0;
  for (let i = 0; i < width; i++) value = value * 2 + bits[start + i];
  return value;
}

/** The squares to print, 1 = filled. Throws for values the strip can't hold. */
export function encodeSheetCode(code: SheetCode): number[] {
  const values = { version: code.version, continuation: code.continuation ? 1 : 0, barangay: code.barangay, day: toDay(code.censusDate), sheetNumber: code.sheetNumber };
  const bits: number[] = [];
  for (const [key, width] of FIELDS) {
    const value = values[key];
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) throw new RangeError(`The sheet's ${key} can't be printed in the code strip.`);
    pushNumber(bits, value, width);
  }
  pushNumber(bits, checksum(bits), CHECK_BITS);
  return bits;
}

/** The sheet's code, or `null` when the squares don't form a valid code. */
export function decodeSheetCode(bits: number[]): SheetCode | null {
  if (bits.length !== CODE_BITS) return null;
  const payload = bits.slice(0, CODE_BITS - CHECK_BITS);
  if (readNumber(bits, payload.length, CHECK_BITS) !== checksum(payload)) return null;
  const values: Record<string, number> = {};
  let at = 0;
  for (const [key, width] of FIELDS) {
    values[key] = readNumber(bits, at, width);
    at += width;
  }
  if (!SUPPORTED_VERSIONS.includes(values.version)) return null;
  return { version: values.version, continuation: values.continuation === 1, barangay: values.barangay, censusDate: fromDay(values.day), sheetNumber: values.sheetNumber };
}
