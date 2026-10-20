/**
 * Review Suggestions
 * Proposed changes to extracted values, kept apart from the values
 * themselves until the reviewer accepts them: deterministic rules first
 * (common OCR slips in numbers and dates, standard forms for sex, species,
 * yes/no and dates, a value that landed in the wrong column), then
 * handwriting readings and local-AI corrections or requested fields — each
 * checked for grounding in the page. Accepting applies the value through
 * the normal review edit (so what OCR read stays recorded), rejecting keeps
 * the decision on record. Nothing here guesses a missing value.
 */

import { findOnPage, isCloseCorrection, textSimilarity } from "@/core/ai/grounding";
import { editValue, reassignValue, refKey, reviewItems, splitCellId, updateValue, type ReviewItem } from "@/core/ocr/review/review-state";
import { digitSuggestion, fitsType, parseFormDate } from "@/core/ocr/templates/text-match";
import type { DocumentTemplateDef } from "@/core/ocr/templates/template-schema";
import { normalizeValue, ruleForLabel, type NormalizeRule } from "@/core/processing/value-normalizers";
import type { Box, Extraction, OcrWord, Suggestion, SuggestionSource, ValueRef } from "@/types/ocr";

type NewSuggestion = Omit<Suggestion, "id" | "status">;

const suggestion = (s: NewSuggestion): Suggestion => ({ ...s, id: crypto.randomUUID(), status: "pending" });

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function spellDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Same fixes as numbers get, for dates read with letters in them ("1O/I8/2O26"). */
function dateSlipFix(text: string) {
  const fixed = text.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
  return fixed !== text && parseFormDate(fixed) ? fixed : null;
}

/** Fields whose values have a standard form, by key (from the template) or by label. */
export type RuleLookup = (item: ReviewItem) => NormalizeRule | null;
export const ruleFromLabel: RuleLookup = (item) => ruleForLabel(item.spec.label);

/** The template's normalization rules (fields, totals and table columns), falling back to label hints. */
export function templateRules(template: DocumentTemplateDef | null, extraction: Extraction): RuleLookup {
  if (!template) return ruleFromLabel;
  const byKey = new Map<string, NormalizeRule>();
  for (const f of [...template.fields, ...template.summaries]) if (f.normalize) byKey.set(f.key, f.normalize);
  for (const t of template.tables) for (const c of t.columns) if (c.normalize) byKey.set(`${t.key}.${c.key}`, c.normalize);
  return (item) => {
    const key = item.ref.kind === "table" ? `${extraction.tables[item.ref.group]?.key}.${splitCellId(item.ref.id)[1]}` : item.ref.id;
    return byKey.get(key) ?? ruleFromLabel(item);
  };
}

/**
 * Deterministic suggestions for values OCR read (never for empty values or
 * values the reviewer typed or already checked).
 */
export function ruleSuggestions(extraction: Extraction, ruleFor: RuleLookup = ruleFromLabel): Suggestion[] {
  const out: Suggestion[] = [];
  const items = reviewItems(extraction);
  for (const item of items) {
    const { value, spec, ref } = item;
    const text = value.text.trim();
    if (!text || value.edited || value.confirmed) continue;
    const base = { ref, source: "rule" as const, before: value.text, grounded: true, confidence: null };

    if (spec.type === "number" && !fitsType("number", text)) {
      const fixed = digitSuggestion(text);
      if (fixed) out.push(suggestion({ ...base, kind: "correction", after: fixed, reason: "Letters that look like digits (O→0, l→1, S→5, B→8) — a common text-recognition slip." }));
    } else if (spec.type === "date") {
      const iso = parseFormDate(text);
      const fixed = iso ? null : dateSlipFix(text);
      if (fixed) out.push(suggestion({ ...base, kind: "correction", after: fixed, reason: "Letters that look like digits in a date — a common text-recognition slip." }));
      else if (iso && iso !== text) {
        const [month, day] = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}$/.exec(text)?.slice(1).map(Number) ?? [];
        const ambiguous = month !== undefined && month <= 12 && day <= 12 && month !== day;
        out.push(
          suggestion({ ...base, kind: "standardize", after: iso, reason: `The same date written the standard way (${spellDate(iso)}${ambiguous ? " — read month first; check the page if it's day first" : ""}).` }),
        );
      }
    }

    const rule = ruleFor(item);
    if (rule && spec.type !== "number") {
      const normalized = normalizeValue(rule, text);
      if (typeof normalized === "string" && normalized !== text && !(spec.type === "choice" && spec.options && !spec.options.includes(normalized))) {
        out.push(suggestion({ ...base, kind: "standardize", after: normalized, reason: `“${text}” is written in standard form as “${normalized}”.` }));
      }
    }
  }
  // A date can be both a date field and have a "date" rule: offer each change once.
  const seen = new Set<string>();
  return [...out, ...moveSuggestions(extraction)].filter((s) => {
    const key = `${refKey(s.ref)}→${s.after}`;
    return !seen.has(key) && seen.add(key);
  });
}

/** A typed value that doesn't fit its column but fits an empty neighbouring one: the columns probably shifted. */
function moveSuggestions(extraction: Extraction): Suggestion[] {
  const out: Suggestion[] = [];
  extraction.tables.forEach((set, group) => {
    for (const row of set.rows) {
      set.columns.forEach((column, c) => {
        const value = row.cells[column.key];
        const text = value?.text.trim();
        if (!value || !text || value.edited || value.confirmed || fitsType(column.type, text, column.options)) return;
        for (const n of [c + 1, c - 1]) {
          const neighbour = set.columns[n];
          const target = neighbour && row.cells[neighbour.key];
          if (!target || target.text.trim() || neighbour.type === "text" || !fitsType(neighbour.type, text, neighbour.options)) continue;
          out.push(
            suggestion({
              ref: { kind: "table", group, id: `${row.id}:${column.key}` },
              to: { kind: "table", group, id: `${row.id}:${neighbour.key}` },
              kind: "move",
              source: "rule",
              before: value.text,
              after: text,
              reason: `“${text}” doesn't look like ${column.label} but fits the empty ${neighbour.label} next to it — the columns may have shifted.`,
              grounded: true,
              confidence: null,
            }),
          );
          break;
        }
      });
    }
  });
  return out;
}

/* ------------------------------------------------------------------
   Handwriting and local-AI suggestions
------------------------------------------------------------------- */

/** Handwriting readings below this confidence are not offered — the value is flagged for typing instead. */
export const HANDWRITING_MIN_CONFIDENCE = 0.75;

export interface HandwritingReading {
  ref: ValueRef;
  text: string;
  /** 0–1. */
  confidence: number;
}

/**
 * Turns handwriting readings of value regions into suggestions. Readings that
 * aren't confident enough flag the value as illegible instead, so the
 * reviewer types it from the close-up.
 */
export function withHandwritingReadings(extraction: Extraction, readings: HandwritingReading[]): Extraction {
  const items = new Map(reviewItems(extraction).map((i) => [refKey(i.ref), i]));
  const fresh: Suggestion[] = [];
  let next = extraction;
  for (const reading of readings) {
    const item = items.get(refKey(reading.ref));
    if (!item || item.value.edited) continue;
    const text = reading.text.trim();
    if (!text || reading.confidence < HANDWRITING_MIN_CONFIDENCE) {
      if (text) next = updateValue(next, reading.ref, (v) => (v.flags.includes("illegible") ? v : { ...v, flags: [...v.flags, "illegible"] }));
      continue;
    }
    if (textSimilarity(text, item.value.text) === 1) continue;
    fresh.push(
      suggestion({
        ref: reading.ref,
        kind: item.value.text.trim() ? "correction" : "fill",
        source: "handwriting",
        before: item.value.text,
        after: text,
        reason: `Read from the handwriting in this field's box (${Math.round(reading.confidence * 100)}% sure). Compare with the close-up.`,
        grounded: true,
        confidence: reading.confidence,
      }),
    );
  }
  return { ...next, suggestions: mergeSuggestions(next.suggestions, fresh, "handwriting") };
}

/** Local-AI fixes of OCR slips: grounded only when they change a small part of what was read. */
export function correctionSuggestions(extraction: Extraction, corrections: Map<string, string>): Suggestion[] {
  const items = new Map(reviewItems(extraction).map((i) => [refKey(i.ref), i]));
  return [...corrections].flatMap(([key, after]) => {
    const item = items.get(key);
    if (!item || item.value.edited || !item.value.text.trim()) return [];
    const grounded = isCloseCorrection(item.value.text, after);
    return [
      suggestion({
        ref: item.ref,
        kind: "correction",
        source: "ai",
        before: item.value.text,
        after,
        reason: grounded ? "Likely a text-recognition slip (suggested by the on-device assistant)." : "Not found on page — this changes more than a few characters of what was read. Check the page before using it.",
        grounded,
        confidence: null,
      }),
    ];
  });
}

/**
 * A value the local AI found for a requested field: grounded (with its page
 * region) only when it matches words read on the page.
 */
export function fieldSuggestion(ref: ValueRef, before: string, value: string, page: number, words: OcrWord[]): Suggestion {
  const match = findOnPage(value, words);
  return suggestion({
    ref,
    kind: before.trim() ? "correction" : "fill",
    source: "ai",
    before,
    after: match ? match.text : value,
    reason: match ? `Found on page ${page} by the on-device assistant.` : "Not found on page — the assistant gave a value that isn't in the text read from this page.",
    grounded: match !== null,
    confidence: match ? Math.round(match.score * 100) / 100 : null,
    page: match ? page : null,
    box: match?.box ?? null,
  });
}

/* ------------------------------------------------------------------
   Keeping, accepting and rejecting
------------------------------------------------------------------- */

/**
 * Adds a fresh batch from one source: earlier pending suggestions from that
 * source for the same values are replaced; decided ones are kept, and a
 * suggestion already accepted or rejected is never offered again.
 */
export function mergeSuggestions(existing: Suggestion[] = [], fresh: Suggestion[], source: SuggestionSource): Suggestion[] {
  const refreshed = new Set(fresh.map((s) => refKey(s.ref)));
  const kept = existing.filter((s) => s.status !== "pending" || s.source !== source || !refreshed.has(refKey(s.ref)));
  const seen = new Set(kept.map((s) => `${refKey(s.ref)}→${s.after}`));
  return [...kept, ...fresh.filter((s) => !seen.has(`${refKey(s.ref)}→${s.after}`))];
}

/** Pending suggestions that still apply (the value hasn't changed since they were made). */
export function pendingSuggestions(extraction: Extraction): Suggestion[] {
  const current = new Map(reviewItems(extraction).map((i) => [refKey(i.ref), i.value.text]));
  return (extraction.suggestions ?? []).filter((s) => s.status === "pending" && current.get(refKey(s.ref)) === s.before);
}

function decide(extraction: Extraction, id: string, status: "accepted" | "rejected"): Extraction {
  return { ...extraction, suggestions: (extraction.suggestions ?? []).map((s) => (s.id === id ? { ...s, status, decidedAt: Date.now() } : s)) };
}

const mark = (extraction: Extraction, ref: ValueRef, source: SuggestionSource) => updateValue(extraction, ref, (v) => ({ ...v, suggestedBy: source }));

/**
 * Applies a suggestion (optionally as edited by the reviewer). An edited
 * value is the reviewer's own; an unedited one is marked as suggested, so
 * the dataset records where it came from.
 */
export function acceptSuggestion(extraction: Extraction, id: string, edited?: string): Extraction {
  const s = extraction.suggestions?.find((x) => x.id === id);
  if (!s) return extraction;
  const text = edited ?? s.after;
  let next = extraction;
  if (s.kind === "move" && s.to) {
    next = editValue(next, s.to, text);
    next = editValue(next, s.ref, "");
    if (text === s.after) next = mark(next, s.to, s.source);
  } else if (s.box && s.page && text === s.after) {
    next = mark(reassignValue(next, s.ref, { text, confidence: s.confidence === null ? null : s.confidence * 100, page: s.page, box: s.box as Box }), s.ref, s.source);
  } else {
    next = editValue(next, s.ref, text);
    if (text === s.after) next = mark(next, s.ref, s.source);
  }
  return decide(next, id, "accepted");
}

export function rejectSuggestion(extraction: Extraction, id: string): Extraction {
  return decide(extraction, id, "rejected");
}

/** The record set column a table ref points at (for labels in the suggestions list). */
export function refLabel(extraction: Extraction, ref: ValueRef): string {
  if (ref.kind === "table") {
    const set = extraction.tables[ref.group];
    const [rowId, key] = splitCellId(ref.id);
    const n = set ? set.rows.findIndex((r) => r.id === rowId) + 1 : 0;
    return `${set?.columns.find((c) => c.key === key)?.label ?? key}, record ${n}`;
  }
  const fields = ref.kind === "form" ? extraction.forms[ref.group]?.fields : extraction.summaries;
  const label = fields?.find((f) => f.key === ref.id)?.label ?? ref.id;
  return ref.kind === "form" && extraction.forms.length > 1 ? `${label} (page ${extraction.forms[ref.group].page})` : label;
}
