/**
 * Workspace Actions
 * The write side of the workspace UI. Each function calls the folder/file
 * repositories for the given item, then reports the outcome with a toast
 * (including Undo where it makes sense). The store refreshes itself from
 * IndexedDB, so nothing here touches UI state directly.
 */

import { buildFolderArchive } from "@/core/storage/folder-archive";
import { errorMessage } from "@/core/storage/errors";
import * as folders from "@/core/storage/repositories/folder-repository";
import * as files from "@/core/storage/repositories/file-repository";
import { emptyTrash as emptyTrashRecords } from "@/core/storage/repositories/workspace-repository";
import { getStorageStatus, isStorageLow, requestPersistentStorage } from "@/core/storage/storage-health";
import type { WorkspaceItem } from "@/features/workspace/types";
import { downloadBlob, withExtension } from "@/lib/download";
import type { IntakeFile } from "@/stores/intake-store";
import { toast, type ToastAction } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const noun = (item: WorkspaceItem) => (item.kind === "folder" ? "Folder" : "File");

/** Runs a storage operation; shows `success` on completion or a readable error. Resolves to whether it worked. */
async function run(operation: () => Promise<unknown>, success?: string, action?: ToastAction) {
  try {
    await operation();
    if (success) toast(success, action);
    return true;
  } catch (error) {
    console.error(error);
    toast(errorMessage(error));
    return false;
  }
}

function folderName(folderId: string | null) {
  return folderId === null ? "Workspace" : (useWorkspaceStore.getState().folderById.get(folderId)?.name ?? "folder");
}

/** Throws on invalid names so the name dialog can show the message inline. */
export function createFolder(name: string, parentId: string | null) {
  return folders.createFolder(name, parentId);
}

/** Throws on invalid names so the name dialog can show the message inline. */
export function renameItem(item: WorkspaceItem, name: string) {
  return item.kind === "folder" ? folders.renameFolder(item.id, name) : files.renameFile(item.id, name);
}

export function moveItem(item: WorkspaceItem, targetId: string | null) {
  const previous = item.parentId;
  return run(
    () => (item.kind === "folder" ? folders.moveFolder(item.id, targetId) : files.moveFile(item.id, targetId)),
    `Moved “${item.name}” to ${folderName(targetId)}.`,
    { label: "Undo", onClick: () => void moveItem({ ...item, parentId: targetId }, previous) },
  );
}

export function duplicateItem(item: WorkspaceItem) {
  return run(
    () => (item.kind === "folder" ? folders.duplicateFolder(item.id) : files.duplicateFile(item.id)),
    `Made a copy of “${item.name}”.`,
  );
}

export function toggleFavorite(item: WorkspaceItem) {
  const next = !item.isFavorite;
  return run(
    () => (item.kind === "folder" ? folders.setFolderFavorite(item.id, next) : files.setFileFavorite(item.id, next)),
    next ? "Added to Favorites." : "Removed from Favorites.",
  );
}

export function trashItem(item: WorkspaceItem) {
  return run(
    () => (item.kind === "folder" ? folders.trashFolder(item.id) : files.trashFile(item.id)),
    `${noun(item)} moved to Trash.`,
    { label: "Undo", onClick: () => void restoreItem(item, false) },
  );
}

export function restoreItem(item: WorkspaceItem, announce = true) {
  return run(
    () => (item.kind === "folder" ? folders.restoreFolder(item.id) : files.restoreFile(item.id)),
    announce ? `Restored “${item.name}”.` : undefined,
  );
}

export function deleteItemForever(item: WorkspaceItem) {
  return run(
    () => (item.kind === "folder" ? folders.deleteFolderForever(item.id) : files.deleteFileForever(item.id)),
    `“${item.name}” deleted forever.`,
  );
}

export function emptyTrash() {
  return run(emptyTrashRecords, "Trash emptied.");
}

/** Records that an item was opened (drives Recents). Failures are harmless and silent. */
export function markOpened(item: WorkspaceItem) {
  const write = item.kind === "folder" ? folders.markFolderOpened(item.id) : files.markFileOpened(item.id);
  void write.catch(() => undefined);
}

/** Downloads the original file, or a folder as a .zip. */
export function downloadItem(item: WorkspaceItem) {
  return run(async () => {
    if (item.kind === "folder") {
      const archive = await buildFolderArchive(item.id);
      downloadBlob(archive.blob, archive.name);
      return;
    }
    const { file, blob } = await files.getFileWithBlob(item.id);
    downloadBlob(blob, withExtension(file.name, file.kind));
  });
}

let persistenceRequested = false;

/** After the first save, ask the browser to protect Salin's data and warn when space runs low. */
async function afterSave() {
  if (!persistenceRequested) {
    persistenceRequested = true;
    await requestPersistentStorage();
  }
  const status = await getStorageStatus().catch(() => null);
  if (status && isStorageLow(status)) {
    toast("Storage is almost full. Back up your workspace and delete files you no longer need.");
  }
}

/**
 * Saves validated intake files (imports, uploads, scans) into a folder.
 * Resolves to the number of files saved, or `null` if nothing was saved.
 */
export async function saveIntakeFiles(
  intake: IntakeFile[],
  folderId: string | null,
  options: { onOpen?: () => void } = {},
): Promise<number | null> {
  let saved = 0;
  const ok = await run(async () => {
    const result = await files.importFiles(
      intake.map((f) => ({
        blob: f.file,
        name: f.name,
        kind: f.kind,
        mimeType: f.file.type,
        dirPath: f.folderPath,
        source: f.source,
      })),
      folderId,
    );
    saved = result.files.length;
  });
  if (!ok) return null;
  toast(
    `Saved ${saved} file${saved === 1 ? "" : "s"} to ${folderName(folderId)}.`,
    options.onOpen ? { label: "Open", onClick: options.onOpen } : undefined,
  );
  void afterSave();
  return saved;
}
