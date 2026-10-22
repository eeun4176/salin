/**
 * Census Records
 * How reviewed census sheets become records: one row per pet, with its
 * sheet's barangay, date, sheet number and owner, and a Status — Validated
 * only when every value on the row was read for certain or checked by the
 * reviewer; Pending or Unreadable otherwise, with notes saying what's left.
 * Records gather in one dataset per barangay and census date: a re-scanned
 * sheet replaces its earlier rows (by sheet number), and pets on a
 * continuation sheet get their owner from the main sheet once it's in.
 */

import { CENSUS_TEMPLATE_ID, OWNER_FIELDS, PET_COLUMNS, SHEET_FIELDS } from "@/core/census/census-extraction";
import { extractionToDatasets, type PageRef } from "@/core/ocr/review/to-dataset";
import { makeValue } from "@/core/ocr/templates/field-mapping";
import { STATE_LABEL, valueState } from "@/core/ocr/review/review-state";
import type { ExtractedValue, Extraction, FieldSpec, RecordRow } from "@/types/ocr";
import type { CellValue, DatasetContent, DatasetRowDraft } from "@/types/processing";

export type RecordStatus = "Validated" | "Pending" | "Unreadable";

export const COLUMN = {
  barangay: SHEET_FIELDS[0].label,
  date: SHEET_FIELDS[1].label,
  sheet: SHEET_FIELDS[2].label,
  owner: OWNER_FIELDS[0].label,
  continuedFrom: "Continued from sheet no.",
  pet: PET_COLUMNS[0].label,
  status: "Status",
  notes: "Review notes",
} as const;

const CONTINUED: FieldSpec = { key: "continued_from", label: COLUMN.continuedFrom, type: "number", required: false };
const STATUS: FieldSpec = { key: "status", label: COLUMN.status, type: "text", required: true };
const NOTES: FieldSpec = { key: "notes", label: COLUMN.notes, type: "text", required: false };
export const RECORD_SPECS: FieldSpec[] = [...SHEET_FIELDS, ...OWNER_FIELDS, CONTINUED, ...PET_COLUMNS, STATUS, NOTES];

const waitingNote = (sheet: number) => `Main sheet ${sheet} isn't scanned yet (owner unknown).`;

export interface CensusGroup {
  barangay: string;
  /** ISO date. */
  censusDate: string;
  sheetNumbers: number[];
  content: DatasetContent;
  sourceFileIds: string[];
}

// Names can't contain "/", so the date is spelled out ("Oct 22, 2026").
export const censusDatasetName = (barangay: string, isoDate: string) =>
  `Census · ${barangay} · ${new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;

const fixed = (spec: FieldSpec, text: string): ExtractedValue => makeValue(spec, { text, confidence: 100, mapping: 1, page: null, box: null });
const empty = (spec: FieldSpec) => makeValue(spec, null);

/** MM/DD/YYYY (as shown in review) → YYYY-MM-DD. */
function isoDate(text: string) {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : text.trim();
}

/** A row's status and what's left to check, from the review states of its values. */
export function recordStatus(values: { spec: FieldSpec; value: ExtractedValue }[]): { status: RecordStatus; notes: string } {
  const open = values.map(({ spec, value }) => ({ spec, state: valueState(value, spec) })).filter((v) => v.state !== "ready");
  const status: RecordStatus = open.some((v) => v.state === "unreadable") ? "Unreadable" : open.length ? "Pending" : "Validated";
  return { status, notes: open.map((v) => `${v.spec.label}: ${STATE_LABEL[v.state]}`).join("; ") };
}

/** The reviewed census scan as records, grouped by barangay and census date. */
export function censusGroups(extraction: Extraction, documentId: string, pages: PageRef[]): CensusGroup[] {
  if (extraction.templateId !== CENSUS_TEMPLATE_ID) return [];
  const pets = extraction.tables.find((t) => t.key === "pets");
  const groups = new Map<string, { barangay: string; censusDate: string; sheets: Set<number>; rows: Omit<RecordRow, "id">[] }>();

  for (const row of pets?.rows ?? []) {
    const form = extraction.forms.find((f) => f.page === row.page);
    if (!form) continue;
    const formValue = (key: string) => form.fields.find((f) => f.key === key)?.value;
    const barangay = formValue("barangay")?.text.trim() ?? "";
    const censusDate = isoDate(formValue("census_date")?.text ?? "");
    const sheet = Number(formValue("sheet_no")?.text);
    const continuation = form.fields.some((f) => f.key === "continued_from");

    const cells: Record<string, ExtractedValue> = {};
    for (const spec of [...SHEET_FIELDS, ...OWNER_FIELDS, CONTINUED]) cells[spec.key] = formValue(spec.key) ?? empty(spec);
    for (const spec of PET_COLUMNS) cells[spec.key] = row.cells[spec.key] ?? empty(spec);
    // Continuation sheets have no owner block: the owner comes from the main sheet.
    const checked = [...SHEET_FIELDS, ...(continuation ? [CONTINUED] : OWNER_FIELDS), ...PET_COLUMNS].map((spec) => ({ spec, value: cells[spec.key] }));
    const { status, notes } = recordStatus(checked);
    cells.status = fixed(STATUS, status);
    cells.notes = notes ? fixed(NOTES, notes) : empty(NOTES);

    const key = `${barangay}|${censusDate}`;
    const group = groups.get(key) ?? { barangay, censusDate, sheets: new Set<number>(), rows: [] };
    group.sheets.add(sheet);
    group.rows.push({ page: row.page, box: row.box, cells });
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const single: Extraction = {
      templateId: CENSUS_TEMPLATE_ID,
      forms: [],
      tables: [{ key: "records", label: "Records", columns: RECORD_SPECS, rows: group.rows.map((r, i) => ({ id: `r${i}`, ...r })) }],
      summaries: [],
      unsupported: null,
      warnings: [],
    };
    const [draft] = extractionToDatasets(single, documentId, "Census", pages);
    return { barangay: group.barangay, censusDate: group.censusDate, sheetNumbers: [...group.sheets], content: draft.content, sourceFileIds: draft.sourceFileIds };
  });
}

const columnId = (content: DatasetContent, name: string) => content.columns.find((c) => c.name === name)?.id;

/**
 * Adds a scan's records to the dataset's: rows of the same sheet numbers are
 * replaced, continuation pets get their main sheet's owner (or wait as
 * Pending until it's scanned), and rows are ordered by sheet and pet.
 */
export function mergeCensusContent(existing: DatasetContent | null, incoming: DatasetContent): DatasetContent {
  const base = existing ?? { columns: incoming.columns, rows: [] };
  const columns = [...base.columns];
  for (const column of incoming.columns) if (!columns.some((c) => c.name === column.name)) columns.push(column);
  // Incoming values by column name onto the dataset's column ids.
  const toBase = new Map(incoming.columns.map((c) => [c.id, columns.find((b) => b.name === c.name)!.id]));
  const remap = (row: DatasetRowDraft): DatasetRowDraft => {
    const values: Record<string, CellValue> = {};
    for (const [id, value] of Object.entries(row.values)) values[toBase.get(id) ?? id] = value;
    const ocr = row.source?.ocr;
    return { values, source: row.source && ocr ? { ...row.source, ocr: { ...ocr, cells: Object.fromEntries(Object.entries(ocr.cells).map(([id, box]) => [toBase.get(id) ?? id, box])), original: Object.fromEntries(Object.entries(ocr.original).map(([id, text]) => [toBase.get(id) ?? id, text])) } } : row.source };
  };

  const content: DatasetContent = { columns, rows: [] };
  const id = (name: string) => columnId(content, name)!;
  const sheetOf = (row: DatasetRowDraft) => Number(row.values[id(COLUMN.sheet)]);
  const incomingRows = incoming.rows.map(remap);
  const replaced = new Set(incomingRows.map(sheetOf));
  const rows = [...base.rows.filter((r) => !replaced.has(sheetOf(r))), ...incomingRows].map((r) => ({ ...r, values: { ...r.values } }));

  const ownerIds = OWNER_FIELDS.map((f) => columnId(content, f.label)).filter((v): v is string => Boolean(v));
  for (const row of rows) {
    const from = row.values[id(COLUMN.continuedFrom)];
    if (from === null || from === undefined || from === "") continue;
    const main = rows.find((r) => sheetOf(r) === Number(from) && (r.values[id(COLUMN.continuedFrom)] ?? null) === null);
    const notes = String(row.values[id(COLUMN.notes)] ?? "");
    const waiting = waitingNote(Number(from));
    if (main) {
      for (const owner of ownerIds) row.values[owner] = main.values[owner] ?? null;
      const rest = notes.split("; ").filter((n) => n && n !== waiting);
      row.values[id(COLUMN.notes)] = rest.length ? rest.join("; ") : null;
      if (!rest.length) row.values[id(COLUMN.status)] = "Validated";
    } else if (!notes.includes(waiting)) {
      row.values[id(COLUMN.notes)] = [notes, waiting].filter(Boolean).join("; ");
      if (row.values[id(COLUMN.status)] === "Validated") row.values[id(COLUMN.status)] = "Pending";
    }
  }

  const pet = (row: DatasetRowDraft) => Number(row.values[id(COLUMN.pet)]);
  content.rows = rows.sort((a, b) => sheetOf(a) - sheetOf(b) || pet(a) - pet(b));
  return content;
}

/** Sheet numbers in `content` (a census dataset). */
export function sheetNumbersIn(content: DatasetContent) {
  const sheet = columnId(content, COLUMN.sheet);
  return new Set(sheet ? content.rows.map((r) => Number(r.values[sheet])) : []);
}
