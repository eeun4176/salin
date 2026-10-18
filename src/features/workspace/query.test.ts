/**
 * Workspace Query Tests
 * Folder scoping, hidden contents of trashed folders, search across folders,
 * section rules (Recents/Favorites/Trash) and sorting.
 */

import { describe, expect, it } from "vitest";

import type { Folder } from "@/types/domain";

import { folderPath, hiddenFolderIds } from "./mappers";
import { selectItems, type QueryOptions } from "./query";
import type { WorkspaceItem } from "./types";

const NOW = new Date(2026, 9, 18, 12).getTime();

function item(id: string, patch: Partial<WorkspaceItem> = {}): WorkspaceItem {
  return {
    id,
    kind: "file",
    name: id,
    parentId: null,
    fileType: "pdf",
    modifiedAt: NOW,
    openedAt: null,
    isFavorite: false,
    deletedAt: null,
    ...patch,
  };
}

function folder(id: string, parentFolderId: string | null, deletedAt: number | null = null): Folder {
  return { id, name: id, parentFolderId, createdAt: NOW, updatedAt: NOW, lastOpenedAt: null, deletedAt, isFavorite: false };
}

const base: QueryOptions = {
  section: "workspace",
  query: "",
  type: "any",
  modified: "any",
  sort: { key: "name", direction: "asc", foldersFirst: true },
  now: NOW,
};

const ids = (items: WorkspaceItem[]) => items.map((i) => i.id);

describe("workspace queries", () => {
  const items = [
    item("Projects", { kind: "folder", fileType: undefined }),
    item("Archive", { kind: "folder", fileType: undefined, deletedAt: NOW }),
    item("top.pdf"),
    item("inside.pdf", { parentId: "Projects", isFavorite: true, openedAt: NOW - 1000 }),
    item("buried.pdf", { parentId: "Archive", isFavorite: true }),
    item("gone.pdf", { deletedAt: NOW - 5000 }),
  ];
  const hidden = hiddenFolderIds([folder("Projects", null), folder("Archive", null, NOW)]);

  it("shows only the open folder's live contents, folders first", () => {
    expect(ids(selectItems(items, { ...base, hiddenFolderIds: hidden }))).toEqual(["Projects", "top.pdf"]);
    expect(ids(selectItems(items, { ...base, folderId: "Projects", hiddenFolderIds: hidden }))).toEqual(["inside.pdf"]);
  });

  it("searches every folder but never inside trashed ones", () => {
    expect(ids(selectItems(items, { ...base, query: ".PDF", hiddenFolderIds: hidden }))).toEqual(["inside.pdf", "top.pdf"]);
  });

  it("keeps favorites and recents to live items", () => {
    expect(ids(selectItems(items, { ...base, section: "favorites", hiddenFolderIds: hidden }))).toEqual(["inside.pdf"]);
    expect(ids(selectItems(items, { ...base, section: "recents", hiddenFolderIds: hidden }))).toEqual(["top.pdf", "inside.pdf"]);
  });

  it("lists only explicitly trashed items in Trash", () => {
    const trash = selectItems(items, { ...base, section: "trash", sort: { key: "modified", direction: "desc", foldersFirst: false } });
    expect(ids(trash)).toEqual(["Archive", "gone.pdf"]);
  });

  it("hides folders under a trashed ancestor and builds breadcrumb paths", () => {
    const folders = [folder("a", null), folder("b", "a", NOW), folder("c", "b"), folder("d", "missing")];
    expect([...hiddenFolderIds(folders)].sort()).toEqual(["b", "c", "d"]);
    const byId = new Map(folders.map((f) => [f.id, f]));
    expect(folderPath("c", byId).map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
});
