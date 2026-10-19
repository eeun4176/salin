/**
 * Repository Helpers
 * Small building blocks shared by the folder and file repositories: sibling
 * lookups, "is this folder usable" checks, subtree collection and blob
 * clean-up. They must be called inside a Dexie transaction that includes the
 * tables they touch, so multi-step changes stay all-or-nothing.
 * `deleteFilesAndOrphanBlobs` also needs `extractedDocuments` in the transaction.
 */

import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import type { Folder, WorkspaceFile } from "@/types/domain";

// IndexedDB can't index `null`, so top-level items are found with a scan.
export function childFolders(parentId: string | null): Promise<Folder[]> {
  return parentId === null
    ? db.folders.filter((f) => f.parentFolderId === null).toArray()
    : db.folders.where("parentFolderId").equals(parentId).toArray();
}

export function childFiles(folderId: string | null): Promise<WorkspaceFile[]> {
  return folderId === null
    ? db.files.filter((f) => f.folderId === null).toArray()
    : db.files.where("folderId").equals(folderId).toArray();
}

/** Live (not trashed) folders inside `parentId`. */
export async function liveChildFolders(parentId: string | null) {
  return (await childFolders(parentId)).filter((f) => f.deletedAt === null);
}

/** Live (not trashed) files inside `folderId`. */
export async function liveChildFiles(folderId: string | null) {
  return (await childFiles(folderId)).filter((f) => f.deletedAt === null);
}

export function lowerNames(items: { name: string }[]) {
  return new Set(items.map((item) => item.name.toLowerCase()));
}

/** Returns the folder chain from `folderId` up to the top level (nearest first). */
export async function ancestorChain(folderId: string | null): Promise<Folder[]> {
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let current = folderId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const folder = await db.folders.get(current);
    if (!folder) break;
    chain.push(folder);
    current = folder.parentFolderId;
  }
  return chain;
}

/** True if the folder exists and neither it nor any ancestor is in Trash. */
export async function isLiveFolder(folderId: string | null) {
  if (folderId === null) return true;
  const chain = await ancestorChain(folderId);
  if (chain[0]?.id !== folderId) return false;
  const top = chain.at(-1);
  return top?.parentFolderId === null && chain.every((f) => f.deletedAt === null);
}

/** Throws unless items can be placed in `folderId` (`null` = top level). */
export async function assertLiveFolder(folderId: string | null) {
  if (!(await isLiveFolder(folderId))) {
    throw new WorkspaceError("not-found", "That folder no longer exists or is in Trash.");
  }
}

/** Every folder in the subtree rooted at `rootId` (root included) and every file inside them. */
export async function collectSubtree(rootId: string) {
  const folders: Folder[] = [];
  const root = await db.folders.get(rootId);
  if (!root) return { folders, files: [] as WorkspaceFile[] };
  folders.push(root);
  for (let i = 0; i < folders.length; i++) {
    folders.push(...(await db.folders.where("parentFolderId").equals(folders[i].id).toArray()));
  }
  const folderIds = folders.map((f) => f.id);
  const files = await db.files.where("folderId").anyOf(folderIds).toArray();
  return { folders, files };
}

/** Deletes file records, then any blob no remaining file points to (and text extracted from it). */
export async function deleteFilesAndOrphanBlobs(files: WorkspaceFile[]) {
  if (files.length === 0) return;
  await db.files.bulkDelete(files.map((f) => f.id));
  const blobIds = [...new Set(files.map((f) => f.blobId))];
  for (const blobId of blobIds) {
    if ((await db.files.where("blobId").equals(blobId).count()) > 0) continue;
    await db.fileBlobs.delete(blobId);
    await db.extractedDocuments.where("blobId").equals(blobId).delete();
  }
}

export async function getFolderOrThrow(id: string) {
  const folder = await db.folders.get(id);
  if (!folder) throw new WorkspaceError("not-found", "That folder no longer exists.");
  return folder;
}

export async function getFileOrThrow(id: string) {
  const file = await db.files.get(id);
  if (!file) throw new WorkspaceError("not-found", "That file no longer exists.");
  return file;
}
