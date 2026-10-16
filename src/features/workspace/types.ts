export type FileKind = "pdf" | "xlsx" | "csv" | "png" | "jpg" | "webp";

/**
 * View model for a workspace entry. Phase 2 will back this with the Dexie
 * `folders` / `files` tables; for the Phase 1 shell it lives in memory.
 */
export interface WorkspaceItem {
  id: string;
  kind: "folder" | "file";
  name: string;
  fileType?: FileKind;
  /** Bytes, files only. */
  size?: number;
  modifiedAt: number;
  openedAt: number | null;
  isFavorite: boolean;
  deletedAt: number | null;
}

export type WorkspaceSection = "workspace" | "recents" | "favorites" | "trash";
