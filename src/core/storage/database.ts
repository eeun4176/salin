/**
 * Local Database (Dexie / IndexedDB)
 * Declares the "SalinAI" IndexedDB database, its tables, indexes and versioned
 * migrations. Every repository reads and writes through the `db` exported here.
 * Workspace tables: folders, files, fileBlobs. Processing tables (Phase 3):
 * processingJobs, extractedDocuments, datasets, datasetRows. OCR tables
 * (Phase 4): ocrDocuments, ocrPages, templates (saved document templates),
 * benchmarks. Derived: thumbnails. OCR model files live in Cache Storage.
 * Sync (City Vet integration): outbox — changes waiting to be sent.
 */

import Dexie, { type EntityTable, type Transaction } from "dexie";

import type { AppSetting, FileBlob, Folder, Thumbnail, WorkspaceFile } from "@/types/domain";
import type { BenchmarkRecord, OcrDocument, OcrPage, StoredTemplate } from "@/types/ocr";
import type { OutboxItem } from "@/types/sync";
import type { Dataset, DatasetRow, ExtractedDocument, ProcessingJob } from "@/types/processing";

export type SalinDatabase = Dexie & {
  folders: EntityTable<Folder, "id">;
  files: EntityTable<WorkspaceFile, "id">;
  fileBlobs: EntityTable<FileBlob, "id">;
  datasets: EntityTable<Dataset, "id">;
  datasetRows: EntityTable<DatasetRow, "id">;
  processingJobs: EntityTable<ProcessingJob, "id">;
  extractedDocuments: EntityTable<ExtractedDocument, "id">;
  thumbnails: EntityTable<Thumbnail, "blobId">;
  templates: EntityTable<StoredTemplate, "id">;
  ocrDocuments: EntityTable<OcrDocument, "id">;
  ocrPages: EntityTable<OcrPage, "id">;
  benchmarks: EntityTable<BenchmarkRecord, "id">;
  settings: EntityTable<AppSetting, "key">;
  outbox: EntityTable<OutboxItem, "id">;
};

export const db = new Dexie("SalinAI") as SalinDatabase;

// v1 — Phase 1 scaffold (ISO-string timestamps, never written to by the app).
db.version(1).stores({
  folders: "id, name, parentFolderId, updatedAt, deletedAt, isFavorite",
  files: "id, name, folderId, blobId, updatedAt, lastOpenedAt, deletedAt, isFavorite",
  fileBlobs: "id",
  datasets: "id, name, folderId, updatedAt, deletedAt, isFavorite, *sourceFileIds",
  datasetRows: "id, datasetId",
  processingJobs: "id, status, taskType, updatedAt",
  templates: "id, name",
  modelMetadata: "id",
  settings: "key",
});

// v2 — Phase 2 workspace: epoch-ms timestamps, last-opened on folders, and no
// boolean indexes (booleans are not valid IndexedDB keys, so they never indexed).
db.version(2)
  .stores({
    folders: "id, name, parentFolderId, updatedAt, lastOpenedAt, deletedAt",
    files: "id, name, folderId, blobId, updatedAt, lastOpenedAt, deletedAt",
    datasets: "id, name, folderId, updatedAt, deletedAt, *sourceFileIds",
  })
  .upgrade(migrateTimestampsToNumbers);

// v3 — Phase 3 processing: the real job/dataset shapes plus cached extractions.
// Earlier versions declared these tables but never wrote to them, so any stray
// placeholder rows (which predate these shapes) are dropped.
db.version(3)
  .stores({
    datasets: "id, name, jobId, status, updatedAt, *sourceFileIds",
    datasetRows: "id, datasetId, [datasetId+position]",
    processingJobs: "id, status, createdAt, updatedAt, datasetId, *sourceFileIds",
    extractedDocuments: "id, blobId, fileId, [blobId+parserId]",
  })
  .upgrade((tx) => Promise.all(["datasets", "datasetRows", "processingJobs"].map((table) => tx.table(table).clear())));

// v4 — file card thumbnails (derived from the stored bytes; never backed up).
db.version(4).stores({ thumbnails: "blobId" });

// v5 — Phase 4 OCR: scan documents and their pages, saved templates (the v1
// placeholder table was never written to, so it is cleared), device benchmarks.
// Model files moved to Cache Storage, so the unused modelMetadata table goes.
db.version(5)
  .stores({
    ocrDocuments: "id, updatedAt, *fileIds, *datasetIds",
    ocrPages: "id, documentId, [documentId+position], fileId",
    templates: "id, updatedAt",
    benchmarks: "id, createdAt",
    modelMetadata: null,
  })
  .upgrade((tx) => tx.table("templates").clear());

// v6 — City Vet integration: changes made offline wait in the outbox until they are sent.
db.version(6).stores({ outbox: "id, status, createdAt" });

const TIMESTAMP_FIELDS = ["createdAt", "updatedAt", "lastOpenedAt", "deletedAt"] as const;

function toEpoch(value: unknown) {
  if (typeof value !== "string") return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

async function migrateTimestampsToNumbers(tx: Transaction) {
  for (const table of ["folders", "files", "datasets", "processingJobs"]) {
    await tx
      .table(table)
      .toCollection()
      .modify((row: Record<string, unknown>) => {
        for (const field of TIMESTAMP_FIELDS) if (field in row) row[field] = toEpoch(row[field]);
        if (table === "folders" && !("lastOpenedAt" in row)) row.lastOpenedAt = null;
      });
  }
}
