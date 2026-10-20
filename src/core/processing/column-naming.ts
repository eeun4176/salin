/**
 * Column Naming
 * Suggests a name for a column that has none ("Column 3") from what its
 * values look like — sex, species, yes/no, dates, phone numbers, barangay
 * or purok addresses — so a table read without headings can still become
 * a readable dataset. Deterministic and conservative: no suggestion unless
 * most values clearly fit. The on-device assistant can suggest the rest.
 */

import { parseFormBoolean, parseFormDate } from "@/core/ocr/templates/text-match";
import { normalizeValue } from "@/core/processing/value-normalizers";

/** Placeholder names given to unnamed columns. */
export const PLACEHOLDER_NAME = /^Column \w+( \(\d+\))?$/;

const PHONE = /^(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}$/;
const ADDRESS = /\b(purok|brgy\.?|barangay|sitio|street|st\.)\b/i;

const RULES: [string, (value: string) => boolean][] = [
  ["Sex", (v) => normalizeValue("sex", v) !== v || /^(male|female)$/i.test(v)],
  ["Species", (v) => normalizeValue("species", v) !== v || /^(dog|cat)$/i.test(v)],
  ["Date", (v) => parseFormDate(v) !== null],
  ["Contact no.", (v) => PHONE.test(v.replace(/\s+/g, ""))],
  ["Yes / no", (v) => parseFormBoolean(v) !== null],
  ["Address", (v) => ADDRESS.test(v)],
];

/** A name for a column from its values, when at least 80% of the filled values clearly fit one kind. */
export function suggestColumnName(values: string[]): string | null {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (filled.length < 2) return null;
  for (const [name, fits] of RULES) {
    if (filled.filter(fits).length / filled.length >= 0.8) return name;
  }
  return null;
}
