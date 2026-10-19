/**
 * Label Matching & Value Parsing
 * Fuzzy comparison of printed labels with template labels (tolerant of OCR
 * slips, punctuation and word order: "Owners Name" ≈ "Owner's name"), and
 * parsing of read values into typed values: numbers, dates in the formats
 * forms use ("10/18/2026", "Oct. 18, 2026", "18 October 2026"), yes/no and
 * ticks, and choices. Values that don't parse are reported, never guessed.
 */

import { parseBoolean, parseDate, parseNumber } from "@/core/processing/dataset-inference";
import type { FieldType } from "@/types/ocr";

export function normalizeLabel(text: string) {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

function bigrams(text: string) {
  const s = text.replace(/\s+/g, "");
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient over character bigrams, 0–1. */
export function diceSimilarity(a: string, b: string) {
  if (a === b) return 1;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    overlap += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

/** How well a printed label matches a template label, 0–1. */
export function labelSimilarity(printed: string, expected: string) {
  const a = normalizeLabel(printed);
  const b = normalizeLabel(expected);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dice = diceSimilarity(a, b);
  // Same words in another order, or a printed label with extra words around the expected one.
  const ta = new Set(a.split(" "));
  const tb = b.split(" ");
  const contained = tb.every((t) => ta.has(t)) ? 0.9 - 0.04 * Math.max(0, ta.size - tb.length) : 0;
  return Math.max(dice, contained);
}

export function bestLabelScore(printed: string, label: string, aliases: string[] = []) {
  return Math.max(...[label, ...aliases].map((l) => labelSimilarity(printed, l)));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Dates as forms write them; month-first for numeric dates (as in the Philippines). */
export function parseFormDate(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  const iso = parseDate(text);
  if (iso) return iso;
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (numeric) return isoDate(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
  const named = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i.exec(text) ?? null;
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase()) + 1;
    return month ? isoDate(Number(named[3]), month, Number(named[2])) : null;
  }
  const dayFirst = /^(\d{1,2}) ([a-z]{3,9})\.?,? (\d{4})$/i.exec(text);
  if (dayFirst) {
    const month = MONTHS.indexOf(dayFirst[2].slice(0, 3).toLowerCase()) + 1;
    return month ? isoDate(Number(dayFirst[3]), month, Number(dayFirst[1])) : null;
  }
  return null;
}

const TICKS = /^(✓|✔|☑|x|\/)$/i;

export function parseFormBoolean(raw: string): boolean | null {
  const text = raw.trim();
  if (TICKS.test(text) || /^(oo|opo)$/i.test(text)) return true;
  if (/^(hindi|wala)$/i.test(text)) return false;
  return parseBoolean(text);
}

export function matchChoice(raw: string, options: string[]): string | null {
  const text = normalizeLabel(raw);
  if (!text) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const option of options) {
    const score = labelSimilarity(text, option);
    if (score > bestScore) [best, bestScore] = [option, score];
  }
  return bestScore >= 0.75 ? best : null;
}

/** OCR slips in digits: O→0, l/I/|→1, S→5, B→8 — offered as a suggestion, never applied silently. */
export function digitSuggestion(raw: string): string | null {
  if (!/\d/.test(raw)) return null;
  const fixed = raw.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
  return fixed !== raw && parseNumber(fixed) !== null ? fixed : null;
}

/** True when `text` is a valid value of `type` (empty counts as valid — it's handled as missing). */
export function fitsType(type: FieldType, text: string, options?: string[]) {
  const value = text.trim();
  if (!value) return true;
  if (type === "number") return parseNumber(value) !== null;
  if (type === "date") return parseFormDate(value) !== null;
  if (type === "boolean") return parseFormBoolean(value) !== null;
  if (type === "choice") return options ? matchChoice(value, options) !== null : true;
  return true;
}
