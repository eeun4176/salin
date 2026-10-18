/**
 * Backup Actions
 * UI-facing backup helpers: build the workspace archive and download it
 * (with progress and result toasts), and wipe all workspace data from the
 * device (Settings → Privacy).
 */

import { backupFileName, createBackupArchive } from "@/core/storage/backup";
import { errorMessage } from "@/core/storage/errors";
import { clearWorkspace } from "@/core/storage/repositories/workspace-repository";
import { formatBytes } from "@/features/workspace/query";
import { downloadBlob } from "@/lib/download";
import { toast, useToastStore } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

let exporting = false;

/** Builds the .zip backup of every folder, file record and original document, then downloads it. */
export async function exportWorkspaceBackup() {
  if (exporting) return false;
  exporting = true;
  const progress = toast("Preparing backup…", undefined, { duration: null });
  try {
    const now = new Date();
    const archive = await createBackupArchive(now);
    downloadBlob(archive, backupFileName(now));
    const { folders, files } = useWorkspaceStore.getState();
    toast(`Backup saved: ${folders.length} folder${folders.length === 1 ? "" : "s"}, ${files.length} file${files.length === 1 ? "" : "s"} (${formatBytes(archive.size)}).`);
    return true;
  } catch (error) {
    console.error(error);
    toast(errorMessage(error, "The backup couldn't be created. Please try again."));
    return false;
  } finally {
    useToastStore.getState().dismiss(progress);
    exporting = false;
  }
}

/** Deletes every folder, file and stored document on this device. */
export async function deleteAllWorkspaceData() {
  try {
    await clearWorkspace();
    toast("All workspace data was deleted from this device.");
    return true;
  } catch (error) {
    toast(errorMessage(error, "Couldn't delete the workspace data. Please try again."));
    return false;
  }
}
