/**
 * Workspace View Types
 * The `WorkspaceItem` view model that every card, row, menu and filter in the
 * workspace UI renders — one shape for both folders and files — plus the
 * names of the four workspace tabs.
 */

import type { FileKind } from "@/types/domain";

export type { FileKind };

/** A folder or file as the workspace UI sees it (mapped from Dexie records in mappers.ts). */
export interface WorkspaceItem {
  id: string;
  kind: "folder" | "file";
  name: string;
  /** Containing folder, `null` at the top level. */
  parentId: string | null;
  fileType?: FileKind;
  mimeType?: string;
  /** Bytes, files only. */
  size?: number;
  modifiedAt: number;
  openedAt: number | null;
  isFavorite: boolean;
  deletedAt: number | null;
}

export type WorkspaceSection = "workspace" | "recents" | "favorites" | "trash";
