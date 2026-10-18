/**
 * Workspace Store
 * Read-side state for the workspace UI: the current folder/file metadata from
 * IndexedDB (kept live with a Dexie `liveQuery`, so changes from any tab show
 * up automatically), mapped view items, and the loading/error status. Writes
 * go through `features/workspace/workspace-actions.ts`, never through here.
 */

import { liveQuery, type Subscription } from "dexie";
import { create } from "zustand";

import { loadWorkspace, type WorkspaceSnapshot } from "@/core/storage/repositories/workspace-repository";
import { fileToItem, folderToItem, hiddenFolderIds } from "@/features/workspace/mappers";
import type { WorkspaceItem } from "@/features/workspace/types";
import type { Folder, WorkspaceFile } from "@/types/domain";

export type WorkspaceStatus = "loading" | "ready" | "error";

interface WorkspaceState {
  status: WorkspaceStatus;
  error: string | null;
  folders: Folder[];
  files: WorkspaceFile[];
  folderById: Map<string, Folder>;
  /** Folders in Trash or inside a trashed folder. */
  hiddenFolderIds: Set<string>;
  items: WorkspaceItem[];
}

export const useWorkspaceStore = create<WorkspaceState>()(() => ({
  status: "loading",
  error: null,
  folders: [],
  files: [],
  folderById: new Map(),
  hiddenFolderIds: new Set(),
  items: [],
}));

function toState({ folders, files }: WorkspaceSnapshot): Partial<WorkspaceState> {
  return {
    status: "ready",
    error: null,
    folders,
    files,
    folderById: new Map(folders.map((f) => [f.id, f])),
    hiddenFolderIds: hiddenFolderIds(folders),
    items: [...folders.map(folderToItem), ...files.map(fileToItem)],
  };
}

let subscription: Subscription | null = null;

/** Starts (or restarts, after an error) live syncing of the workspace from IndexedDB. */
export function startWorkspaceSync() {
  subscription?.unsubscribe();
  if (useWorkspaceStore.getState().status === "error") useWorkspaceStore.setState({ status: "loading", error: null });
  subscription = liveQuery(loadWorkspace).subscribe({
    next: (snapshot) => useWorkspaceStore.setState(toState(snapshot)),
    error: (error: unknown) => {
      console.error("Workspace storage failed", error);
      useWorkspaceStore.setState({
        status: "error",
        error:
          "Salin couldn't open its storage on this device. Private browsing or blocked site data can cause this — allow site data and try again.",
      });
    },
  });
}

export function stopWorkspaceSync() {
  subscription?.unsubscribe();
  subscription = null;
}
