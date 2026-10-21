/**
 * Value Normalizers
 * Deterministic rules that put common values into one standard form —
 * trimming and letter case, sex ("M", "lalaki" → "Male"), species ("aso" →
 * "Dog"), yes/no ("oo", "✓" → Yes) and dates ("Oct. 18, 2026" →
 * "2026-10-18"). A value a rule doesn't recognise is returned unchanged, so
 * a rule never invents data. Used by dataset commands and by review
 * suggestions (with the original value always kept beside the suggestion).
 */

import { parseFormBoolean, parseFormDate } from "@/core/ocr/templates/text-match";
import type { CellValue, ColumnType } from "@/types/processing";

export type NormalizeRule = "trim" | "uppercase" | "lowercase" | "title_case" | "sex" | "species" | "yes_no" | "date";

export const NORMALIZE_RULES: Record<NormalizeRule, { label: string; example: string }> = {
  trim: { label: "Remove extra spaces", example: "“ Juan  Cruz ” → “Juan Cruz”" },
  uppercase: { label: "UPPERCASE", example: "“muzon” → “MUZON”" },
  lowercase: { label: "lowercase", example: "“MUZON” → “muzon”" },
  title_case: { label: "Title Case (names, places)", example: "“juan dela cruz” → “Juan Dela Cruz”" },
  sex: { label: "Sex → Male / Female", example: "“M”, “lalaki” → “Male”" },
  species: { label: "Species → Dog / Cat", example: "“aso”, “canine” → “Dog”" },
  yes_no: { label: "Yes / No", example: "“oo”, “✓”, “Y” → Yes" },
  date: { label: "Date → YYYY-MM-DD", example: "“Oct. 18, 2026” → “2026-10-18”" },
};

const SEX: Record<string, string> = { m: "Male", male: "Male", males: "Male", man: "Male", men: "Male", boy: "Male", boys: "Male", lalaki: "Male", lalake: "Male", f: "Female", female: "Female", females: "Female", woman: "Female", women: "Female", girl: "Female", girls: "Female", babae: "Female" };
const SPECIES: Record<string, string> = { dog: "Dog", dogs: "Dog", aso: "Dog", canine: "Dog", k9: "Dog", cat: "Cat", cats: "Cat", pusa: "Cat", feline: "Cat" };
// Roman numerals and initials-like suffixes stay uppercase in names ("Juan Cruz III").
const KEEP_UPPER = /^(i{1,3}|iv|v|vi{0,3}|jr|sr)\.?$/i;

const key = (text: string) => text.trim().toLowerCase().replace(/[.\s]+$/, "");

function titleCase(text: string) {
  return text.replace(/\S+/g, (word) => (KEEP_UPPER.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()));
}

/**
 * Applies `rule` to one value. Values the rule doesn't recognise come back
 * unchanged. `type` is the column's type (yes/no becomes a boolean in yes/no
 * columns and "Yes"/"No" text elsewhere).
 */
export function normalizeValue(rule: NormalizeRule, value: CellValue, type: ColumnType = "text"): CellValue {
  if (value === null) return null;
  if (typeof value !== "string") {
    if (rule === "yes_no" && typeof value === "boolean" && type !== "boolean") return value ? "Yes" : "No";
    return value;
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  switch (rule) {
    case "trim":
      return collapsed;
    case "uppercase":
      return collapsed.toUpperCase();
    case "lowercase":
      return collapsed.toLowerCase();
    case "title_case":
      return titleCase(collapsed);
    case "sex":
      return SEX[key(collapsed)] ?? value;
    case "species":
      return SPECIES[key(collapsed)] ?? value;
    case "yes_no": {
      const yes = parseFormBoolean(collapsed) ?? (/^(vaccinated|bakunado|1)$/i.test(collapsed) ? true : /^(not vaccinated|none|0)$/i.test(collapsed) ? false : null);
      if (yes === null) return value;
      return type === "boolean" ? yes : yes ? "Yes" : "No";
    }
    case "date":
      return parseFormDate(collapsed) ?? value;
  }
}

/** Rules that make sense for a column of `type` (dates only for text/date columns, and so on). */
export function rulesFor(type: ColumnType): NormalizeRule[] {
  if (type === "number") return [];
  if (type === "boolean") return ["yes_no"];
  if (type === "date") return ["date"];
  return Object.keys(NORMALIZE_RULES) as NormalizeRule[];
}

/** A rule suggested by a field's label, for review suggestions ("Kasarian" → sex). */
export function ruleForLabel(label: string): NormalizeRule | null {
  const text = label.toLowerCase();
  if (/\b(sex|gender|kasarian)\b/.test(text)) return "sex";
  if (/\b(species|kind of animal|type of pet|uri ng hayop)\b/.test(text)) return "species";
  if (/\b(vaccinated|vaccine|bakuna|neutered|spayed|castrated)\b/.test(text) && !/date|petsa/.test(text)) return "yes_no";
  return null;
}
