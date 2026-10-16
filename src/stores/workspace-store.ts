import { create } from "zustand";

import { createSampleItems } from "@/features/workspace/mock-data";
import type { WorkspaceItem } from "@/features/workspace/types";

interface WorkspaceState {
  items: WorkspaceItem[];
  createFolder: (name: string) => void;
  rename: (id: string, name: string) => void;
  duplicate: (id: string) => void;
  toggleFavorite: (id: string) => void;
  moveToTrash: (id: string) => void;
  restore: (id: string) => void;
  deleteForever: (id: string) => void;
  emptyTrash: () => void;
  /** Replaces the whole workspace (restore from backup). */
  replaceAll: (items: WorkspaceItem[]) => void;
}

const patchItem = (items: WorkspaceItem[], id: string, patch: (item: WorkspaceItem) => Partial<WorkspaceItem>) =>
  items.map((item) => (item.id === id ? { ...item, ...patch(item) } : item));

/** In-memory workspace for the Phase 1 shell; swapped for Dexie repositories in Phase 2. */
export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  items: createSampleItems(),
  createFolder: (name) =>
    set((s) => ({
      items: [
        { id: crypto.randomUUID(), kind: "folder", name, modifiedAt: Date.now(), openedAt: null, isFavorite: false, deletedAt: null },
        ...s.items,
      ],
    })),
  rename: (id, name) => set((s) => ({ items: patchItem(s.items, id, () => ({ name, modifiedAt: Date.now() })) })),
  duplicate: (id) =>
    set((s) => {
      const index = s.items.findIndex((item) => item.id === id);
      if (index === -1) return s;
      const source = s.items[index];
      const copy: WorkspaceItem = {
        ...source,
        id: crypto.randomUUID(),
        name: `Copy of ${source.name}`,
        modifiedAt: Date.now(),
        isFavorite: false,
      };
      return { items: [...s.items.slice(0, index + 1), copy, ...s.items.slice(index + 1)] };
    }),
  toggleFavorite: (id) => set((s) => ({ items: patchItem(s.items, id, (item) => ({ isFavorite: !item.isFavorite })) })),
  moveToTrash: (id) => set((s) => ({ items: patchItem(s.items, id, () => ({ deletedAt: Date.now() })) })),
  restore: (id) => set((s) => ({ items: patchItem(s.items, id, () => ({ deletedAt: null })) })),
  deleteForever: (id) => set((s) => ({ items: s.items.filter((item) => item.id !== id) })),
  emptyTrash: () => set((s) => ({ items: s.items.filter((item) => item.deletedAt === null) })),
  replaceAll: (items) => set({ items }),
}));
