/**
 * Local Database (Dexie / IndexedDB)
 * Declares the "SalinAI" IndexedDB database, its tables, indexes and versioned
 * migrations. Every repository reads and writes through the `db` exported here.
 * Workspace tables: folders, files, fileBlobs. Processing tables (Phase 3):
 * processingJobs, extractedDocuments, datasets, datasetRows. Derived: thumbnails.
 */

import Dexie, { type EntityTable, type Transaction } from "dexie";

import type { AppSetting, DocumentTemplate, FileBlob, Folder, ModelMetadata, Thumbnail, WorkspaceFile } from "@/types/domain";
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
  templates: EntityTable<DocumentTemplate, "id">;
  modelMetadata: EntityTable<ModelMetadata, "id">;
  settings: EntityTable<AppSetting, "key">;
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
