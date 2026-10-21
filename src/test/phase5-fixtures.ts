import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { minimalPdf } from "./minimal-pdf";
import { documentParsers } from "@/core/processing/parsers";
import { buildDatasetContent } from "@/core/processing/dataset-transformer";
import { contentEvidence, datasetEvidence, type DocumentIndex } from "@/core/ai/document-evidence";
import type { FileKind, WorkspaceFile } from "@/types/domain";

export const NOTICE_PAGES = [
  ["COMMUNITY TRAINING NOTICE", "Organizer: Bayan Learning Center", "Contact number: 09171234567", "Venue: San Isidro Hall"],
  ["REGISTRATION", "Deadline: 2026-11-15", "Fee: PHP 1,250.00", "Reference ID: REG-00042", "Requirements: Bring a valid ID and proof of residence."],
];

export async function phase5Documents() {
  const csv = await readFile("docs/benchmarks/phase5/registrations.csv", "utf8");
  const notice = await readFile("docs/benchmarks/phase5/notice.txt", "utf8");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Name", "City", "Amount", "Paid"], ["Ana Cruz", "Malolos", 1250, true], ["Ben Ramos", "Baliwag", 750, false], ["Carla Reyes", "Malolos", 500, true],
  ]), "Registrations");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Name", "City", "Amount", "Paid"], ["Dino Santos", "Baliwag", 300, false]]), "Late entries");
  return [
    { id: "notice", name: "notice.txt", kind: "txt" as FileKind, bytes: Buffer.from(notice) },
    { id: "pdf", name: "notice.pdf", kind: "pdf" as FileKind, bytes: Buffer.from(minimalPdf(NOTICE_PAGES), "latin1") },
    { id: "csv", name: "registrations.csv", kind: "csv" as FileKind, bytes: Buffer.from(csv) },
    { id: "xlsx", name: "registrations.xlsx", kind: "xlsx" as FileKind, bytes: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer },
  ];
}

export async function phase5Indexes(): Promise<Record<string, DocumentIndex>> {
  const result: Record<string, DocumentIndex> = {};
  for (const sample of await phase5Documents()) {
    const file = { id: sample.id, name: sample.name, kind: sample.kind } as WorkspaceFile;
    const parser = documentParsers.find((p) => p.kinds.includes(sample.kind))!;
    const content = await parser.parse({ file, blob: new Blob([new Uint8Array(sample.bytes)]) }, { signal: new AbortController().signal, onProgress: () => {} });
    const data = buildDatasetContent([{ file, extraction: content }]);
    const rows = data.rows.map((row, i) => ({ ...row, id: `r${i}`, datasetId: sample.id, position: i }));
    result[sample.id] = { id: sample.id, name: sample.name, columns: data.columns, rows, warnings: content.warnings, evidence: [...contentEvidence(sample.id, sample.name, content), ...datasetEvidence(sample.id, sample.name, data.columns, rows)] };
  }
  const scan = structuredClone(result.notice);
  scan.id = "scan";
  scan.name = "Unreviewed scan";
  scan.columns = [];
  scan.rows = [];
  scan.evidence = scan.evidence.filter((e) => e.kind === "field" && e.label === "Contact number").map((e) => ({ ...e, id: "scan:field1", documentId: "scan", value: "O917I234567", text: "Contact number: O917I234567", confidence: 48, warnings: ["unclear-characters"], box: { x: 20, y: 40, width: 300, height: 30 } }));
  result.scan = scan;
  return result;
}

export interface AccuracyCase { document: string; question: string; value?: string | number; count?: number; table?: CellMatrix; refuse?: boolean; calculation?: boolean; page?: number }
type CellMatrix = (string | number | boolean | null)[][];
export const PHASE5_CASES: AccuracyCase[] = [
  { document: "notice", question: "What is the contact number?", value: "09171234567" },
  { document: "notice", question: "Ano ang contact number?", value: "09171234567" },
  { document: "notice", question: "What is the reference ID?", value: "REG-00042" },
  { document: "pdf", question: "What is the deadline on page 2?", value: "2026-11-15", page: 2 },
  { document: "pdf", question: "Ano ang deadline sa pahina 2?", value: "2026-11-15", page: 2 },
  { document: "pdf", question: "What is the contact number on page 2?", refuse: true },
  { document: "pdf", question: "What is the organizer?", value: "Bayan Learning Center", page: 1 },
  { document: "csv", question: "How many rows?", count: 3, calculation: true },
  { document: "csv", question: "Ilang rows sa Malolos?", count: 2, calculation: true },
  { document: "csv", question: "Total amount", value: 2500, calculation: true },
  { document: "csv", question: "Kabuuang amount sa Malolos", value: 1750, calculation: true },
  { document: "csv", question: "Show the name of Ana", table: [["Ana Cruz"]] },
  { document: "csv", question: "Show names and amounts", table: [["Ana Cruz", 1250], ["Ben Ramos", 750], ["Carla Reyes", 500]] },
  { document: "csv", question: "Total amount per city", table: [["Baliwag", 750], ["Malolos", 1750]], calculation: true },
  { document: "xlsx", question: "How many rows?", count: 4, calculation: true },
  { document: "xlsx", question: "Total amount", value: 2800, calculation: true },
  { document: "notice", question: "What is the mayor's salary?", refuse: true },
  { document: "csv", question: "What does Ana prefer?", refuse: true },
  { document: "csv", question: "Average", refuse: true },
  { document: "scan", question: "What is the contact number?", refuse: true },
  { document: "notice", question: "Summarize this document", value: "Bayan Learning Center" },
  { document: "notice", question: "Ibuod ang dokumento", value: "Bayan Learning Center" },
];
