/**
 * Record → View Model Mappers
 * Converts stored Folder / WorkspaceFile records into the WorkspaceItem shape
 * the workspace UI renders, and works out which folders are hidden because
 * they (or a folder above them) are in Trash.
 */

import type { Folder, WorkspaceFile } from "@/types/domain";

import type { WorkspaceItem } from "./types";

export function folderToItem(folder: Folder): WorkspaceItem {
  return {
    id: folder.id,
    kind: "folder",
    name: folder.name,
    parentId: folder.parentFolderId,
    modifiedAt: folder.updatedAt,
    openedAt: folder.lastOpenedAt,
    isFavorite: folder.isFavorite,
    deletedAt: folder.deletedAt,
  };
}

export function fileToItem(file: WorkspaceFile): WorkspaceItem {
  return {
    id: file.id,
    kind: "file",
    name: file.name,
    parentId: file.folderId,
    fileType: file.kind,
    mimeType: file.mimeType,
    size: file.size,
    modifiedAt: file.updatedAt,
    openedAt: file.lastOpenedAt,
    isFavorite: file.isFavorite,
    deletedAt: file.deletedAt,
  };
}

/**
 * Ids of folders that are in Trash themselves or sit inside a trashed (or
 * missing) folder. Items inside them are hidden from every view except Trash.
 */
export function hiddenFolderIds(folders: Folder[]): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const memo = new Map<string, boolean>();
  const hidden = (id: string, depth = 0): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const folder = byId.get(id);
    // Missing parents and absurdly deep (cyclic) chains count as hidden.
    const result =
      !folder || depth > 256 || folder.deletedAt !== null || (folder.parentFolderId !== null && hidden(folder.parentFolderId, depth + 1));
    memo.set(id, result);
    return result;
  };
  return new Set(folders.filter((f) => hidden(f.id)).map((f) => f.id));
}

/** Folder chain from the top level down to `folderId` (for breadcrumbs). */
export function folderPath(folderId: string | null, byId: Map<string, Folder>): Folder[] {
  const path: Folder[] = [];
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
  }
  return path;
}
