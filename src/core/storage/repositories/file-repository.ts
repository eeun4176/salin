/**
 * File Repository
 * Every write to the `files` and `fileBlobs` tables: importing documents
 * (metadata + bytes + any folders from an uploaded folder, all in one
 * transaction), reading bytes back for preview/download, rename, move, copy,
 * favorite, last-opened, Trash, restore and permanent deletion.
 */

import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import { normalizeName, sanitizeName, uniqueName, validateName } from "@/core/storage/names";
import { ensureSpaceFor } from "@/core/storage/storage-health";
import type { FileBlob, FileKind, Folder, WorkspaceFile } from "@/types/domain";

import {
  assertLiveFolder,
  deleteFilesAndOrphanBlobs,
  getFileOrThrow,
  isLiveFolder,
  liveChildFiles,
  liveChildFolders,
  lowerNames,
} from "./shared";

export interface ImportEntry {
  blob: Blob;
  name: string;
  kind: FileKind;
  mimeType: string;
  /** Folder path inside the upload ("Census/Batch 1"), or "" for a loose file. */
  dirPath: string;
  source: WorkspaceFile["source"];
}

export interface ImportResult {
  files: WorkspaceFile[];
  folders: Folder[];
}

/** SHA-256 hex digest, or `null` where Web Crypto is unavailable (plain-HTTP origins). */
export async function sha256(blob: Blob): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function invalid(message: string): never {
  throw new WorkspaceError("validation", message);
}

/**
 * Saves files into `destFolderId`. Folder paths from folder uploads are
 * recreated underneath it. Metadata, bytes and new folders are written in a
 * single transaction: if anything fails, nothing is saved.
 */
export async function importFiles(entries: ImportEntry[], destFolderId: string | null): Promise<ImportResult> {
  if (entries.length === 0) return { files: [], folders: [] };
  await ensureSpaceFor(entries.reduce((sum, e) => sum + e.blob.size, 0));

  // Hash before the transaction: IndexedDB transactions close if they wait on non-database work.
  const checksums: (string | null)[] = [];
  for (const entry of entries) checksums.push(await sha256(entry.blob));

  return db.transaction("rw", db.folders, db.files, db.fileBlobs, async () => {
    await assertLiveFolder(destFolderId);
    const now = Date.now();
    const folderIdByPath = new Map<string, string | null>([["", destFolderId]]);
    const fileNamesByFolder = new Map<string | null, Set<string>>();
    const createdFolders: Folder[] = [];
    const savedFiles: WorkspaceFile[] = [];

    const ensurePath = async (path: string): Promise<string | null> => {
      const known = folderIdByPath.get(path);
      if (known !== undefined) return known;
      const cut = path.lastIndexOf("/");
      const parentId = await ensurePath(cut === -1 ? "" : path.slice(0, cut));
      const segment = sanitizeName(path.slice(cut + 1), "Folder");
      // A newly uploaded folder never merges into an existing one with the same name.
      const name = uniqueName(segment, lowerNames(await liveChildFolders(parentId)), false);
      const folder: Folder = {
        id: crypto.randomUUID(),
        name,
        parentFolderId: parentId,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
        deletedAt: null,
        isFavorite: false,
      };
      await db.folders.add(folder);
      createdFolders.push(folder);
      folderIdByPath.set(path, folder.id);
      return folder.id;
    };

    for (const [i, entry] of entries.entries()) {
      const dirPath = entry.dirPath.split("/").filter(Boolean).join("/");
      const folderId = await ensurePath(dirPath);
      let taken = fileNamesByFolder.get(folderId);
      if (!taken) {
        taken = lowerNames(await liveChildFiles(folderId));
        fileNamesByFolder.set(folderId, taken);
      }
      const name = uniqueName(sanitizeName(entry.name), taken, true);
      taken.add(name.toLowerCase());

      const blob: FileBlob = { id: crypto.randomUUID(), blob: entry.blob, size: entry.blob.size, checksum: checksums[i] };
      const file: WorkspaceFile = {
        id: crypto.randomUUID(),
        name,
        mimeType: entry.mimeType || entry.blob.type || "application/octet-stream",
        kind: entry.kind,
        size: entry.blob.size,
        folderId,
        blobId: blob.id,
        source: entry.source,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
        deletedAt: null,
        isFavorite: false,
      };
      await db.fileBlobs.add(blob);
      await db.files.add(file);
      savedFiles.push(file);
    }
    return { files: savedFiles, folders: createdFolders };
  });
}

/** Loads a file record together with its bytes. */
export function getFileWithBlob(id: string): Promise<{ file: WorkspaceFile; blob: Blob }> {
  return db.transaction("r", db.files, db.fileBlobs, async () => {
    const file = await getFileOrThrow(id);
    const stored = await db.fileBlobs.get(file.blobId);
    if (!stored) throw new WorkspaceError("not-found", "This file's contents are missing from this device.");
    return { file, blob: stored.blob };
  });
}

export function renameFile(id: string, name: string) {
  return db.transaction("rw", db.files, async () => {
    const file = await getFileOrThrow(id);
    const error = validateName(name, await liveChildFiles(file.folderId), id);
    if (error) invalid(error);
    await db.files.update(id, { name: normalizeName(name), updatedAt: Date.now() });
  });
}

export function moveFile(id: string, targetId: string | null) {
  return db.transaction("rw", db.folders, db.files, async () => {
    const file = await getFileOrThrow(id);
    if (file.deletedAt !== null) invalid("Restore this file before moving it.");
    if (file.folderId === targetId) return;
    await assertLiveFolder(targetId);
    const name = uniqueName(file.name, lowerNames(await liveChildFiles(targetId)), true);
    await db.files.update(id, { folderId: targetId, name, updatedAt: Date.now() });
  });
}

/** "Make a copy": a new file record in the same folder that shares the original's bytes. */
export function duplicateFile(id: string): Promise<WorkspaceFile> {
  return db.transaction("rw", db.files, async () => {
    const source = await getFileOrThrow(id);
    if (source.deletedAt !== null) invalid("Restore this file before copying it.");
    const now = Date.now();
    const copy: WorkspaceFile = {
      ...source,
      id: crypto.randomUUID(),
      name: uniqueName(`Copy of ${source.name}`, lowerNames(await liveChildFiles(source.folderId)), true),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      isFavorite: false,
    };
    await db.files.add(copy);
    return copy;
  });
}

export function setFileFavorite(id: string, isFavorite: boolean) {
  return db.transaction("rw", db.files, async () => {
    await getFileOrThrow(id);
    await db.files.update(id, { isFavorite });
  });
}

export function markFileOpened(id: string) {
  return db.files.update(id, { lastOpenedAt: Date.now() });
}

export function trashFile(id: string) {
  return db.transaction("rw", db.files, async () => {
    await getFileOrThrow(id);
    await db.files.update(id, { deletedAt: Date.now() });
  });
}

/** Brings a file back. If its folder is gone or in Trash, it returns to the top level. */
export function restoreFile(id: string) {
  return db.transaction("rw", db.folders, db.files, async () => {
    const file = await getFileOrThrow(id);
    const folderId = (await isLiveFolder(file.folderId)) ? file.folderId : null;
    const name = uniqueName(file.name, lowerNames(await liveChildFiles(folderId)), true);
    await db.files.update(id, { deletedAt: null, folderId, name });
  });
}

/** Permanently removes a file, and its bytes if no copy still uses them. */
export function deleteFileForever(id: string) {
  return db.transaction("rw", db.files, db.fileBlobs, db.extractedDocuments, async () => {
    await deleteFilesAndOrphanBlobs([await getFileOrThrow(id)]);
  });
}
