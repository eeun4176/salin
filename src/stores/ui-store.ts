import { create } from "zustand";

export type ViewMode = "grid" | "list";
export type TypeFilter = "any" | "folders" | "pdf" | "spreadsheets" | "images";
export type ModifiedFilter = "any" | "today" | "7d" | "30d" | "year" | "lastYear";

export interface SortState {
  key: "name" | "modified";
  direction: "asc" | "desc";
  foldersFirst: boolean;
}

interface UiState {
  viewMode: ViewMode;
  query: string;
  type: TypeFilter;
  modified: ModifiedFilter;
  sort: SortState;
  /** Trash defaults to newest-trashed first, independent of the workspace sort. */
  trashSort: SortState;
  setViewMode: (mode: ViewMode) => void;
  setQuery: (query: string) => void;
  setType: (type: TypeFilter) => void;
  setModified: (modified: ModifiedFilter) => void;
  setSort: (sort: Partial<SortState>) => void;
  setTrashSort: (sort: Partial<SortState>) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  viewMode: "grid",
  query: "",
  type: "any",
  modified: "any",
  sort: { key: "name", direction: "asc", foldersFirst: true },
  trashSort: { key: "modified", direction: "desc", foldersFirst: false },
  setViewMode: (viewMode) => set({ viewMode }),
  setQuery: (query) => set({ query }),
  setType: (type) => set({ type }),
  setModified: (modified) => set({ modified }),
  setSort: (sort) => set((s) => ({ sort: { ...s.sort, ...sort } })),
  setTrashSort: (sort) => set((s) => ({ trashSort: { ...s.trashSort, ...sort } })),
}));
