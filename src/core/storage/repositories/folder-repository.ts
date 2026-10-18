/**
 * Folder Repository
 * Every write to the `folders` table: create, rename, move, duplicate (deep
 * copy), favorite, last-opened, Trash, restore and permanent deletion of a
 * whole folder tree. Each operation runs in one IndexedDB transaction, so it
 * either fully applies or leaves the workspace unchanged.
 */

import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import { normalizeName, uniqueName, validateName } from "@/core/storage/names";
import type { Folder, WorkspaceFile } from "@/types/domain";

import {
  ancestorChain,
  assertLiveFolder,
  collectSubtree,
  deleteFilesAndOrphanBlobs,
  getFolderOrThrow,
  isLiveFolder,
  liveChildFolders,
  lowerNames,
} from "./shared";

function invalid(message: string): never {
  throw new WorkspaceError("validation", message);
}

export function createFolder(name: string, parentId: string | null): Promise<Folder> {
  return db.transaction("rw", db.folders, async () => {
    await assertLiveFolder(parentId);
    const error = validateName(name, await liveChildFolders(parentId));
    if (error) invalid(error);
    const now = Date.now();
    const folder: Folder = {
      id: crypto.randomUUID(),
      name: normalizeName(name),
      parentFolderId: parentId,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      deletedAt: null,
      isFavorite: false,
    };
    await db.folders.add(folder);
    return folder;
  });
}

export function renameFolder(id: string, name: string) {
  return db.transaction("rw", db.folders, async () => {
    const folder = await getFolderOrThrow(id);
    const error = validateName(name, await liveChildFolders(folder.parentFolderId), id);
    if (error) invalid(error);
    await db.folders.update(id, { name: normalizeName(name), updatedAt: Date.now() });
  });
}

/** Moves a folder (with everything in it) into `targetId`; refuses moves into itself or its subfolders. */
export function moveFolder(id: string, targetId: string | null) {
  return db.transaction("rw", db.folders, async () => {
    const folder = await getFolderOrThrow(id);
    if (folder.deletedAt !== null) invalid("Restore this folder before moving it.");
    if (folder.parentFolderId === targetId) return;
    await assertLiveFolder(targetId);
    if ((await ancestorChain(targetId)).some((f) => f.id === id)) {
      invalid("A folder can't be moved into itself or one of its subfolders.");
    }
    const name = uniqueName(folder.name, lowerNames(await liveChildFolders(targetId)), false);
    await db.folders.update(id, { parentFolderId: targetId, name, updatedAt: Date.now() });
  });
}

/** Deep-copies a folder's live contents next to it. Copied files share the original bytes. */
export function duplicateFolder(id: string): Promise<Folder> {
  return db.transaction("rw", db.folders, db.files, async () => {
    const source = await getFolderOrThrow(id);
    if (source.deletedAt !== null) invalid("Restore this folder before copying it.");
    const { folders, files } = await collectSubtree(id);
    const now = Date.now();

    // Map old folder id → new folder id, skipping anything already in Trash.
    const newIds = new Map<string, string>();
    const copies: Folder[] = [];
    for (const folder of folders) {
      const parentCopy = folder.id === id ? source.parentFolderId : newIds.get(folder.parentFolderId ?? "");
      if (folder.id !== id && (folder.deletedAt !== null || parentCopy === undefined)) continue;
      const newId = crypto.randomUUID();
      newIds.set(folder.id, newId);
      copies.push({
        ...folder,
        id: newId,
        parentFolderId: parentCopy ?? null,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
        isFavorite: false,
        deletedAt: null,
      });
    }
    copies[0].name = uniqueName(`Copy of ${source.name}`, lowerNames(await liveChildFolders(source.parentFolderId)), false);

    const fileCopies: WorkspaceFile[] = files
      .filter((f) => f.deletedAt === null && f.folderId !== null && newIds.has(f.folderId))
      .map((f) => ({
        ...f,
        id: crypto.randomUUID(),
        folderId: newIds.get(f.folderId!)!,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: null,
        isFavorite: false,
      }));

    await db.folders.bulkAdd(copies);
    await db.files.bulkAdd(fileCopies);
    return copies[0];
  });
}

export function setFolderFavorite(id: string, isFavorite: boolean) {
  return db.transaction("rw", db.folders, async () => {
    await getFolderOrThrow(id);
    await db.folders.update(id, { isFavorite });
  });
}

export function markFolderOpened(id: string) {
  return db.folders.update(id, { lastOpenedAt: Date.now() });
}

/** Soft delete: the folder and everything under it disappear from normal views. */
export function trashFolder(id: string) {
  return db.transaction("rw", db.folders, async () => {
    await getFolderOrThrow(id);
    await db.folders.update(id, { deletedAt: Date.now() });
  });
}

/** Brings a folder back. If its old parent is gone or in Trash, it returns to the top level. */
export function restoreFolder(id: string) {
  return db.transaction("rw", db.folders, async () => {
    const folder = await getFolderOrThrow(id);
    const parentId = (await isLiveFolder(folder.parentFolderId)) ? folder.parentFolderId : null;
    const name = uniqueName(folder.name, lowerNames(await liveChildFolders(parentId)), false);
    await db.folders.update(id, { deletedAt: null, parentFolderId: parentId, name });
  });
}

/** Permanently removes a folder, every subfolder and file inside it, and bytes no other file uses. */
export function deleteFolderForever(id: string) {
  return db.transaction("rw", db.folders, db.files, db.fileBlobs, async () => {
    const { folders, files } = await collectSubtree(id);
    await deleteFilesAndOrphanBlobs(files);
    await db.folders.bulkDelete(folders.map((f) => f.id));
  });
}
