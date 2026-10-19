/**
 * Thumbnail Repository
 * Stores the previews shown on file cards, one per set of document bytes (so
 * copies of a file share it). Thumbnails are derived data: they're rebuilt
 * when missing, left out of backups, and pruned once their bytes are gone.
 */

import { db } from "@/core/storage/database";
import type { Thumbnail } from "@/types/domain";

export function getThumbnail(blobId: string) {
  return db.thumbnails.get(blobId);
}

export async function saveThumbnail(thumbnail: Thumbnail) {
  await db.thumbnails.put(thumbnail);
}

/** Deletes thumbnails whose file bytes no longer exist. Returns how many were removed. */
export function pruneThumbnails() {
  return db.transaction("rw", db.thumbnails, db.fileBlobs, async () => {
    const blobIds = (await db.thumbnails.toCollection().primaryKeys()) as string[];
    // Keys only: loading the blobs themselves would read every document into memory.
    const existing = new Set((await db.fileBlobs.where(":id").anyOf(blobIds).primaryKeys()) as string[]);
    const orphans = blobIds.filter((id) => !existing.has(id));
    await db.thumbnails.bulkDelete(orphans);
    return orphans.length;
  });
}
