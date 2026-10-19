/**
 * Workspace Repository
 * Operations that span folders and files together: loading the whole
 * workspace's metadata, emptying the Trash, and wiping all workspace,
 * processing and OCR data (Settings → Privacy).
 */

import { db } from "@/core/storage/database";
import type { Folder, WorkspaceFile } from "@/types/domain";

import { collectSubtree, deleteFilesAndOrphanBlobs } from "./shared";

export interface WorkspaceSnapshot {
  folders: Folder[];
  files: WorkspaceFile[];
}

/** All folder and file metadata (no bytes) — small enough to keep in memory for the UI. */
export function loadWorkspace(): Promise<WorkspaceSnapshot> {
  return db.transaction("r", db.folders, db.files, async () => ({
    folders: await db.folders.toArray(),
    files: await db.files.toArray(),
  }));
}

/** Permanently deletes everything in Trash (trashed folders take their contents with them). */
export function emptyTrash() {
  return db.transaction("rw", db.folders, db.files, db.fileBlobs, db.extractedDocuments, async () => {
    const trashedFolders = await db.folders.filter((f) => f.deletedAt !== null).toArray();
    const folderIds = new Set<string>();
    const files = new Map<string, WorkspaceFile>();
    for (const folder of trashedFolders) {
      if (folderIds.has(folder.id)) continue;
      const subtree = await collectSubtree(folder.id);
      subtree.folders.forEach((f) => folderIds.add(f.id));
      subtree.files.forEach((f) => files.set(f.id, f));
    }
    for (const file of await db.files.filter((f) => f.deletedAt !== null).toArray()) files.set(file.id, file);

    await deleteFilesAndOrphanBlobs([...files.values()]);
    await db.folders.bulkDelete([...folderIds]);
    return { folders: folderIds.size, files: files.size };
  });
}

/** Every table holding the user's documents or data derived from them (what a backup restore replaces). */
export const WORKSPACE_TABLES = [
  db.folders,
  db.files,
  db.fileBlobs,
  db.processingJobs,
  db.extractedDocuments,
  db.datasets,
  db.datasetRows,
  db.thumbnails,
  db.ocrDocuments,
  db.ocrPages,
  db.templates,
] as const;

/** Removes every folder, file, stored byte, extraction, job, dataset, thumbnail, scan, template and benchmark from this device. */
export function clearWorkspace() {
  const tables = [...WORKSPACE_TABLES, db.benchmarks];
  return db.transaction("rw", tables, async () => {
    await Promise.all(tables.map((table) => table.clear()));
  });
}
