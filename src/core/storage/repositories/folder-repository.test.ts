/**
 * Folder Repository Tests
 * Create/rename validation, nested moves (including cycle protection),
 * deep copies, Trash/restore rules and permanent deletion of folder trees.
 */

import { describe, expect, it } from "vitest";

import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import { counts, entry } from "@/test/fixtures";

import { importFiles } from "./file-repository";
import {
  createFolder,
  deleteFolderForever,
  duplicateFolder,
  moveFolder,
  renameFolder,
  restoreFolder,
  trashFolder,
} from "./folder-repository";

describe("folder repository", () => {
  it("creates nested folders and validates names per parent", async () => {
    const census = await createFolder("Census", null);
    const batch = await createFolder("  Batch   1 ", census.id);

    expect(batch.name).toBe("Batch 1");
    expect(batch.parentFolderId).toBe(census.id);
    await expect(createFolder("census", null)).rejects.toThrow("already in this folder");
    await expect(createFolder("Census", census.id)).resolves.toMatchObject({ name: "Census" });
    await expect(createFolder("a/b", null)).rejects.toBeInstanceOf(WorkspaceError);
    await expect(createFolder("   ", null)).rejects.toThrow("Enter a name");
  });

  it("refuses to create inside a missing or trashed folder", async () => {
    const parent = await createFolder("Parent", null);
    await trashFolder(parent.id);
    await expect(createFolder("Child", parent.id)).rejects.toThrow("no longer exists or is in Trash");
    await expect(createFolder("Child", "missing")).rejects.toThrow("no longer exists or is in Trash");
  });

  it("renames with duplicate checks that ignore the folder itself", async () => {
    const a = await createFolder("Alpha", null);
    await createFolder("Beta", null);
    await renameFolder(a.id, "ALPHA");
    expect((await db.folders.get(a.id))?.name).toBe("ALPHA");
    await expect(renameFolder(a.id, "beta")).rejects.toThrow("already in this folder");
  });

  it("moves folders but never into themselves or their subfolders", async () => {
    const a = await createFolder("A", null);
    const b = await createFolder("B", a.id);
    const c = await createFolder("C", b.id);

    await expect(moveFolder(a.id, a.id)).rejects.toThrow("into itself");
    await expect(moveFolder(a.id, c.id)).rejects.toThrow("into itself");

    await moveFolder(c.id, null);
    expect((await db.folders.get(c.id))?.parentFolderId).toBeNull();
  });

  it("renames a moved folder that collides with a sibling", async () => {
    const target = await createFolder("Target", null);
    await createFolder("Reports", target.id);
    const other = await createFolder("Reports", null);
    await moveFolder(other.id, target.id);
    expect((await db.folders.get(other.id))?.name).toBe("Reports (2)");
  });

  it("deep-copies live contents, sharing file bytes and skipping trashed items", async () => {
    const root = await createFolder("Census", null);
    const sub = await createFolder("Batch", root.id);
    const trashed = await createFolder("Old", root.id);
    await importFiles([entry("a.pdf"), entry("b.csv", "x", "Inner")], sub.id);
    await trashFolder(trashed.id);

    const copy = await duplicateFolder(root.id);

    expect(copy.name).toBe("Copy of Census");
    const copiedFolders = [copy];
    for (let i = 0; i < copiedFolders.length; i++) {
      copiedFolders.push(...(await db.folders.where("parentFolderId").equals(copiedFolders[i].id).toArray()));
    }
    expect(copiedFolders.map((f) => f.name).sort()).toEqual(["Batch", "Copy of Census", "Inner"]);
    const totals = await counts();
    expect(totals.files).toBe(4);
    expect(totals.blobs).toBe(2); // copies reuse the original bytes
  });

  it("restores to the top level when the old parent is in Trash", async () => {
    const parent = await createFolder("Parent", null);
    const child = await createFolder("Child", parent.id);
    await trashFolder(child.id);
    await trashFolder(parent.id);

    await restoreFolder(child.id);
    const restored = await db.folders.get(child.id);
    expect(restored?.deletedAt).toBeNull();
    expect(restored?.parentFolderId).toBeNull();
  });

  it("deletes a folder tree forever, keeping bytes still used elsewhere", async () => {
    const keep = await createFolder("Keep", null);
    const doomed = await createFolder("Doomed", null);
    const inner = await createFolder("Inner", doomed.id);
    await importFiles([entry("x.pdf"), entry("y.png")], inner.id);
    const copy = await duplicateFolder(doomed.id);
    await moveFolder(copy.id, keep.id);

    await deleteFolderForever(doomed.id);

    expect(await db.folders.get(doomed.id)).toBeUndefined();
    expect(await db.folders.get(inner.id)).toBeUndefined();
    expect(await counts()).toEqual({ folders: 3, files: 2, blobs: 2 });

    await deleteFolderForever(keep.id);
    expect(await counts()).toEqual({ folders: 0, files: 0, blobs: 0 });
  });
});
