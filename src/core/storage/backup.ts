/**
 * Workspace Backup & Restore
 * Creates a complete, recoverable workspace archive (.zip containing
 * `manifest.json` with every folder/file record and structured dataset, plus
 * the original document bytes under `blobs/`), and restores one. Extraction
 * caches and job history are not backed up; they are rebuilt by processing. Restores are fully validated
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
import { WORKSPACE_TABLES } from "@/core/storage/repositories/workspace-repository";
import { ensureSpaceFor } from "@/core/storage/storage-health";
import { createZip } from "@/core/storage/zip";
import type { FileBlob, Folder, WorkspaceFile } from "@/types/domain";
import type { Dataset, DatasetRow } from "@/types/processing";

/** v3 added datasets. v2 backups (workspace only) still restore. */
export const BACKUP_VERSION = 3;
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
});

export type BackupManifest = z.input<typeof manifestSchema>;

export interface ParsedBackup {
  exportedAt: string;
  folders: Folder[];
  files: WorkspaceFile[];
  blobs: FileBlob[];
  datasets: Dataset[];
  datasetRows: DatasetRow[];
  totalBytes: number;
}

const COMPRESSIBLE = new Set(["csv"]);

/** Builds the backup archive from a consistent snapshot of the database. */
export async function createBackupArchive(now = new Date()): Promise<Blob> {
  const { folders, files, blobs, datasets, datasetRows } = await db.transaction(
    "r",
    [db.folders, db.files, db.fileBlobs, db.datasets, db.datasetRows],
    async () => ({
      folders: await db.folders.toArray(),
      files: await db.files.toArray(),
      blobs: await db.fileBlobs.toArray(),
      datasets: await db.datasets.toArray(),
      datasetRows: await db.datasetRows.toArray(),
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
  });
}
