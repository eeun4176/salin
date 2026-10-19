/**
 * OCR Repository
 * Every write to the Phase 4 tables: scan documents (one OCR session over
 * one or more pages), their pages (edits, processed image, recognition
 * result, layout), saved templates, and device benchmarks. Creating
 * datasets from a reviewed scan happens in one transaction with linking
 * them back to the scan. Original files are never modified or deleted
 * here; deleting a scan leaves its files and datasets in place.
 */

import { WorkspaceError } from "@/core/storage/errors";
import { db } from "@/core/storage/database";
import { normalizeName, sanitizeName } from "@/core/storage/names";
import { ensureSpaceFor } from "@/core/storage/storage-health";
import { createDataset } from "@/core/storage/repositories/dataset.repository";
import { parseTemplate, type DocumentTemplateDef } from "@/core/ocr/templates/template-schema";
import { DEFAULT_EDITS } from "@/core/ocr/imaging/pipeline";
import type { DatasetDraft } from "@/core/ocr/review/to-dataset";
import type { Dataset } from "@/types/processing";
import type { BenchmarkRecord, OcrDocument, OcrPage, StoredTemplate } from "@/types/ocr";

export interface NewPage {
  fileId: string;
  pdfPage: number | null;
  source?: Blob | null;
}

function newPage(documentId: string, position: number, input: NewPage): OcrPage {
  return {
    id: crypto.randomUUID(),
    documentId,
    position,
    fileId: input.fileId,
    pdfPage: input.pdfPage,
    source: input.source ?? null,
    edits: structuredClone(DEFAULT_EDITS),
    processed: null,
    processedKey: null,
    width: 0,
    height: 0,
    marks: null,
    result: null,
    resultKey: null,
    layout: null,
    state: "pending",
    error: null,
  };
}

export async function getOcrDocumentOrThrow(id: string) {
  const doc = await db.ocrDocuments.get(id);
  if (!doc) throw new WorkspaceError("not-found", "That scan no longer exists.");
  return doc;
}

/** Pages of a scan, in order. */
export function getOcrPages(documentId: string) {
  return db.ocrPages.where("documentId").equals(documentId).sortBy("position");
}

export async function listOcrDocuments() {
  return (await db.ocrDocuments.orderBy("updatedAt").toArray()).reverse();
}

/** Scans that include `fileId` (to resume instead of starting over). */
export function findOcrDocumentsForFile(fileId: string) {
  return db.ocrDocuments.where("fileIds").equals(fileId).toArray();
}

export async function createOcrDocument(input: { name: string; pages: NewPage[]; templateId?: string; languages?: string[] }): Promise<OcrDocument> {
  if (input.pages.length === 0) throw new WorkspaceError("validation", "Add at least one page.");
  const now = Date.now();
  const doc: OcrDocument = {
    id: crypto.randomUUID(),
    name: sanitizeName(input.name, "Scan"),
    fileIds: [...new Set(input.pages.map((p) => p.fileId))],
    templateId: input.templateId ?? "generic",
    languages: input.languages ?? ["eng"],
    stage: "prepare",
    extraction: null,
    datasetIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction("rw", db.ocrDocuments, db.ocrPages, async () => {
    await db.ocrDocuments.add(doc);
    await db.ocrPages.bulkAdd(input.pages.map((p, i) => newPage(doc.id, i, p)));
  });
  return doc;
}

export async function updateOcrDocument(id: string, patch: Partial<Omit<OcrDocument, "id" | "createdAt">>) {
  const updated = await db.ocrDocuments.update(id, { ...patch, updatedAt: Date.now() });
  if (!updated) throw new WorkspaceError("not-found", "That scan no longer exists.");
}

export async function updateOcrPage(id: string, patch: Partial<Omit<OcrPage, "id" | "documentId">>) {
  const bytes = (patch.processed?.size ?? 0) + (patch.source?.size ?? 0);
  if (bytes) await ensureSpaceFor(bytes);
  await db.transaction("rw", db.ocrPages, db.ocrDocuments, async () => {
    const page = await db.ocrPages.get(id);
    if (!page) throw new WorkspaceError("not-found", "That page no longer exists.");
    await db.ocrPages.update(id, patch);
    await db.ocrDocuments.update(page.documentId, { updatedAt: Date.now() });
  });
}

/** Appends pages (more photos or files) to a scan. */
export async function addOcrPages(documentId: string, pages: NewPage[]) {
  await db.transaction("rw", db.ocrDocuments, db.ocrPages, async () => {
    const doc = await getOcrDocumentOrThrow(documentId);
    const count = await db.ocrPages.where("documentId").equals(documentId).count();
    await db.ocrPages.bulkAdd(pages.map((p, i) => newPage(documentId, count + i, p)));
    await db.ocrDocuments.update(documentId, {
      fileIds: [...new Set([...doc.fileIds, ...pages.map((p) => p.fileId)])],
      // New pages need reading before the review is complete again.
      stage: doc.stage === "done" ? "done" : "prepare",
      updatedAt: Date.now(),
    });
  });
}

/** Removes a page from the scan (its original file stays in the workspace). */
export async function removeOcrPage(pageId: string) {
  await db.transaction("rw", db.ocrDocuments, db.ocrPages, async () => {
    const page = await db.ocrPages.get(pageId);
    if (!page) return;
    const pages = (await getOcrPages(page.documentId)).filter((p) => p.id !== pageId);
    if (pages.length === 0) throw new WorkspaceError("validation", "A scan needs at least one page.");
    await db.ocrPages.delete(pageId);
    await Promise.all(pages.map((p, i) => (p.position === i ? null : db.ocrPages.update(p.id, { position: i }))));
    await db.ocrDocuments.update(page.documentId, { fileIds: [...new Set(pages.map((p) => p.fileId))], extraction: null, stage: "prepare", updatedAt: Date.now() });
  });
}

/** Moves a page one place earlier (-1) or later (+1). */
export async function moveOcrPage(pageId: string, delta: -1 | 1) {
  await db.transaction("rw", db.ocrDocuments, db.ocrPages, async () => {
    const page = await db.ocrPages.get(pageId);
    if (!page) return;
    const pages = await getOcrPages(page.documentId);
    const from = pages.findIndex((p) => p.id === pageId);
    const to = from + delta;
    if (to < 0 || to >= pages.length) return;
    await db.ocrPages.update(pages[from].id, { position: to });
    await db.ocrPages.update(pages[to].id, { position: from });
    await db.ocrDocuments.update(page.documentId, { extraction: null, stage: "prepare", updatedAt: Date.now() });
  });
}

/** Deletes a scan and its pages. Original files and datasets made from it stay. */
export async function deleteOcrDocument(id: string) {
  await db.transaction("rw", db.ocrDocuments, db.ocrPages, async () => {
    await db.ocrPages.where("documentId").equals(id).delete();
    await db.ocrDocuments.delete(id);
  });
}

const MAX_DATASET_NAME = 120;

/**
 * Saves the reviewed scan as datasets and links them to the scan, all or
 * nothing. Returns the new datasets.
 */
export async function saveOcrDatasets(documentId: string, drafts: DatasetDraft[]): Promise<Dataset[]> {
  if (drafts.length === 0) throw new WorkspaceError("validation", "There is nothing to save yet.");
  return db.transaction("rw", [db.ocrDocuments, db.datasets, db.datasetRows], async () => {
    const doc = await getOcrDocumentOrThrow(documentId);
    const created: Dataset[] = [];
    for (const draft of drafts) {
      const name = normalizeName(sanitizeName(draft.name, "Scan").slice(0, MAX_DATASET_NAME));
      created.push(
        await createDataset({ name, sourceFileIds: draft.sourceFileIds, content: draft.content, origin: { kind: "ocr", documentId, templateId: doc.extraction?.templateId ?? doc.templateId } }),
      );
    }
    await db.ocrDocuments.update(documentId, { datasetIds: [...doc.datasetIds, ...created.map((d) => d.id)], stage: "done", updatedAt: Date.now() });
    return created;
  });
}

/* ------------------------------------------------------------------
   Saved templates
------------------------------------------------------------------- */

/** Saved templates that are still valid (a damaged one is skipped, not fatal). */
export async function listSavedTemplates(): Promise<DocumentTemplateDef[]> {
  const rows = await db.templates.orderBy("updatedAt").reverse().toArray();
  return rows.flatMap((row) => {
    try {
      return [parseTemplate(row.definition)];
    } catch {
      return [];
    }
  });
}

/** Validates and saves (or replaces) a template. */
export async function saveTemplate(definition: DocumentTemplateDef) {
  const parsed = parseTemplate({ ...definition, builtIn: false });
  const now = Date.now();
  const existing = await db.templates.get(parsed.id);
  const record: StoredTemplate = { id: parsed.id, definition: parsed, createdAt: existing?.createdAt ?? now, updatedAt: now };
  await db.templates.put(record);
  return parsed;
}

export function deleteTemplate(id: string) {
  return db.templates.delete(id);
}

/* ------------------------------------------------------------------
   Benchmarks
------------------------------------------------------------------- */

export async function saveBenchmark(report: unknown) {
  const record: BenchmarkRecord = { id: crypto.randomUUID(), createdAt: Date.now(), report };
  await db.benchmarks.add(record);
  return record;
}

export async function listBenchmarks() {
  return (await db.benchmarks.orderBy("createdAt").toArray()).reverse();
}

export function clearBenchmarks() {
  return db.benchmarks.clear();
}
