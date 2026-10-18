/**
 * Folder Download
 * Packs a folder's live contents (subfolders and original files, nothing from
 * Trash) into a .zip that mirrors the folder structure, for "Download" on a
 * folder card.
 */

import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import { collectSubtree } from "@/core/storage/repositories/shared";
import { createZip, type ZipInput } from "@/core/storage/zip";

export async function buildFolderArchive(folderId: string): Promise<{ name: string; blob: Blob; fileCount: number }> {
  const { root, folders, files, blobs } = await db.transaction("r", db.folders, db.files, db.fileBlobs, async () => {
    const subtree = await collectSubtree(folderId);
    const blobIds = [...new Set(subtree.files.map((f) => f.blobId))];
    return {
      root: subtree.folders[0],
      ...subtree,
      blobs: new Map((await db.fileBlobs.bulkGet(blobIds)).flatMap((b) => (b ? [[b.id, b.blob] as const] : []))),
    };
  });
  if (!root) throw new WorkspaceError("not-found", "That folder no longer exists.");

  // Paths for live folders only; anything under a trashed subfolder is skipped.
  const paths = new Map<string, string>([[root.id, root.name]]);
  for (const folder of folders.slice(1)) {
    const parentPath = paths.get(folder.parentFolderId ?? "");
    if (parentPath !== undefined && folder.deletedAt === null) paths.set(folder.id, `${parentPath}/${folder.name}`);
  }

  const inputs: ZipInput[] = [];
  for (const file of files) {
    const dir = paths.get(file.folderId ?? "");
    const blob = blobs.get(file.blobId);
    if (dir === undefined || file.deletedAt !== null || !blob) continue;
    inputs.push({ path: `${dir}/${file.name}`, data: blob, compress: file.kind === "csv" });
  }
  const fileCount = inputs.length;
  // Keep empty folders visible in the archive.
  for (const path of paths.values()) {
    if (!inputs.some((i) => i.path.startsWith(`${path}/`))) inputs.push({ path: `${path}/`, data: new Uint8Array() });
  }

  return { name: `${root.name}.zip`, blob: await createZip(inputs), fileCount };
}
