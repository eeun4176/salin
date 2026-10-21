/**
 * Requested Columns
 * "What do you need from this page?" — the user names the columns
 * ("Name, Address, Birthday") and whether each page is one record or a list
 * of records, and that becomes a small template: only those columns, in
 * that order. Values are then found the usual way (labels for forms,
 * headings for lists); a list whose headings don't match is filled by
 * column position instead, and says so. Nothing found stays empty, to be
 * typed, tapped from the page, or found by the assistant.
 */

import { extractDocument, recordsFromTable, type MappingPage } from "@/core/ocr/templates/field-mapping";
import { keyFromLabel, parseTemplate, type DocumentTemplateDef } from "@/core/ocr/templates/template-schema";
import type { Extraction } from "@/types/ocr";

/** Templates made from requested columns (saved, so the same set can be picked again). */
export const REQUESTED_PREFIX = "asked-";
export const MAX_REQUESTED_COLUMNS = 20;

/** form = one record per page; table = a list of records on each page. */
export type RecordShape = "form" | "table";

/** "Name, address\nName" → ["Name", "address"]: trimmed, without repeats, at most 20. */
export function parseColumnList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,;\n]/)
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 120))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
    .slice(0, MAX_REQUESTED_COLUMNS);
}

export const isRequested = (template: DocumentTemplateDef | null) => Boolean(template?.id.startsWith(REQUESTED_PREFIX));

/** The column names of a requested template, in order. */
export const requestedColumns = (template: DocumentTemplateDef) => (template.kind === "form" ? template.fields : (template.tables[0]?.columns ?? [])).map((c) => c.label);

export function requestedTemplate(id: string, labels: string[], shape: RecordShape): DocumentTemplateDef {
  const seen = new Set<string>();
  const columns = labels.map((label, i) => {
    let key = keyFromLabel(label);
    if (seen.has(key)) key = `${key}_${i + 1}`;
    seen.add(key);
    return { key, label, type: "text" as const, required: false };
  });
  return parseTemplate({
    id,
    name: labels.join(", ").slice(0, 120),
    description: "Columns you asked for.",
    kind: shape,
    fields: shape === "form" ? columns : [],
    tables: shape === "table" ? [{ key: "records", label: "Records", columns, minMatched: 1 }] : [],
  });
}

/** Lists, fields and text found on read pages suggest the shape: a list when some page has several table rows. */
export function guessShape(extraction: Extraction | null): RecordShape {
  const tables = extraction?.tables.filter((t) => t.key !== "text") ?? [];
  return tables.some((t) => new Set(t.rows.map((r) => r.page)).size < t.rows.length) ? "table" : "form";
}

/** Labels already found on the pages (fields and column headings), to tap instead of typing. */
export function foundLabels(extraction: Extraction | null): string[] {
  if (!extraction) return [];
  const labels = [...extraction.forms.flatMap((f) => f.fields.map((x) => x.label)), ...extraction.tables.filter((t) => t.key !== "text").flatMap((t) => t.columns.map((c) => c.label))];
  return parseColumnList(labels.filter((l) => !/^column \d+$/i.test(l)).join(","));
}

/** Maps read pages onto a requested template. */
export function extractRequested(template: DocumentTemplateDef, pages: MappingPage[]): Extraction {
  const extraction = extractDocument(template, pages);
  if (extraction.forms.length === 0 && extraction.tables.length === 0) return extraction; // nothing readable
  // "Doesn't look like a …" is about built-in layouts; here the user said what to look for.
  const warnings = extraction.warnings.filter((w) => !w.includes("doesn't look like"));
  const set = extraction.tables[0];
  if (template.kind === "form" || set.rows.length) return { ...extraction, warnings, unsupported: null };

  // No heading matched: fill the columns from each detected table by position.
  for (const page of pages) for (const table of page.layout?.tables ?? []) set.rows.push(...recordsFromTable(set, null, table, page.page));
  if (set.rows.length) {
    return { ...extraction, warnings: [...warnings, "No headings matched the columns you asked for, so they were filled in the order they appear on the page — check them."], unsupported: null };
  }
  return { ...extraction, warnings, unsupported: "No list was found on these pages. Use “Redraw table area” and drag around the list, or add rows and type the values." };
}
