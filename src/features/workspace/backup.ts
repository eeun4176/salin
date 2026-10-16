import { z } from "zod";

import type { WorkspaceItem } from "./types";

const itemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["folder", "file"]),
  name: z.string().min(1).max(255),
  fileType: z.enum(["pdf", "xlsx", "csv", "png", "jpg", "webp"]).optional(),
  size: z.number().nonnegative().optional(),
  modifiedAt: z.number(),
  openedAt: z.number().nullable(),
  isFavorite: z.boolean(),
  deletedAt: z.number().nullable(),
});

const backupSchema = z.object({
  app: z.literal("salin"),
  version: z.literal(1),
  exportedAt: z.string(),
  items: z.array(itemSchema),
});

/**
 * Phase 1 backup: workspace metadata only. Phase 2 extends this with Dexie
 * tables and file blobs (docs 7.3 / 11).
 */
export function downloadBackup(items: WorkspaceItem[]) {
  const payload = { app: "salin", version: 1, exportedAt: new Date().toISOString(), items };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `salin-backup-${payload.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parses and validates a backup file; backups are untrusted input. */
export async function readBackup(file: File): Promise<WorkspaceItem[]> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Backup file is larger than 10 MB.");
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const result = backupSchema.safeParse(json);
  if (!result.success) throw new Error("That file isn't a Salin backup.");
  return result.data.items;
}
