/**
 * Sample Assistant (Phase 1 placeholder)
 * Canned Ask Salin AI replies that show the shape of real results with
 * sample data (until on-device extraction in Phase 4), plus CSV export with
 * spreadsheet formula-injection protection.
 */

import { FILE_KIND_META } from "@/components/brand/file-kinds";
import { downloadBlob } from "@/lib/download";
import type { IntakeFile } from "@/stores/intake-store";

export interface ExtractedTable {
  title: string;
  columns: string[];
  rows: string[][];
  total?: string[];
}

export interface AssistantReply {
  text: string;
  table?: ExtractedTable;
  bullets?: string[];
  footnote?: string;
}

const SAMPLE_TABLE: ExtractedTable = {
  title: "Extracted Data (Preview)",
  columns: ["No.", "Item", "Date", "Amount"],
  rows: [
    ["1", "Dog Food", "2026-10-01", "₱350.00"],
    ["2", "Vitamin", "2026-10-01", "₱120.00"],
    ["3", "Medical Checkup", "2026-10-01", "₱500.00"],
  ],
  total: ["4", "Total", "-", "₱970.00"],
};

const SAMPLE_NOTE = "Sample values — on-device extraction arrives in Phase 4. You can export this layout or ask for adjustments.";

function describe(files: IntakeFile[]) {
  if (files.length === 0) return "your document";
  if (files.length === 1) return files[0].name;
  return `these ${files.length} files`;
}

/**
 * Placeholder assistant for the Phase 1 shell. It never claims to have read
 * a file: replies show the *shape* of a result using sample data, except for
 * "organize", which really groups the attached files by type.
 */
export function draftReply(prompt: string, files: IntakeFile[]): AssistantReply {
  const p = prompt.toLowerCase();

  if (/organi[sz]e|group|sort/.test(p)) {
    if (files.length === 0) {
      return { text: "Attach a few files with the paperclip and I'll group them by type." };
    }
    const groups = new Map<string, string[]>();
    for (const f of files) {
      const label = FILE_KIND_META[f.kind].name;
      groups.set(label, [...(groups.get(label) ?? []), f.name]);
    }
    return {
      text: `Here's how ${describe(files)} group by type:`,
      bullets: [...groups].map(([label, names]) => `${label} (${names.length}): ${names.join(", ")}`),
      footnote: "Moving them into folders arrives with workspace storage in Phase 2.",
    };
  }

  if (/summar/.test(p)) {
    return {
      text: `Here's the kind of summary you'll get for ${describe(files)}:`,
      bullets: [
        "Document type and the number of pages or rows detected",
        "Key fields found (names, dates, reference numbers, amounts)",
        "Values that need your review before saving",
      ],
      footnote: "Summaries need the on-device model coming in Phase 4 — this is a preview of the format.",
    };
  }

  if (/extract|table|convert|name|date|amount|data/.test(p) || files.length > 0) {
    return {
      text: `Here's a preview of the table I'd build from ${describe(files)}:`,
      table: SAMPLE_TABLE,
      footnote: SAMPLE_NOTE,
    };
  }

  return {
    text: "I can turn scans, PDFs and spreadsheets into structured tables. Try one of these:",
    bullets: [
      "“Extract the names, dates, and amounts from this file.”",
      "“Convert this document to a table.”",
      "“Organize these files by type.”",
    ],
  };
}

/** Neutralise spreadsheet formula injection for untrusted cell text (docs 11). */
function safeCell(value: string) {
  const risky = /^[=+@\t\r]/.test(value) || (value.startsWith("-") && !/^-?[\d.,]*$/.test(value));
  const v = risky ? `'${value}` : value;
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Downloads the table as a UTF-8 CSV that Excel opens directly. */
export function downloadTableCsv(table: ExtractedTable, filename = "salin-extracted-data.csv") {
  const lines = [table.columns, ...table.rows, ...(table.total ? [table.total] : [])].map((row) => row.map(safeCell).join(","));
  downloadBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), filename);
}

export function tableAsText(table: ExtractedTable) {
  return [table.columns, ...table.rows, ...(table.total ? [table.total] : [])].map((r) => r.join("\t")).join("\n");
}
