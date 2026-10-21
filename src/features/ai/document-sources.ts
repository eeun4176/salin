import { contentEvidence, datasetEvidence, scanEvidence, type DocumentIndex, type Evidence } from "@/core/ai/document-evidence";
import { documentParsers } from "@/core/processing/parsers";
import { buildDatasetContent } from "@/core/processing/dataset-transformer";
import { extractionToDatasets } from "@/core/ocr/review/to-dataset";
import { db } from "@/core/storage/database";
import { getDatasetWithRows } from "@/core/storage/repositories/dataset.repository";
import { getFileWithBlob } from "@/core/storage/repositories/file-repository";
import { isLiveFolder } from "@/core/storage/repositories/shared";
import { findExtraction, saveExtraction } from "@/core/storage/repositories/processing.repository";
import { getOcrDocumentOrThrow, getOcrPages } from "@/core/storage/repositories/ocr.repository";

export interface AskSource { id: string; name: string; kind: "document" | "scan" }

export async function listAskSources(): Promise<AskSource[]> {
  const [files, scans] = await Promise.all([db.files.toArray(), db.ocrDocuments.toArray()]);
  const folders = new Map(await Promise.all([...new Set(files.map((f) => f.folderId))].map(async (id) => [id, await isLiveFolder(id)] as const)));
  return [
    ...files.filter((f) => f.deletedAt === null && folders.get(f.folderId) && documentParsers.some((p) => p.kinds.includes(f.kind))).map((f) => ({ id: `file:${f.id}`, name: f.name, kind: "document" as const })),
    ...scans.map((s) => ({ id: `scan:${s.id}`, name: s.name, kind: "scan" as const })),
  ];
}

async function fileIndex(id: string, signal: AbortSignal): Promise<DocumentIndex> {
  const { file, blob } = await getFileWithBlob(id);
  if (file.deletedAt !== null || !await isLiveFolder(file.folderId)) throw new Error("Restore the document from Trash before asking about it.");
  const parser = documentParsers.find((p) => p.kinds.includes(file.kind));
  if (!parser) throw new Error("Read this image with OCR first, then select the scan.");
  let content = await findExtraction(file.blobId, parser.id, parser.version);
  if (!content) {
    const parsed = await parser.parse({ file, blob }, { signal, onProgress: () => {} });
    signal.throwIfAborted();
    content = await saveExtraction({ ...parsed, blobId: file.blobId, fileId: file.id, kind: file.kind, parserId: parser.id, parserVersion: parser.version });
  }
  const data = buildDatasetContent([{ file, extraction: content }]);
  const rows = data.rows.map((row, i) => ({ ...row, id: `row${i}`, datasetId: id, position: i }));
  return { id, name: file.name, columns: data.columns, rows, evidence: [...contentEvidence(id, file.name, content), ...datasetEvidence(id, file.name, data.columns, rows)], warnings: content.warnings };
}

async function scanIndex(id: string): Promise<DocumentIndex> {
  const [scan, pages] = await Promise.all([getOcrDocumentOrThrow(id), getOcrPages(id)]);
  const evidence = scanEvidence(id, scan.name, pages, scan.extraction);
  const drafts = scan.extraction ? extractionToDatasets(scan.extraction, id, scan.name, pages.map((p) => ({ page: p.position + 1, fileId: p.fileId, pdfPage: p.pdfPage, width: p.width, height: p.height }))) : [];
  const content = drafts.length === 1 ? drafts[0].content : null;
  const rows = (content?.rows ?? []).map((row, i) => ({ ...row, id: `row${i}`, datasetId: id, position: i }));
  const index = { id, name: scan.name, evidence, warnings: [...(scan.extraction?.warnings ?? []), ...(scan.extraction?.unsupported ? [scan.extraction.unsupported] : [])], columns: content?.columns ?? [], rows };
  if (content) {
    const records = datasetEvidence(id, scan.name, content.columns, rows);
    attachOcrWarnings(records, index);
    evidence.push(...records);
  }
  return index;
}

function attachOcrWarnings(evidence: Evidence[], scan: DocumentIndex) {
  for (const e of evidence) {
    const related = scan.evidence.filter((s) => s.page === e.page && (s.warnings.length || (s.confidence !== null && s.confidence < 80)));
    if (related.length) {
      e.warnings.push(...new Set(related.flatMap((s) => s.warnings.length ? s.warnings : ["Unresolved OCR text"])));
      e.confidence = Math.min(...related.map((s) => s.confidence ?? 100));
    }
  }
}

/** Fresh snapshot per question: dataset edits, source deletion and OCR review are reflected immediately. */
export async function loadAskSource(target: string, signal: AbortSignal): Promise<DocumentIndex> {
  signal.throwIfAborted();
  if (target.startsWith("file:")) return fileIndex(target.slice(5), signal);
  if (target.startsWith("scan:")) return scanIndex(target.slice(5));
  const { dataset, rows } = await getDatasetWithRows(target);
  const evidence = datasetEvidence(dataset.id, dataset.name, dataset.columns, rows);
  const warnings: string[] = [];
  if (dataset.origin?.kind === "ocr") {
    const scanExists = await db.ocrDocuments.get(dataset.origin.documentId);
    if (scanExists) {
      const scan = await scanIndex(dataset.origin.documentId);
      if (dataset.status !== "reviewed") attachOcrWarnings(evidence, scan);
      evidence.push(...scan.evidence);
      warnings.push(...scan.warnings);
    } else if (dataset.status !== "reviewed") warnings.push("The original OCR review is unavailable; verify the dataset before using its values.");
  } else {
    for (const fileId of dataset.sourceFileIds) {
      const file = await db.files.get(fileId);
      if (!file || file.deletedAt !== null || !await isLiveFolder(file.folderId)) continue;
      const cached = await db.extractedDocuments.where("blobId").equals(file.blobId).toArray();
      const latest = cached.sort((a, b) => b.createdAt - a.createdAt)[0];
      if (latest) {
        evidence.push(...contentEvidence(fileId, file.name, latest));
        warnings.push(...latest.warnings);
      }
    }
  }
  signal.throwIfAborted();
  return { id: dataset.id, name: dataset.name, columns: dataset.columns, rows, evidence, warnings: [...new Set(warnings)] };
}

