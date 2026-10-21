import { canonical, FUNCTION_WORDS, wordsOf } from "./question-linking";
import { columnLetter } from "@/core/processing/excel/cell-range";
import { reviewItems } from "@/core/ocr/review/review-state";
import type { Box, Extraction, OcrPage } from "@/types/ocr";
import type { DatasetColumn, DatasetRow, ExtractedContent, SourceReference } from "@/types/processing";

export interface Evidence {
  id: string;
  documentId: string;
  documentName: string;
  kind: "text" | "heading" | "field" | "row";
  text: string;
  label?: string;
  value?: string;
  page: number | null;
  sheet: string | null;
  row: number | null;
  range: string | null;
  box: Box | null;
  cells?: Record<string, { value: string; range?: string; box?: Box }>;
  confidence: number | null;
  warnings: string[];
  rowId?: string;
}

export interface DocumentIndex {
  id: string;
  name: string;
  evidence: Evidence[];
  warnings: string[];
  columns: DatasetColumn[];
  rows: DatasetRow[];
}

export const evidenceWords = (text: string) => wordsOf(text).filter((w) => !FUNCTION_WORDS.has(w)).map(canonical);

export function evidenceLabel(e: Evidence) {
  return [e.documentName, e.sheet ? `sheet ${e.sheet}` : null, e.page !== null ? `page ${e.page}` : null, e.range || (e.row !== null ? `row ${e.row}` : null)].filter(Boolean).join(" · ");
}

function item(documentId: string, documentName: string, id: string, text: string, source: Partial<Evidence> = {}): Evidence {
  return { id: `${documentId}:${id}`, documentId, documentName, kind: "text", text, page: null, sheet: null, row: null, range: null, box: null, confidence: null, warnings: [], ...source };
}

/** Indexes existing parser output; source values are never normalized or corrected. */
export function contentEvidence(id: string, name: string, content: ExtractedContent): Evidence[] {
  const result: Evidence[] = [];
  for (const page of content.pages) {
    let lineNumber = 0;
    for (const line of page.text.split(/\r?\n/)) {
      lineNumber++;
      const text = line.trim();
      if (!text) continue;
      const field = /^([^:]{1,100}):\s*(.+)$/.exec(text);
      // Bounded overlapping blocks retain long paragraphs without losing their tail.
      for (let start = 0; start < text.length; start += 600) {
        result.push(item(id, name, `p${page.number}:l${lineNumber}:${start}`, text.slice(start, start + 800), {
          page: page.number, row: lineNumber, warnings: content.warnings,
          kind: field && text.length <= 800 ? "field" : /^[\p{Lu}\d\W]+$/u.test(text) && text.length < 120 ? "heading" : "text",
          ...(field && text.length <= 800 ? { label: field[1].trim(), value: field[2] } : {}),
        }));
        if (start + 800 >= text.length) break;
      }
    }
  }
  content.tables.forEach((table, t) => {
    const hasHeaders = table.headerRows !== 0;
    const headers = hasHeaders ? table.rows[0] ?? [] : (table.rows[0] ?? []).map((_, i) => `Column ${columnLetter((table.firstColumn ?? 0) + i)}`);
    table.rows.slice(hasHeaders ? 1 : 0).forEach((values, r) => {
      const row = table.firstRowNumber + r + (hasHeaders ? 1 : 0);
      const cells = Object.fromEntries(headers.map((h, c) => [h, { value: values[c] ?? "", range: `${columnLetter((table.firstColumn ?? 0) + c)}${row}` }]));
      result.push(item(id, name, `t${t}:r${row}`, headers.map((h, c) => `${h}: ${values[c] ?? ""}`).join(" | "), {
        kind: "row", page: table.page, sheet: table.sheet, row, cells, warnings: content.warnings,
        range: `${columnLetter(table.firstColumn ?? 0)}${row}:${columnLetter((table.firstColumn ?? 0) + Math.max(0, headers.length - 1))}${row}`,
      }));
    });
  });
  return result;
}

export function scanEvidence(id: string, name: string, pages: OcrPage[], extraction: Extraction | null): Evidence[] {
  const result: Evidence[] = [];
  for (const page of pages) {
    const number = page.pdfPage ?? page.position + 1;
    const warnings = [...(page.layout?.issues.map((i) => i.message) ?? []), ...(page.error ? [page.error] : [])];
    for (const [i, line] of (page.result?.lines ?? []).entries()) {
      const field = /^([^:]{1,100}):\s*(.+)$/.exec(line.text);
      result.push(item(id, name, `p${page.position}:l${i}`, line.text, {
        kind: field ? "field" : "text", ...(field ? { label: field[1].trim(), value: field[2] } : {}),
        page: number, box: line.box, confidence: line.confidence,
        warnings: [...warnings, ...(line.confidence < 80 || line.words.some((w) => w.unclear) ? ["Unresolved OCR text"] : [])],
      }));
    }
    for (const [i, heading] of (page.layout?.headings ?? []).entries()) result.push(item(id, name, `p${page.position}:h${i}`, heading.text, { kind: "heading", page: number, box: heading.box, confidence: heading.confidence, warnings }));
    for (const [t, table] of (page.layout?.tables ?? []).entries()) {
      const headers = table.headerRows ? table.rows[0]?.cells.map((c) => c.text) ?? [] : table.columns.map((_, i) => `Column ${i + 1}`);
      for (const [r, row] of table.rows.slice(table.headerRows ? 1 : 0).entries()) {
        const confidence = row.cells.reduce((n, c) => Math.min(n, c.confidence ?? 100), 100);
        result.push(item(id, name, `p${page.position}:table${t}:r${r}`, headers.map((h, i) => `${h}: ${row.cells[i]?.text ?? ""}`).join(" | "), {
          kind: "row", page: number, row: r + table.headerRows + 1, box: row.box, confidence,
          cells: Object.fromEntries(headers.map((h, i) => [h, { value: row.cells[i]?.text ?? "", box: row.cells[i]?.box }])),
          warnings: [...warnings, ...(confidence < 80 || row.cells.some((c) => c.unclear) ? ["Unresolved OCR table"] : [])],
        }));
      }
    }
  }
  if (extraction) {
    for (const [i, { spec, value, state }] of reviewItems(extraction).entries()) {
      if (!value.text.trim()) continue;
      const page = pages.find((p) => p.position + 1 === value.page);
      // Reviewed fields replace overlapping raw lines so stale OCR is never retrieved as a competing value.
      if ((value.edited || value.confirmed) && value.box) {
        for (let j = result.length - 1; j >= 0; j--) {
          const e = result[j];
          const b = e.box;
          if (e.page === (page?.pdfPage ?? value.page) && b && b.x < value.box.x + value.box.width && b.x + b.width > value.box.x && b.y < value.box.y + value.box.height && b.y + b.height > value.box.y) result.splice(j, 1);
        }
      }
      result.push(item(id, name, `field${i}`, `${spec.label}: ${value.text}`, {
        kind: "field", label: spec.label, value: value.text, page: page?.pdfPage ?? value.page, box: value.box,
        confidence: value.edited || value.confirmed ? null : value.ocrConfidence,
        warnings: state === "ready" ? [] : [...value.flags, ...(value.note ? [value.note] : []), "Unresolved extraction"],
      }));
    }
  }
  return result;
}

export function datasetEvidence(id: string, name: string, columns: DatasetColumn[], rows: DatasetRow[]): Evidence[] {
  return rows.map((row) => {
    const s: SourceReference | null = row.source;
    return item(s?.fileId ?? id, name, `dataset:${id}:${row.id}`, columns.map((c) => `${c.name}: ${row.values[c.id] ?? ""}`).join(" | "), {
      kind: "row", rowId: row.id, page: s?.page ?? s?.ocr?.page ?? null, sheet: s?.sheet ?? null, row: s?.row ?? row.position + 1, range: s?.range ?? null,
      box: s?.ocr?.region ?? null,
      cells: Object.fromEntries(columns.map((c) => [c.name, { value: String(row.values[c.id] ?? ""), box: s?.ocr?.cells[c.id] }])),
    });
  });
}

/** Keyword and bilingual alias retrieval, restricted to the selected index. */
export function retrieveEvidence(index: DocumentIndex, question: string, limit = 8): Evidence[] {
  const terms = [...new Set(evidenceWords(question))];
  const page = /\b(?:page|pahina)\s*(\d+)/i.exec(question);
  const sheet = /\b(?:sheet|worksheet)\s+["“]([^"”]+)["”]/i.exec(question);
  return index.evidence
    .filter((e) => (!page || e.page === Number(page[1])) && (!sheet || e.sheet?.toLowerCase() === sheet[1].toLowerCase()))
    .map((e) => {
      const words = new Set(evidenceWords(e.text));
      const labels = new Set(evidenceWords(e.label ?? ""));
      return { e, score: terms.reduce((n, t) => n + (words.has(t) ? 1 : 0) + (labels.has(t) ? 2 : 0), 0) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id))
    .slice(0, limit).map(({ e }) => e);
}
