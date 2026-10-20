/**
 * OCR → Dataset
 * Converts a reviewed extraction into Phase 3 dataset content, so OCR
 * results use the same columns, typing, validation, editing and export as
 * every other dataset: filled-in forms become one dataset (a row per form),
 * each record table its own dataset, and document totals a one-row
 * "Summary" dataset. Template field types set the column types (generic
 * mode detects them like Phase 3 does). Every row keeps its source file,
 * page, the page region of the record and of each value, and what OCR
 * originally read wherever the reviewer corrected it.
 */

import { convertValue, inferColumnTypes } from "@/core/processing/dataset-inference";
import { MAX_COLUMN_NAME_LENGTH } from "@/core/processing/dataset-validator";
import { normalize, union } from "@/core/ocr/layout/geometry";
import { parseFormBoolean, parseFormDate } from "@/core/ocr/templates/text-match";
import type { Box, ExtractedValue, Extraction, FieldSpec, FieldType } from "@/types/ocr";
import type { CellValue, ColumnType, DatasetColumn, DatasetContent, DatasetRowDraft, OcrSourceReference, SourceReference } from "@/types/processing";

export interface PageRef {
  /** 1-based page within the OCR document. */
  page: number;
  fileId: string;
  /** Page within a PDF file, if the page came from one. */
  pdfPage: number | null;
  width: number;
  height: number;
}

export interface DatasetDraft {
  name: string;
  content: DatasetContent;
  sourceFileIds: string[];
}

const COLUMN_TYPE: Record<FieldType, ColumnType> = { text: "text", number: "number", date: "date", boolean: "boolean", choice: "text" };

/** A reviewed value as a dataset cell: dates to ISO, yes/no to booleans; anything unparsable stays as text (validation flags it). */
export function cellValue(value: ExtractedValue | undefined, type: FieldType): CellValue {
  const text = value?.text.trim() ?? "";
  if (!text) return null;
  if (type === "date") return parseFormDate(text) ?? text;
  if (type === "boolean") return parseFormBoolean(text) ?? text;
  return convertValue(text, COLUMN_TYPE[type]);
}

function columnsFor(specs: FieldSpec[]): DatasetColumn[] {
  const seen = new Map<string, number>();
  return specs.map((spec) => {
    const base = spec.label.replace(/\s+/g, " ").trim().slice(0, MAX_COLUMN_NAME_LENGTH - 5) || "Field";
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return { id: crypto.randomUUID(), name: n === 1 ? base : `${base} (${n})`, type: COLUMN_TYPE[spec.type], required: spec.required, sourceHeader: spec.label };
  });
}

function sourceFor(documentId: string, pageRef: PageRef | undefined, page: number, columns: DatasetColumn[], specs: FieldSpec[], values: (ExtractedValue | undefined)[], rowBox: Box | null, rowNumber: number | null): SourceReference | null {
  if (!pageRef) return null;
  const cells: Record<string, Box> = {};
  const original: Record<string, string> = {};
  const suggested: NonNullable<OcrSourceReference["suggested"]> = {};
  specs.forEach((_, i) => {
    const value = values[i];
    if (!value) return;
    if (value.box) cells[columns[i].id] = normalize(value.box, pageRef.width, pageRef.height);
    if (value.edited && value.ocrText !== null && value.ocrText !== value.text) original[columns[i].id] = value.ocrText;
    if (value.suggestedBy) suggested[columns[i].id] = value.suggestedBy;
  });
  const boxes = values.map((v) => v?.box).filter((b): b is Box => Boolean(b));
  const region = rowBox ?? (boxes.length ? union(boxes) : null);
  return {
    fileId: pageRef.fileId,
    page: pageRef.pdfPage ?? null,
    sheet: null,
    row: rowNumber,
    range: null,
    ocr: { documentId, page, region: region ? normalize(region, pageRef.width, pageRef.height) : null, cells, original, ...(Object.keys(suggested).length ? { suggested } : {}) },
  };
}

function build(specs: FieldSpec[], records: { page: number; box: Box | null; values: (ExtractedValue | undefined)[] }[], documentId: string, pages: PageRef[], generic: boolean): DatasetContent {
  const columns = columnsFor(specs);
  const rows: DatasetRowDraft[] = records.map((record, index) => {
    const values: Record<string, CellValue> = {};
    specs.forEach((spec, i) => (values[columns[i].id] = generic ? (record.values[i]?.text.trim() || null) : cellValue(record.values[i], spec.type)));
    const pageRef = pages.find((p) => p.page === record.page);
    return { values, source: sourceFor(documentId, pageRef, record.page, columns, specs, record.values, record.box, index + 1) };
  });
  // Generic mode has no declared types: detect them from the values, as Phase 3 does.
  return generic ? inferColumnTypes({ columns, rows }) : { columns, rows };
}

/** Share of fields two pages have in common (Jaccard). */
function sharedShare(a: Set<string>, b: Set<string>) {
  const common = [...a].filter((k) => b.has(k)).length;
  return common / Math.max(1, new Set([...a, ...b]).size);
}

/** One dataset per kind of output. Names: the document name, plus the table's label when there are several. */
export function extractionToDatasets(extraction: Extraction, documentId: string, name: string, pages: PageRef[]): DatasetDraft[] {
  const generic = extraction.templateId === "generic";
  const drafts: { label: string; content: DatasetContent; pages: number[] }[] = [];

  // Form pages with mostly different fields (different layouts in generic mode) become separate datasets, not one merged table.
  const formGroups: Extraction["forms"][] = [];
  for (const form of extraction.forms) {
    const keys = new Set(form.fields.map((f) => f.key));
    const group = formGroups.find((g) => sharedShare(keys, new Set(g.flatMap((x) => x.fields.map((f) => f.key)))) >= 0.5);
    if (group) group.push(form);
    else formGroups.push([form]);
  }
  formGroups.forEach((forms, i) => {
    // Union of fields across the group's pages, in first-seen order.
    const specs: FieldSpec[] = [];
    for (const form of forms) for (const f of form.fields) if (!specs.some((s) => s.key === f.key)) specs.push(f);
    const records = forms.map((form) => ({ page: form.page, box: null, values: specs.map((s) => form.fields.find((f) => f.key === s.key)?.value) }));
    drafts.push({ label: formGroups.length > 1 ? `Forms ${i + 1}` : "Forms", content: build(specs, records, documentId, pages, generic), pages: forms.map((f) => f.page) });
  });
  for (const set of extraction.tables) {
    if (set.rows.length === 0) continue;
    const records = set.rows.map((row) => ({ page: row.page, box: row.box, values: set.columns.map((c) => row.cells[c.key]) }));
    drafts.push({ label: set.label, content: build(set.columns, records, documentId, pages, generic), pages: set.rows.map((r) => r.page) });
  }
  const filledSummaries = extraction.summaries.filter((f) => f.value.text.trim() !== "");
  if (filledSummaries.length) {
    const first = filledSummaries.find((f) => f.value.page)?.value.page ?? 1;
    drafts.push({
      label: "Summary",
      content: build(filledSummaries, [{ page: first, box: null, values: filledSummaries.map((f) => f.value) }], documentId, pages, generic),
      pages: [first],
    });
  }

  return drafts.map((draft) => ({
    name: drafts.length === 1 ? name : `${name} – ${draft.label}`,
    content: draft.content,
    sourceFileIds: [...new Set(draft.pages.map((p) => pages.find((ref) => ref.page === p)?.fileId).filter((id): id is string => Boolean(id)))],
  }));
}
