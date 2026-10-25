/**
 * Program Calendar
 * The days a month view shows: whole weeks from Sunday, so the first and
 * last rows include days of the months around it, as "YYYY-MM-DD" strings
 * (the same form as a program's date).
 */

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** `month` is 0-based, like `Date.getMonth()`. */
export function monthGrid(year: number, month: number): string[] {
  const offset = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => iso(new Date(year, month, index - offset + 1)));
}

/** "2026-10" for October 2026: the prefix every date in that month starts with. */
export const monthKey = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, "0")}`;
