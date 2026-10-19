/**
 * Table Drafts
 * The state behind the guided Excel extraction: one draft per detected (or
 * hand-picked) section of a worksheet, and the plain-language layer on top of
 * the detection engine —
 * - a descriptive name for each section, from its title or column names;
 * - a review status ("Ready", "Check before creating", or why it was left
 *   out) with advice the user can act on, instead of confidence scores;
 * - which sections and sheets start selected (empty, title-only and
 *   non-tabular regions don't);
 * - validation before continuing, and the datasets that will be created.
 */

import { sanitizeName, splitExtension } from "@/core/storage/names";
import { formatRange, type CellRange } from "@/core/processing/excel/cell-range";
import {
  checkRange,
  describeTable,
  detectTables,
  extractTable,
  type DetectedTable,
  type TableIssueCode,
} from "@/core/processing/excel/table-detection";
import type { SheetModel, WorkbookModel } from "@/core/processing/excel/workbook-reader";
import type { TableGroup } from "@/features/processing/processing-actions";
import type { ExtractedTable } from "@/types/processing";

export interface TableDraft {
  key: string;
  sheet: string;
  range: string;
  headerRows: number;
  include: boolean;
  origin: "excel-table" | "detected" | "manual";
  title: string | null;
  /** Adjustments detection made (e.g. "Left out the Total row"). */
  notes: string[];
  /** What detection chose, for "Reset"; `null` for sections the user added. */
  detected: { range: string; headerRows: number } | null;
}

export type CombineMode = "combine" | "separate";

export type EvaluatedDraft =
  | { ok: false; error: string }
  | { ok: true; range: CellRange; description: DetectedTable; extracted: ExtractedTable };

/** What a draft will extract, or why it can't. */
export function evaluateDraft(sheet: SheetModel, draft: TableDraft): EvaluatedDraft {
  const range = checkRange(sheet, draft.range);
  if (typeof range === "string") return { ok: false, error: range };
  // Detection notes only hold while the range is the one detection chose.
  const notes = draft.detected && formatRange(range) === draft.detected.range ? draft.notes : [];
  const description = describeTable(sheet, range, draft.headerRows, draft.origin, draft.title, notes);
  const extracted = extractTable(sheet, { sheet: sheet.name, range: draft.range, headerRows: draft.headerRows });
  return { ok: true, range, description, extracted };
}

/* ------------------------------------------------------------------
   Review status: actionable words instead of confidence scores
------------------------------------------------------------------- */

export type ReviewKind = "ready" | "check" | "skip";

export interface ReviewStatus {
  kind: ReviewKind;
  label: string;
  /** What to look at or do, one line per point. */
  advice: string[];
}

function advice(code: TableIssueCode, headerRows: number): string {
  switch (code) {
    case "no-header":
      return "No column names found. Under Adjust selection, choose the row that holds them.";
    case "no-rows":
      return "This is only a title or headings — there are no records in it.";
    case "one-row":
      return "Only 1 record. If the table is bigger, widen the selection under Adjust selection.";
    case "one-column":
      return "Only one column, so it looks like a list or notes rather than a table.";
    case "sparse":
      return "Many cells are empty. Check that the selection doesn't take in blank areas.";
    case "merged-data":
      return "Merged cells were repeated on each row they cover. Check those values in the preview.";
    case "multi-header":
      return `Column names combine ${headerRows} heading rows. Check that they read well in the preview.`;
    case "mixed-types":
      return "Some columns mix numbers and text. You can set each column's type after creating the dataset.";
  }
}

export function reviewStatus(evaluated: EvaluatedDraft): ReviewStatus {
  if (!evaluated.ok) return { kind: "check", label: "Fix the selection", advice: [evaluated.error] };
  const { issues, headerRows, notes } = evaluated.description;
  const tips = [...issues.map((i) => advice(i.code, headerRows)), ...notes];
  const major = issues.filter((i) => i.major).map((i) => i.code);
  // A lone row (no header, at most one row) is a heading line, not records.
  const headingsOnly = major.includes("no-rows") || (major.includes("no-header") && evaluated.description.stats.dataRows <= 1);
  if (headingsOnly) return { kind: "skip", label: "Title or headings only", advice: [advice("no-rows", headerRows)] };
  if (major.includes("one-column")) return { kind: "skip", label: "Looks like a list or notes", advice: tips };
  if (major.length) return { kind: "skip", label: "No column names", advice: tips };
  if (issues.length) return { kind: "check", label: "Check before creating", advice: tips };
  return { kind: "ready", label: "Ready", advice: notes };
}

/* ------------------------------------------------------------------
   Names
------------------------------------------------------------------- */

const isLetterName = (name: string) => /^Column [A-Z]+$/.test(name);

/** "Owner, Pet and 2 more" from the column names, or the title above the table. */
export function sectionName(draft: TableDraft, evaluated: EvaluatedDraft): string {
  if (draft.title?.trim()) return draft.title.trim();
  if (!evaluated.ok || evaluated.extracted.headerRows === 0) return "Untitled section";
  const names = evaluated.extracted.rows[0].map((n) => n.trim()).filter((n) => n && !isLetterName(n));
  if (names.length === 0) return "Untitled section";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Records the section will produce (non-blank data rows). */
export function recordCount(evaluated: EvaluatedDraft) {
  return evaluated.ok ? evaluated.description.stats.dataRows : 0;
}

/* ------------------------------------------------------------------
   Starting state
------------------------------------------------------------------- */

/**
 * Every section detected on every worksheet. Sections that are ready or
 * worth checking start ticked; empty, title-only and non-tabular ones don't.
 */
export function initialDrafts(workbook: WorkbookModel): TableDraft[] {
  return workbook.sheets.flatMap((sheet) =>
    detectTables(sheet).map((table) => {
      const draft: TableDraft = {
        key: table.key,
        sheet: sheet.name,
        range: formatRange(table.range),
        headerRows: table.headerRows,
        include: false,
        origin: table.origin,
        title: table.title,
        notes: table.notes,
        detected: { range: formatRange(table.range), headerRows: table.headerRows },
      };
      draft.include = reviewStatus(evaluateDraft(sheet, draft)).kind !== "skip";
      return draft;
    }),
  );
}

/** Visible worksheets with at least one section worth extracting start selected. */
export function initialSheets(workbook: WorkbookModel, drafts: TableDraft[]) {
  return new Set(workbook.sheets.filter((s) => s.visibility === "visible" && drafts.some((d) => d.sheet === s.name && d.include)).map((s) => s.name));
}

export function manualDraft(sheet: string): TableDraft {
  return { key: `manual-${crypto.randomUUID()}`, sheet, range: "", headerRows: 1, include: true, origin: "manual", title: null, notes: [], detected: null };
}

/* ------------------------------------------------------------------
   Validation and the datasets to create
------------------------------------------------------------------- */

/** Why a selected section can't be extracted, or `null` if it can. */
export function selectionProblem(draft: TableDraft, evaluated: EvaluatedDraft): string | null {
  if (draft.origin === "manual" && draft.range === "") return "Select the cells of this section first.";
  if (!evaluated.ok) return evaluated.error;
  if (evaluated.description.stats.dataRows === 0) return "The selected cells have no records — only headings or blank rows.";
  return null;
}

/** Sections with the same column names make sense as one dataset; different ones don't. */
export function sameColumns(evaluated: EvaluatedDraft[]) {
  const signatures = evaluated.map((e) =>
    e.ok && e.extracted.headerRows !== 0 ? e.extracted.rows[0].map((n) => n.trim().toLowerCase()).join("|") : null,
  );
  return signatures.every((s) => s !== null && s === signatures[0]);
}

/**
 * Selected sections → datasets to create: all in one (named after the
 * workbook), or one per section (named after the workbook and the section).
 */
export function datasetGroups(fileName: string, drafts: TableDraft[], mode: CombineMode, label: (draft: TableDraft) => string): TableGroup[] {
  const [base] = splitExtension(fileName, true);
  const selection = (d: TableDraft) => ({ sheet: d.sheet, range: d.range, headerRows: d.headerRows });
  if (mode === "combine" || drafts.length === 1) return [{ name: sanitizeName(base, "Workbook"), tables: drafts.map(selection) }];

  const used = new Map<string, number>();
  return drafts.map((d) => {
    let name = `${base} – ${label(d)}`;
    const count = (used.get(name.toLowerCase()) ?? 0) + 1;
    used.set(name.toLowerCase(), count);
    if (count > 1) name = `${name} (${count})`;
    // Section names come from cell text, which may hold characters names can't ("Report: October").
    return { name: sanitizeName(name.slice(0, 200), base), tables: [selection(d)] };
  });
}
