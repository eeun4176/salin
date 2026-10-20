/**
 * Workspace Backup & Restore
 * Creates a complete, recoverable workspace archive (.zip containing
 * `manifest.json` with every folder/file record and structured dataset, plus
 * the original document bytes under `blobs/`, plus scans (OCR results, edits
 * and reviews — not their processed images, which are rebuilt from the
 * originals) and saved templates), and restores one. Extraction caches, job
 * history, thumbnails and OCR model files are not backed up; they are rebuilt
 * or downloaded again. Restores are fully validated
 * (format, version, sizes, SHA-256 checksums, references) before anything is
 * written, then replace the workspace in a single transaction.
 */

import { strFromU8, strToU8, unzipSync } from "fflate";
import { z } from "zod";

import { datasetRowSchema, datasetSchema } from "@/core/processing/dataset-validator";
import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import { MAX_NAME_LENGTH } from "@/core/storage/names";
import { sha256 } from "@/core/storage/repositories/file-repository";
import { parseTemplate, TemplateError } from "@/core/ocr/templates/template-schema";
import { WORKSPACE_TABLES } from "@/core/storage/repositories/workspace-repository";
import { ensureSpaceFor } from "@/core/storage/storage-health";
import { createZip } from "@/core/storage/zip";
import type { FileBlob, Folder, WorkspaceFile } from "@/types/domain";
import type { Dataset, DatasetRow } from "@/types/processing";
import type { OcrDocument, OcrPage, PageEdits, StoredTemplate } from "@/types/ocr";

/** v3 added datasets, v4 scans (OCR) and templates. v2 and v3 backups still restore. */
export const BACKUP_VERSION = 4;
const OLDEST_SUPPORTED_VERSION = 2;
const MANIFEST_PATH = "manifest.json";
const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;

const timestamp = z.number().int().nonnegative();
const id = z.string().min(1).max(100);
const name = z.string().min(1).max(MAX_NAME_LENGTH);

const folderSchema = z.object({
  id,
  name,
  parentFolderId: id.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  lastOpenedAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
  isFavorite: z.boolean(),
});

const fileSchema = z.object({
  id,
  name,
  mimeType: z.string().max(200),
  kind: z.enum(["pdf", "xlsx", "csv", "txt", "png", "jpg", "webp"]),
  size: z.number().int().nonnegative(),
  folderId: id.nullable(),
  blobId: id,
  source: z.enum(["import", "scan"]),
  createdAt: timestamp,
  updatedAt: timestamp,
  lastOpenedAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
  isFavorite: z.boolean(),
});

const blobEntrySchema = z.object({
  id,
  size: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  path: z.string().min(1),
});

const extractionSchema = z.object({
  id: z.string().max(100).optional(),
  templateId: z.string().min(1).max(100),
  forms: z.array(z.object({ page: z.number().int().positive(), fields: z.array(z.record(z.string(), z.unknown())) })),
  tables: z.array(z.object({ key: z.string(), label: z.string(), columns: z.array(z.record(z.string(), z.unknown())), rows: z.array(z.record(z.string(), z.unknown())) })),
  summaries: z.array(z.record(z.string(), z.unknown())),
  unsupported: z.string().nullable(),
  warnings: z.array(z.string()),
  // Phase 5: the template version used, and suggestions with their accept/reject decisions.
  templateVersion: z.number().int().positive().optional(),
  suggestions: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
});

const ocrDocumentSchema = z.object({
  id,
  name,
  fileIds: z.array(id),
  templateId: z.string().min(1).max(100),
  languages: z.array(z.string().max(10)).min(1),
  stage: z.enum(["prepare", "read", "review", "done"]),
  extraction: extractionSchema.nullable(),
  datasetIds: z.array(id),
  createdAt: timestamp,
  updatedAt: timestamp,
});

// Page images are left out (rebuilt from the original files); results and layout come along.
const ocrPageSchema = z.object({
  id,
  documentId: id,
  position: z.number().int().nonnegative(),
  fileId: id,
  pdfPage: z.number().int().positive().nullable(),
  edits: z.object({ rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), crop: z.array(z.object({ x: z.number(), y: z.number() })).length(4).nullable(), deskew: z.boolean(), enhance: z.object({ shadows: z.boolean(), contrast: z.boolean(), denoise: z.boolean(), blackAndWhite: z.boolean() }) }),
  processedKey: z.string().max(400).nullable(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  marks: z.record(z.string(), z.unknown()).nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  resultKey: z.string().max(400).nullable(),
  layout: z.record(z.string(), z.unknown()).nullable(),
  state: z.enum(["pending", "done", "failed", "cancelled"]),
  error: z.string().max(2000).nullable(),
});

const templateRecordSchema = z.object({ id, definition: z.unknown(), createdAt: timestamp, updatedAt: timestamp });

const manifestSchema = z.object({
  app: z.literal("salin"),
  kind: z.literal("workspace-backup"),
  version: z.number().int(),
  exportedAt: z.string(),
  folders: z.array(folderSchema),
  files: z.array(fileSchema),
  blobs: z.array(blobEntrySchema),
  datasets: z.array(datasetSchema).default([]),
  datasetRows: z.array(datasetRowSchema).default([]),
  ocrDocuments: z.array(ocrDocumentSchema).default([]),
  ocrPages: z.array(ocrPageSchema).default([]),
  templates: z.array(templateRecordSchema).default([]),
});

export type BackupManifest = z.input<typeof manifestSchema>;

export interface ParsedBackup {
  exportedAt: string;
  folders: Folder[];
  files: WorkspaceFile[];
  blobs: FileBlob[];
  datasets: Dataset[];
  datasetRows: DatasetRow[];
  ocrDocuments: OcrDocument[];
  ocrPages: OcrPage[];
  templates: StoredTemplate[];
  totalBytes: number;
}

const COMPRESSIBLE = new Set(["csv"]);

/** Builds the backup archive from a consistent snapshot of the database. */
export async function createBackupArchive(now = new Date()): Promise<Blob> {
  const { folders, files, blobs, datasets, datasetRows, ocrDocuments, ocrPages, templates } = await db.transaction(
    "r",
    [db.folders, db.files, db.fileBlobs, db.datasets, db.datasetRows, db.ocrDocuments, db.ocrPages, db.templates],
    async () => ({
      folders: await db.folders.toArray(),
      files: await db.files.toArray(),
      blobs: await db.fileBlobs.toArray(),
      datasets: await db.datasets.toArray(),
      datasetRows: await db.datasetRows.toArray(),
      ocrDocuments: await db.ocrDocuments.toArray(),
      ocrPages: await db.ocrPages.toArray(),
      templates: await db.templates.toArray(),
    }),
  );

  const kindByBlob = new Map(files.map((f) => [f.blobId, f.kind]));
  const manifest: BackupManifest = {
    app: "salin",
    kind: "workspace-backup",
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    folders,
    files,
    blobs: blobs.map((b) => ({ id: b.id, size: b.size, checksum: b.checksum, path: `blobs/${b.id}` })),
    datasets,
    datasetRows,
    // Results, layouts and reviews are validated loosely (shape, not every field) on restore.
    ocrDocuments: ocrDocuments as BackupManifest["ocrDocuments"],
    // Images are dropped (undefined isn't written to JSON): they're rebuilt from the originals.
    ocrPages: ocrPages.map((page) => ({ ...page, source: undefined, processed: undefined })) as BackupManifest["ocrPages"],
    templates,
  };

  return createZip([
    { path: MANIFEST_PATH, data: strToU8(JSON.stringify(manifest)), compress: true },
    ...blobs.map((b) => ({ path: `blobs/${b.id}`, data: b.blob, compress: COMPRESSIBLE.has(kindByBlob.get(b.id) ?? "") })),
  ]);
}

export function backupFileName(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `salin-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

function reject(message: string): never {
  throw new WorkspaceError("invalid-backup", message);
}

function assertUnique(ids: string[], what: string) {
  if (new Set(ids).size !== ids.length) reject(`This backup lists the same ${what} twice, so it can't be restored safely.`);
}

/** Checks parent links: every parent exists and no folder is its own ancestor. */
function assertFolderTree(folders: Folder[]) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (const folder of folders) {
    const seen = new Set<string>();
    let current: Folder | undefined = folder;
    while (current && current.parentFolderId !== null) {
      if (seen.has(current.id)) reject("This backup's folder structure loops back on itself.");
      seen.add(current.id);
      current = byId.get(current.parentFolderId);
      if (!current) reject("This backup has a folder whose parent is missing.");
    }
  }
}

/** Every row belongs to a dataset, only uses its columns, and row counts add up. */
function assertDatasets(datasets: Dataset[], rows: DatasetRow[]) {
  const columnsByDataset = new Map(datasets.map((d) => [d.id, new Set(d.columns.map((c) => c.id))]));
  const rowCounts = new Map<string, number>();
  for (const row of rows) {
    const columns = columnsByDataset.get(row.datasetId);
    if (!columns) reject("This backup has table rows that don't belong to any dataset.");
    if (Object.keys(row.values).some((key) => !columns.has(key))) reject("This backup has a dataset row with values for unknown columns.");
    rowCounts.set(row.datasetId, (rowCounts.get(row.datasetId) ?? 0) + 1);
  }
  for (const dataset of datasets) {
    if ((rowCounts.get(dataset.id) ?? 0) !== dataset.rowCount) reject(`Some rows of the dataset "${dataset.name}" are missing from the backup.`);
  }
}

/**
 * Reads and fully validates a backup file. Throws a WorkspaceError with a
 * readable message for anything that isn't a complete, intact Salin backup.
 */
export async function readBackupArchive(file: Blob): Promise<ParsedBackup> {
  if (file.size === 0) reject("That file is empty.");
  if (file.size > MAX_BACKUP_BYTES) reject("Backups larger than 1 GB can't be restored in the browser.");
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes[0] === 0x7b /* "{" */) {
    reject("This is a Phase 1 preview backup. It has no file contents, so it can't be restored.");
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b /* "PK" */) reject("That file isn't a Salin backup.");

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    reject("That backup is damaged and can't be opened.");
  }

  const manifestBytes = entries[MANIFEST_PATH];
  if (!manifestBytes) reject("That file isn't a Salin backup.");
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(manifestBytes));
  } catch {
    reject("That backup's manifest is damaged.");
  }
  const versionCheck = z.object({ app: z.literal("salin"), version: z.number() }).safeParse(json);
  if (!versionCheck.success) reject("That file isn't a Salin backup.");
  if (versionCheck.data.version > BACKUP_VERSION) reject("This backup was made by a newer version of Salin. Update the app, then try again.");
  if (versionCheck.data.version < OLDEST_SUPPORTED_VERSION) reject("This backup format is no longer supported.");

  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) reject("That backup's manifest is incomplete or damaged.");
  const manifest = parsed.data;

  assertUnique(manifest.folders.map((f) => f.id), "folder");
  assertUnique(manifest.files.map((f) => f.id), "file");
  assertUnique(manifest.blobs.map((b) => b.id), "document");
  assertUnique(manifest.datasets.map((d) => d.id), "dataset");
  assertUnique(manifest.datasetRows.map((r) => r.id), "dataset row");
  assertFolderTree(manifest.folders);
  assertDatasets(manifest.datasets, manifest.datasetRows);
  assertUnique(manifest.ocrDocuments.map((d) => d.id), "scan");
  assertUnique(manifest.ocrPages.map((p) => p.id), "scan page");
  const scanIds = new Set(manifest.ocrDocuments.map((d) => d.id));
  if (manifest.ocrPages.some((p) => !scanIds.has(p.documentId))) reject("This backup has scan pages that don't belong to any scan.");
  for (const template of manifest.templates) {
    try {
      parseTemplate(template.definition);
    } catch (error) {
      if (error instanceof TemplateError) reject(`A saved template in this backup is damaged. ${error.message}`);
      throw error;
    }
  }

  const folderIds = new Set(manifest.folders.map((f) => f.id));
  const blobSizes = new Map(manifest.blobs.map((b) => [b.id, b.size]));
  for (const f of manifest.files) {
    if (f.folderId !== null && !folderIds.has(f.folderId)) reject(`"${f.name}" points to a folder that isn't in the backup.`);
    if (!blobSizes.has(f.blobId)) reject(`The contents of "${f.name}" are missing from the backup.`);
    if (blobSizes.get(f.blobId) !== f.size) reject(`The size of "${f.name}" doesn't match its contents.`);
  }

  const mimeByBlob = new Map(manifest.files.map((f) => [f.blobId, f.mimeType]));
  const blobs: FileBlob[] = [];
  for (const entry of manifest.blobs) {
    const data = entries[entry.path];
    if (!data) reject("Some document contents are missing from the backup.");
    if (data.byteLength !== entry.size) reject("Some document contents in the backup are incomplete.");
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeByBlob.get(entry.id) ?? "" });
    if (entry.checksum) {
      const actual = await sha256(blob);
      if (actual !== null && actual !== entry.checksum) reject("Some document contents in the backup are damaged (checksum mismatch).");
    }
    blobs.push({ id: entry.id, blob, size: entry.size, checksum: entry.checksum });
  }

  return {
    exportedAt: manifest.exportedAt,
    folders: manifest.folders,
    files: manifest.files,
    blobs,
    datasets: manifest.datasets,
    datasetRows: manifest.datasetRows,
    ocrDocuments: manifest.ocrDocuments as OcrDocument[],
    ocrPages: manifest.ocrPages.map((page) => ({ ...page, edits: page.edits as PageEdits, source: null, processed: null }) as OcrPage),
    templates: manifest.templates,
    totalBytes: blobs.reduce((sum, b) => sum + b.size, 0),
  };
}

/**
 * Replaces the whole workspace with a validated backup. Runs in one
 * transaction: if writing fails part-way (e.g. storage full), the previous
 * workspace is kept exactly as it was.
 */
export async function restoreBackup(backup: ParsedBackup) {
  await ensureSpaceFor(backup.totalBytes);
  await db.transaction("rw", WORKSPACE_TABLES, async () => {
    await Promise.all(WORKSPACE_TABLES.map((table) => table.clear()));
    await db.fileBlobs.bulkAdd(backup.blobs);
    await db.folders.bulkAdd(backup.folders);
    await db.files.bulkAdd(backup.files);
    await db.datasets.bulkAdd(backup.datasets);
    await db.datasetRows.bulkAdd(backup.datasetRows);
    await db.ocrDocuments.bulkAdd(backup.ocrDocuments);
    await db.ocrPages.bulkAdd(backup.ocrPages);
    await db.templates.bulkAdd(backup.templates);
  });
}
