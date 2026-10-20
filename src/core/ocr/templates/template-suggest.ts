/**
 * Template Suggestions
 * After pages are read, scores every template by how much of it was found
 * — form fields whose labels appear (English or Filipino wordings), table
 * headings that match — and suggests the best one when it clearly fits
 * ("This looks like a Pet registration form: 9 of 13 fields found").
 * Deterministic: it reuses the field mapping, no language model involved.
 */

import { mapFormFields, type MappingPage } from "@/core/ocr/templates/field-mapping";
import { bestLabelScore } from "@/core/ocr/templates/text-match";
import type { DocumentTemplateDef } from "@/core/ocr/templates/template-schema";

export interface TemplateMatch {
  template: DocumentTemplateDef;
  /** 0–1: share of the template's fields (or table columns) found. */
  score: number;
  found: number;
  total: number;
}

const HEADER_MATCH = 0.66;
/** At least this share of a template must be found before it's suggested. */
const SUGGEST_AT = 0.4;

function score(template: DocumentTemplateDef, pages: MappingPage[]): TemplateMatch {
  if (template.kind === "form") {
    const best = Math.max(0, ...pages.map((page) => mapFormFields(template.fields, page).matched));
    return { template, score: best / Math.max(1, template.fields.length), found: best, total: template.fields.length };
  }
  const columns = template.tables.flatMap((t) => t.columns);
  const headers = pages.flatMap((p) => (p.layout?.tables ?? []).filter((t) => t.headerRows > 0).flatMap((t) => t.rows[0].cells.map((c) => c.text)));
  const found = columns.filter((c) => headers.some((h) => h && bestLabelScore(h, c.label, c.aliases) >= HEADER_MATCH)).length;
  return { template, score: found / Math.max(1, columns.length), found, total: columns.length };
}

/** Templates that fit the pages, best first (only those above the suggestion threshold). */
export function suggestTemplates(templates: DocumentTemplateDef[], pages: MappingPage[]): TemplateMatch[] {
  return templates
    .map((t) => score(t, pages))
    .filter((m) => m.score >= SUGGEST_AT && m.found >= 2)
    .sort((a, b) => b.score - a.score || b.found - a.found);
}
