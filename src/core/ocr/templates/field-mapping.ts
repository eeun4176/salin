/**
 * Field Mapping
 * Maps a document's recognised pages onto a template — or, in generic mode,
 * onto whatever fields and tables were found. Form fields are matched by
 * label (fuzzy), by saved page regions, and by checkbox choices; table
 * sections by their column headings (continuation pages without headings
 * reuse the previous page's columns); summary totals are read from the page
 * and checked against the records, never filled in from them. Every value
 * carries its source region, OCR confidence and mapping confidence, plus
 * review flags. Missing values stay empty; nothing is generated.
 */

import { centerX, centerY, containsPoint, denormalize, union } from "@/core/ocr/layout/geometry";
import type { DocumentTemplateDef, SummaryField, TemplateColumn, TemplateField, TemplateTable } from "@/core/ocr/templates/template-schema";
import { keyFromLabel } from "@/core/ocr/templates/template-schema";
import { bestLabelScore, digitSuggestion, fitsType, labelSimilarity, matchChoice, normalizeLabel, parseFormBoolean } from "@/core/ocr/templates/text-match";
import type { Box, ExtractedField, ExtractedValue, Extraction, FieldSpec, FormRecord, KeyValue, LayoutTable, OcrPageResult, PageLayout, RecordSet, ValueFlag } from "@/types/ocr";

export interface MappingPage {
  /** 1-based page number within the document. */
  page: number;
  width: number;
  height: number;
  layout: PageLayout | null;
  result: OcrPageResult | null;
}

/** Labels must match at least this well to map. */
const LABEL_MATCH = 0.72;
const HEADER_MATCH = 0.66;
/** Below this OCR confidence a value is flagged for review. */
export const REVIEW_CONFIDENCE = 75;
const HANDWRITING_CONFIDENCE = 50;

export interface ValueSource {
  text: string;
  confidence: number | null;
  mapping: number | null;
  page: number | null;
  box: Box | null;
  unclear?: string;
}

/** Builds a value from what was read, with flags explaining anything that needs a human look. */
export function makeValue(spec: Pick<FieldSpec, "type" | "options">, source: ValueSource | null, extraFlags: ValueFlag[] = [], note: string | null = null): ExtractedValue {
  if (!source) {
    return { text: "", ocrText: null, ocrConfidence: null, mappingConfidence: null, page: null, box: null, flags: [...extraFlags], note, edited: false, confirmed: false };
  }
  const flags = new Set<ValueFlag>(extraFlags);
  let text = source.text.trim();
  let notes = note;
  if (text && source.confidence !== null) {
    if (source.confidence < REVIEW_CONFIDENCE) flags.add("low-confidence");
    if (source.confidence < HANDWRITING_CONFIDENCE) flags.add("possibly-handwritten");
  }
  if (text && source.unclear && /[\p{L}\p{N}]/u.test(source.unclear)) flags.add("unclear-characters");
  if (source.mapping !== null && source.mapping < 0.8) flags.add("ambiguous-mapping");
  if (spec.type === "choice" && spec.options && text) {
    const parts = text.split(/\s*,\s*/).filter(Boolean);
    const matched = [...new Set(parts.map((p) => matchChoice(p, spec.options!)).filter((m): m is string => m !== null))];
    if (matched.length === 1) text = matched[0];
    else if (matched.length > 1) {
      flags.add("checkbox-unclear");
      notes = notes ?? `More than one choice is marked: ${matched.join(", ")}.`;
    } else flags.add("type-mismatch");
  } else if (spec.type === "boolean" && text) {
    const yes = parseFormBoolean(text);
    if (yes === null) flags.add("type-mismatch");
    else text = yes ? "Yes" : "No";
  } else if (text && !fitsType(spec.type, text, spec.options)) {
    flags.add("type-mismatch");
    const suggestion = spec.type === "number" ? digitSuggestion(text) : null;
    if (suggestion) {
      flags.add("unclear-characters");
      notes = notes ?? `Possibly “${suggestion}” — check the page.`;
    }
  }
  return {
    text,
    ocrText: source.text.trim(),
    ocrConfidence: source.confidence,
    mappingConfidence: source.mapping,
    page: source.page,
    box: source.box,
    flags: [...flags],
    note: notes,
    edited: false,
    confirmed: false,
  };
}

/* ------------------------------------------------------------------
   Form fields
------------------------------------------------------------------- */

interface Candidate {
  field: number;
  score: number;
  source: ValueSource;
  /** Identity of the layout item, so one item isn't used by two fields. */
  item: string;
}

/** Words inside a saved region of the page. */
function textInRegion(page: MappingPage, region: Box): ValueSource | null {
  if (!page.result) return null;
  const box = denormalize(region, page.width, page.height);
  const words = page.result.lines.flatMap((l) => l.words).filter((w) => containsPoint(box, centerX(w.box), centerY(w.box)));
  if (words.length === 0) return null;
  return {
    text: words.map((w) => w.text).join(" "),
    confidence: words.reduce((s, w) => s + w.confidence, 0) / words.length,
    mapping: 0.85,
    page: page.page,
    box: union(words.map((w) => w.box)),
    unclear: words.map((w) => w.unclear).join(""),
  };
}

function kvSource(kv: KeyValue, page: number, score: number): ValueSource {
  return { text: kv.value, confidence: kv.confidence, mapping: Math.round(score * 100) / 100, page, box: kv.valueBox ?? kv.labelBox, unclear: kv.unclear };
}

/** Maps one page onto the template's form fields. */
export function mapFormFields(fields: (TemplateField | SummaryField)[], page: MappingPage): { fields: ExtractedField[]; matched: number } {
  const layout = page.layout;
  const candidates: Candidate[] = [];
  fields.forEach((field, index) => {
    for (const [k, kv] of (layout?.keyValues ?? []).entries()) {
      const score = bestLabelScore(kv.label, field.label, field.aliases);
      if (score >= LABEL_MATCH) candidates.push({ field: index, score, source: kvSource(kv, page.page, score), item: `kv${k}` });
    }
    // A single checkbox labelled like the field ("☑ Vaccinated against rabies").
    if (field.type === "boolean") {
      for (const [k, cb] of (layout?.checkboxes ?? []).entries()) {
        const score = bestLabelScore(cb.label, field.label, field.aliases);
        if (score < LABEL_MATCH) continue;
        const text = cb.state === "checked" ? "Yes" : cb.state === "unchecked" ? "No" : "";
        candidates.push({
          field: index,
          score: score + 0.01,
          source: { text, confidence: cb.state === "unclear" ? null : 90, mapping: score, page: page.page, box: cb.labelBox ? union([cb.box, cb.labelBox]) : cb.box },
          item: `cb${k}`,
        });
      }
    }
    if ("region" in field && field.region) {
      const source = textInRegion(page, field.region);
      if (source) candidates.push({ field: index, score: 0.85, source, item: `region${index}` });
    }
  });

  // Best matches first; each field and each layout item is used once.
  candidates.sort((a, b) => b.score - a.score);
  const chosen = new Map<number, Candidate>();
  const usedItems = new Set<string>();
  for (const c of candidates) {
    if (chosen.has(c.field) || usedItems.has(c.item)) continue;
    chosen.set(c.field, c);
    usedItems.add(c.item);
  }

  let matched = 0;
  const out = fields.map((field, index): ExtractedField => {
    const spec: FieldSpec = { key: field.key, label: field.label, type: field.type, required: field.required, options: field.options };
    const pick = chosen.get(index);
    if (!pick) return { ...spec, value: makeValue(spec, null) };
    matched++;
    const flags: ValueFlag[] = [];
    let note: string | null = null;
    // Another, different reading matched almost as well: the mapping is ambiguous.
    const rival = candidates.find((c) => c.field === index && c !== pick && c.item !== pick.item && pick.score - c.score < 0.05 && normalizeLabel(c.source.text) !== normalizeLabel(pick.source.text));
    if (rival) {
      flags.push("ambiguous-mapping");
      note = `Another label also matched, reading “${rival.source.text || "(blank)"}”.`;
    }
    if (pick.item.startsWith("cb") && pick.source.text === "") flags.push("checkbox-unclear");
    // A checkbox with an unclear mark comes back with confidence 40 from layout analysis.
    if (field.type !== "text" && pick.source.confidence === 40 && pick.item.startsWith("kv")) flags.push("checkbox-unclear");
    return { ...spec, value: makeValue(spec, pick.source, flags, note) };
  });
  return { fields: out, matched };
}

/* ------------------------------------------------------------------
   Tables
------------------------------------------------------------------- */

interface ColumnMap {
  /** Template column index → detected table column index. */
  byColumn: Map<number, number>;
  width: number;
  unmatched: string[];
}

function matchHeader(template: TemplateTable, table: LayoutTable): ColumnMap | null {
  if (table.headerRows === 0) return null;
  const header = table.rows[0].cells.map((c) => c.text);
  const pairs: { column: number; cell: number; score: number }[] = [];
  template.columns.forEach((column, c) =>
    header.forEach((text, cell) => {
      if (!text) return;
      const score = bestLabelScore(text, column.label, column.aliases);
      if (score >= HEADER_MATCH) pairs.push({ column: c, cell, score });
    }),
  );
  pairs.sort((a, b) => b.score - a.score);
  const byColumn = new Map<number, number>();
  const usedCells = new Set<number>();
  for (const p of pairs) {
    if (byColumn.has(p.column) || usedCells.has(p.cell)) continue;
    byColumn.set(p.column, p.cell);
    usedCells.add(p.cell);
  }
  if (byColumn.size < Math.min(template.minMatched, template.columns.length)) return null;
  const unmatched = header.filter((text, cell) => text && !usedCells.has(cell));
  return { byColumn, width: header.length, unmatched };
}

function columnSpec(column: TemplateColumn): FieldSpec {
  return { key: column.key, label: column.label, type: column.type, required: column.required, options: column.options };
}

function rowsFrom(table: LayoutTable, columns: FieldSpec[], cellOf: (column: number) => number | undefined, page: number, skipHeader: boolean, mapping: number | null) {
  return table.rows.slice(skipHeader ? table.headerRows : 0).flatMap((row, r) => {
    if (row.cells.every((c) => c.text.trim() === "")) return [];
    const cells: Record<string, ExtractedValue> = {};
    columns.forEach((column, c) => {
      const index = cellOf(c);
      const cell = index === undefined ? undefined : row.cells[index];
      cells[column.key] =
        cell && cell.text.trim()
          ? makeValue(column, { text: cell.text, confidence: cell.confidence, mapping, page, box: cell.box, unclear: cell.unclear })
          : makeValue(column, cell ? { text: "", confidence: null, mapping, page, box: cell.box } : null);
    });
    return [{ id: `${page}-${table.id}-${r}`, page, box: row.box, cells }];
  });
}

function mapTemplateTables(template: DocumentTemplateDef, pages: MappingPage[], warnings: string[]): RecordSet[] {
  return template.tables.map((spec) => {
    const columns = spec.columns.map(columnSpec);
    const set: RecordSet = { key: spec.key, label: spec.label, columns, rows: [] };
    let previous: ColumnMap | null = null;
    for (const page of pages) {
      for (const table of page.layout?.tables ?? []) {
        let map = matchHeader(spec, table);
        let skipHeader = true;
        // A continuation page: same number of columns, no heading row.
        if (!map && previous && table.columns.length === previous.width) {
          map = previous;
          skipHeader = table.headerRows > 0 && matchHeader(spec, table) !== null;
        }
        if (!map) continue;
        const mapping = map === previous && !skipHeader ? 0.8 : 0.95;
        if (map.unmatched.length && map !== previous) warnings.push(`Page ${page.page}: column${map.unmatched.length === 1 ? "" : "s"} not in the template ${map.unmatched.length === 1 ? "was" : "were"} left out: ${map.unmatched.join(", ")}.`);
        const current = map;
        set.rows.push(...rowsFrom(table, columns, (c) => current.byColumn.get(c), page.page, skipHeader, mapping));
        previous = map;
      }
    }
    return set;
  });
}

/** Reads totals from the page and checks them against the records. Counts are shown, not filled in. */
function checkSummaries(summaries: ExtractedField[], specs: SummaryField[], tables: RecordSet[]) {
  return summaries.map((field, i) => {
    const countOf = specs[i]?.countOf;
    if (!countOf) return field;
    const set = tables.find((t) => t.key === countOf.table);
    if (!set) return field;
    const count = set.rows.filter((row) => {
      if (!countOf.column || !countOf.equals) return true;
      const value = row.cells[countOf.column]?.text ?? "";
      return labelSimilarity(value, countOf.equals) >= 0.75 || normalizeLabel(value).startsWith(normalizeLabel(countOf.equals).slice(0, 3));
    }).length;
    const read = Number(field.value.text);
    if (field.value.text && Number.isFinite(read) && read !== count) {
      return { ...field, value: { ...field.value, flags: [...field.value.flags, "count-mismatch" as const], note: `The page says ${read}, but ${count} record${count === 1 ? " was" : "s were"} read. Check for missed or extra rows.` } };
    }
    if (!field.value.text) return { ...field, value: { ...field.value, note: `${count} record${count === 1 ? " was" : "s were"} read. Type the total only if the page shows one.` } };
    return field;
  });
}

/* ------------------------------------------------------------------
   Generic mode
------------------------------------------------------------------- */

function genericExtraction(pages: MappingPage[], warnings: string[]): Pick<Extraction, "forms" | "tables"> {
  const forms: FormRecord[] = [];
  const tables: RecordSet[] = [];
  const textRows: RecordSet = { key: "text", label: "Text", columns: [{ key: "text", label: "Text", type: "text", required: false }], rows: [] };
  let last: { set: RecordSet; width: number } | null = null;

  for (const page of pages) {
    const layout = page.layout;
    if (!layout) continue;
    if (layout.keyValues.length) {
      const seen = new Map<string, number>();
      const fields = layout.keyValues.map((kv): ExtractedField => {
        let key = keyFromLabel(kv.label);
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        if (n > 1) key = `${key}_${n}`;
        const spec: FieldSpec = { key, label: kv.label + (n > 1 ? ` (${n})` : ""), type: "text", required: false };
        return { ...spec, value: makeValue(spec, kv.value || kv.valueBox ? { ...kvSource(kv, page.page, 1), mapping: null } : null) };
      });
      forms.push({ page: page.page, fields });
    }
    for (const table of layout.tables) {
      const width = table.columns.length;
      const header = table.headerRows ? table.rows[0].cells.map((c) => c.text.trim()) : [];
      // Same shape as the previous table and no new headings: it continues it.
      if (last && last.width === width && !table.headerRows) {
        const set = last.set;
        set.rows.push(...rowsFrom(table, set.columns, (c) => c, page.page, false, 0.9));
        continue;
      }
      const seen = new Set<string>();
      const columns: FieldSpec[] = Array.from({ length: width }, (_, c) => {
        const label = header[c] || `Column ${c + 1}`;
        let key = keyFromLabel(label);
        while (seen.has(key)) key = `${key}_${c + 1}`;
        seen.add(key);
        return { key, label, type: "text", required: false };
      });
      const set: RecordSet = { key: `table_${tables.length + 1}`, label: tables.length ? `Table ${tables.length + 1}` : "Table", columns, rows: rowsFrom(table, columns, (c) => c, page.page, true, null) };
      tables.push(set);
      last = { set, width };
    }
    // Pages with neither fields nor tables: their lines of text.
    if (!layout.keyValues.length && !layout.tables.length) {
      for (const [i, line] of [...layout.headings, ...layout.text].sort((a, b) => a.box.y - b.box.y).entries()) {
        textRows.rows.push({ id: `${page.page}-text-${i}`, page: page.page, box: line.box, cells: { text: makeValue(textRows.columns[0], { text: line.text, confidence: line.confidence, mapping: null, page: page.page, box: line.box }) } });
      }
    }
  }
  if (textRows.rows.length) tables.push(textRows);
  if (forms.length > 1 && new Set(forms.map((f) => f.fields.map((x) => x.key).join("|"))).size > 1) {
    warnings.push("The pages have different fields; each page becomes one record and missing fields stay empty.");
  }
  return { forms, tables };
}

/**
 * Records for one record set from a table the reviewer redrew: columns are
 * matched by heading when the drawn table has one, otherwise by position.
 */
export function recordsFromTable(set: RecordSet, template: TemplateTable | null, table: LayoutTable, page: number): RecordSet["rows"] {
  const map = template ? matchHeader(template, table) : null;
  if (map) return rowsFrom(table, set.columns, (c) => map.byColumn.get(c), page, true, 0.9);
  const header = table.headerRows ? table.rows[0].cells.map((c) => c.text) : [];
  // Generic tables: by heading text, else position.
  const byHeading = (c: number) => {
    const index = header.findIndex((h) => labelSimilarity(h, set.columns[c].label) >= HEADER_MATCH);
    return index >= 0 ? index : c < table.columns.length ? c : undefined;
  };
  return rowsFrom(table, set.columns, byHeading, page, header.length > 0, 0.85);
}

/* ------------------------------------------------------------------
   Entry point
------------------------------------------------------------------- */

/** Maps recognised pages onto a template (or generic mode when `template` is null). */
export function extractDocument(template: DocumentTemplateDef | null, pages: MappingPage[]): Extraction {
  return { id: crypto.randomUUID(), ...mapDocument(template, pages) };
}

function mapDocument(template: DocumentTemplateDef | null, pages: MappingPage[]): Extraction {
  const warnings: string[] = [];
  const readable = pages.filter((p) => p.result && p.result.status !== "blank");
  for (const page of pages) {
    if (page.result?.status === "blank") warnings.push(`Page ${page.page} is blank.`);
    else if (page.result?.status === "unreadable") warnings.push(`Page ${page.page} was hard to read — check every value, or type them from the page.`);
  }
  for (const page of pages) for (const issue of page.layout?.issues ?? []) if (issue.kind !== "low-confidence") warnings.push(`Page ${page.page}: ${issue.message}`);

  if (readable.length === 0) {
    return { templateId: template?.id ?? "generic", forms: [], tables: [], summaries: [], unsupported: "No text was found on these pages. If they do have text, try retaking the photo in better light, or type the values yourself.", warnings };
  }

  if (!template) {
    const { forms, tables } = genericExtraction(pages, warnings);
    const nothing = forms.length === 0 && tables.length === 0;
    return { templateId: "generic", forms, tables, summaries: [], unsupported: nothing ? "No fields, tables or text could be extracted from these pages." : null, warnings };
  }

  let forms: FormRecord[] = [];
  let summaries: ExtractedField[] = [];
  let unsupported: string | null = null;
  const tables = mapTemplateTables(template, pages, warnings);

  if (template.kind === "form") {
    const pageRecords = pages.map((page) => ({ page: page.page, ...mapFormFields(template.fields, page) }));
    const threshold = Math.max(2, Math.ceil(template.fields.length * 0.25));
    for (const record of pageRecords) {
      if (record.matched < threshold && pages.find((p) => p.page === record.page)?.result?.status !== "blank") {
        warnings.push(`Page ${record.page} doesn't look like a ${template.name.toLowerCase()} — only ${record.matched} field${record.matched === 1 ? "" : "s"} matched.`);
      }
    }
    forms = pageRecords.map(({ page, fields }) => ({ page, fields }));
    if (pageRecords.every((r) => r.matched < threshold)) {
      unsupported = `These pages don't look like a ${template.name.toLowerCase()}, so nothing was filled in automatically. Try Generic mode, pick another template, or type the values yourself.`;
    }
  } else {
    // Document-level fields (barangay, date…) and totals: the first page where each is found.
    const docFields = [...template.fields, ...template.summaries];
    const perPage = pages.map((page) => mapFormFields(docFields, page).fields);
    summaries = docFields.map((_, i) => perPage.find((fields) => fields[i].value.ocrText !== null)?.[i] ?? perPage[0]?.[i]).filter((f): f is ExtractedField => Boolean(f));
    summaries = checkSummaries(summaries, docFields as SummaryField[], tables);
    if (tables.every((t) => t.rows.length === 0)) {
      unsupported = `No ${template.tables.map((t) => t.label.toLowerCase()).join(" or ")} table matching this template was found. Try Generic mode, or check that the column headings are visible in the photo.`;
    }
  }
  return { templateId: template.id, forms, tables, summaries, unsupported, warnings };
}
