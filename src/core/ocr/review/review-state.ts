/**
 * Review States
 * Decides each extracted value's review state — Ready, Needs review,
 * Unreadable or Missing — from its flags, confidence and whether the
 * reviewer confirmed or corrected it; explains flags in plain words;
 * counts states across a document; and lists the critical (required)
 * values that must be resolved before a dataset can be created. Also the
 * immutable edit helpers the review screen uses.
 */

import { fitsType } from "@/core/ocr/templates/text-match";
import type { ExtractedField, ExtractedValue, Extraction, FieldSpec, ReviewState, ValueFlag, ValueRef } from "@/types/ocr";

export type { ValueRef };

/** Below this OCR confidence (with text read) a value counts as unreadable until checked. */
export const UNREADABLE_BELOW = 40;

export function valueState(value: ExtractedValue, spec: Pick<FieldSpec, "required">): ReviewState {
  const resolved = value.edited || value.confirmed;
  if (!value.text.trim()) {
    if (resolved && !spec.required) return "ready";
    // A region that holds marks OCR couldn't turn into text.
    if (!resolved && value.ocrText !== null && value.ocrText.trim() === "" && value.box && value.flags.includes("checkbox-unclear")) return "unreadable";
    return spec.required ? "missing" : "ready";
  }
  if (resolved) return "ready";
  if (value.flags.includes("illegible") || (value.ocrConfidence !== null && value.ocrConfidence < UNREADABLE_BELOW)) return "unreadable";
  return value.flags.length ? "needs_review" : "ready";
}

export const STATE_LABEL: Record<ReviewState, string> = {
  ready: "Ready",
  needs_review: "Needs review",
  unreadable: "Unreadable",
  missing: "Missing",
};

export const FLAG_TEXT: Record<ValueFlag, string> = {
  "low-confidence": "The text was hard to read.",
  "unclear-characters": "Some characters are unclear.",
  "ambiguous-mapping": "Not sure this text belongs to this field.",
  "checkbox-unclear": "The checkbox mark is unclear.",
  "type-mismatch": "Doesn't look like the expected kind of value.",
  "possibly-handwritten": "Possibly handwritten — handwriting recognition is experimental.",
  "count-mismatch": "Doesn't match the number of records read.",
  illegible: "Handwriting couldn't be read reliably — type what you see in the close-up.",
};

export function describeFlags(value: ExtractedValue) {
  return value.flags.map((f) => FLAG_TEXT[f]);
}

/** A stable string for a value reference (selection, DOM lookups). */
export const refKey = (ref: ValueRef) => `${ref.kind}:${ref.group}:${ref.id}`;

export interface ReviewItem {
  ref: ValueRef;
  spec: FieldSpec;
  value: ExtractedValue;
  state: ReviewState;
}

/** Every value in the extraction, in display order. */
export function reviewItems(extraction: Extraction): ReviewItem[] {
  const items: ReviewItem[] = [];
  extraction.forms.forEach((form, g) =>
    form.fields.forEach((field) => items.push({ ref: { kind: "form", group: g, id: field.key }, spec: field, value: field.value, state: valueState(field.value, field) })),
  );
  extraction.tables.forEach((set, g) =>
    set.rows.forEach((row) =>
      set.columns.forEach((column) => {
        const value = row.cells[column.key];
        if (value) items.push({ ref: { kind: "table", group: g, id: `${row.id}:${column.key}` }, spec: column, value, state: valueState(value, column) });
      }),
    ),
  );
  extraction.summaries.forEach((field) => items.push({ ref: { kind: "summary", group: 0, id: field.key }, spec: field, value: field.value, state: valueState(field.value, field) }));
  return items;
}

export function stateCounts(extraction: Extraction): Record<ReviewState, number> {
  const counts: Record<ReviewState, number> = { ready: 0, needs_review: 0, unreadable: 0, missing: 0 };
  for (const item of reviewItems(extraction)) counts[item.state]++;
  return counts;
}

/** Required values that are missing, unreadable or unchecked: these block creating the dataset. */
export function unresolvedCritical(extraction: Extraction) {
  return reviewItems(extraction).filter((item) => item.spec.required && item.state !== "ready");
}

/* ------------------------------------------------------------------
   Edits
------------------------------------------------------------------- */

export function updateValue(extraction: Extraction, ref: ValueRef, change: (value: ExtractedValue, spec: FieldSpec) => ExtractedValue): Extraction {
  if (ref.kind === "form") {
    return {
      ...extraction,
      forms: extraction.forms.map((form, g) => (g !== ref.group ? form : { ...form, fields: form.fields.map((f): ExtractedField => (f.key === ref.id ? { ...f, value: change(f.value, f) } : f)) })),
    };
  }
  if (ref.kind === "summary") {
    return { ...extraction, summaries: extraction.summaries.map((f) => (f.key === ref.id ? { ...f, value: change(f.value, f) } : f)) };
  }
  const [rowId, key] = splitCellId(ref.id);
  return {
    ...extraction,
    tables: extraction.tables.map((set, g) => {
      if (g !== ref.group) return set;
      const spec = set.columns.find((c) => c.key === key)!;
      return { ...set, rows: set.rows.map((row) => (row.id !== rowId ? row : { ...row, cells: { ...row.cells, [key]: change(row.cells[key], spec) } })) };
    }),
  };
}

export function splitCellId(id: string): [string, string] {
  const cut = id.lastIndexOf(":");
  return [id.slice(0, cut), id.slice(cut + 1)];
}

/** The reviewer typed a value: it's theirs now (still traceable to what OCR read). */
export function editValue(extraction: Extraction, ref: ValueRef, text: string): Extraction {
  return updateValue(extraction, ref, (value, spec) => {
    const flags: ValueFlag[] = value.flags.filter((f) => f !== "type-mismatch");
    if (text && !fitsType(spec.type, text, spec.options)) flags.push("type-mismatch");
    // Typing over an accepted suggestion makes the value the reviewer's own.
    return { ...value, suggestedBy: undefined, text, edited: text !== (value.ocrText ?? ""), confirmed: true, flags };
  });
}

export function confirmValue(extraction: Extraction, ref: ValueRef, confirmed = true): Extraction {
  return updateValue(extraction, ref, (value) => ({ ...value, confirmed }));
}

/** The reviewer pointed at a different region of the page for this value. */
export function reassignValue(extraction: Extraction, ref: ValueRef, source: { text: string; confidence: number | null; page: number; box: ExtractedValue["box"] }): Extraction {
  return updateValue(extraction, ref, (value) => ({
    ...value,
    text: source.text,
    ocrText: source.text,
    ocrConfidence: source.confidence,
    mappingConfidence: 1,
    page: source.page,
    box: source.box,
    flags: value.flags.filter((f) => f !== "ambiguous-mapping"),
    edited: false,
    confirmed: true,
  }));
}

/** Adds an empty row to a record set (for records OCR missed) — typed in by the reviewer. */
export function addRow(extraction: Extraction, group: number, page: number): Extraction {
  return {
    ...extraction,
    tables: extraction.tables.map((set, g) => {
      if (g !== group) return set;
      const cells = Object.fromEntries(
        set.columns.map((c) => [c.key, { text: "", ocrText: null, ocrConfidence: null, mappingConfidence: null, page, box: null, flags: [], note: "Added by hand.", edited: true, confirmed: true } satisfies ExtractedValue]),
      );
      return { ...set, rows: [...set.rows, { id: `manual-${crypto.randomUUID()}`, page, box: null, cells }] };
    }),
  };
}

export function removeRow(extraction: Extraction, group: number, rowId: string): Extraction {
  return { ...extraction, tables: extraction.tables.map((set, g) => (g !== group ? set : { ...set, rows: set.rows.filter((r) => r.id !== rowId) })) };
}

/** Marks every value as checked (after the reviewer looked over the whole page). */
export function confirmAll(extraction: Extraction, filter: (item: ReviewItem) => boolean = () => true): Extraction {
  let next = extraction;
  for (const item of reviewItems(extraction)) if (filter(item)) next = confirmValue(next, item.ref);
  return next;
}
