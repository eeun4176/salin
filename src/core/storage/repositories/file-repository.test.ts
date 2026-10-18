/**
 * File Repository Tests
 * Atomic imports (metadata + bytes + folder paths), transaction rollback on
 * failure, reading bytes back, copies that share bytes, moves, Trash/restore
 * and permanent deletion with blob clean-up.
 */

import { describe, expect, it, vi } from "vitest";

import { db } from "@/core/storage/database";
import { counts, entry } from "@/test/fixtures";

import {
  deleteFileForever,
  duplicateFile,
  getFileWithBlob,
  importFiles,
  markFileOpened,
  moveFile,
  renameFile,
  restoreFile,
  setFileFavorite,
  trashFile,
} from "./file-repository";
import { createFolder, trashFolder } from "./folder-repository";
import { emptyTrash } from "./workspace-repository";

describe("file repository", () => {
  it("imports metadata and bytes together, with a SHA-256 checksum", async () => {
    const { files } = await importFiles([entry("report.pdf", "hello")], null);

    expect(files).toHaveLength(1);
    const [file] = files;
    expect(file).toMatchObject({ name: "report.pdf", kind: "pdf", size: 5, folderId: null, source: "import" });
    const stored = await db.fileBlobs.get(file.blobId);
    expect(stored?.checksum).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    const { blob } = await getFileWithBlob(file.id);
    expect(await blob.text()).toBe("hello");
  });

  it("recreates uploaded folder paths and never merges into existing folders", async () => {
    await createFolder("Census", null);
    const { files, folders } = await importFiles(
      [entry("a.pdf", "1", "Census/Batch 1"), entry("b.pdf", "2", "Census/Batch 1"), entry("c.csv", "3", "Census")],
      null,
    );

    expect(folders.map((f) => f.name)).toEqual(["Census (2)", "Batch 1"]);
    const [top, batch] = folders;
    expect(batch.parentFolderId).toBe(top.id);
    expect(files.map((f) => [f.name, f.folderId])).toEqual([
      ["a.pdf", batch.id],
      ["b.pdf", batch.id],
      ["c.csv", top.id],
    ]);
  });

  it("de-duplicates file names inside a folder", async () => {
    const { files } = await importFiles([entry("scan.jpg"), entry("scan.jpg"), entry("SCAN.jpg")], null);
    expect(files.map((f) => f.name)).toEqual(["scan.jpg", "scan (2).jpg", "SCAN (3).jpg"]);
  });

  it("rolls back the whole import when a write fails part-way", async () => {
    const add = db.files.add.bind(db.files);
    let calls = 0;
    vi.spyOn(db.files, "add").mockImplementation((...args: Parameters<typeof add>) => {
      calls += 1;
      if (calls === 2) throw new Error("disk failure");
      return add(...args);
    });

    await expect(importFiles([entry("a.pdf"), entry("b.pdf")], null)).rejects.toThrow("disk failure");
    expect(await counts()).toEqual({ folders: 0, files: 0, blobs: 0 });
  });

  it("rejects imports into a trashed folder without writing anything", async () => {
    const folder = await createFolder("Old", null);
    await trashFolder(folder.id);
    await expect(importFiles([entry("a.pdf", "x", "Sub")], folder.id)).rejects.toThrow("in Trash");
    expect(await counts()).toEqual({ folders: 1, files: 0, blobs: 0 });
  });

  it("copies share bytes; bytes are deleted only with the last file using them", async () => {
    const [original] = (await importFiles([entry("form.pdf")], null)).files;
    const copy = await duplicateFile(original.id);
    expect(copy.name).toBe("Copy of form.pdf");
    expect(copy.blobId).toBe(original.blobId);

    await deleteFileForever(original.id);
    expect(await counts()).toEqual({ folders: 0, files: 1, blobs: 1 });
    await deleteFileForever(copy.id);
    expect(await counts()).toEqual({ folders: 0, files: 0, blobs: 0 });
  });

  it("renames, moves, favorites and records opens", async () => {
    const folder = await createFolder("Target", null);
    const [a, b] = (await importFiles([entry("a.pdf"), entry("b.pdf")], null)).files;
    await importFiles([entry("a.pdf")], folder.id);

    await expect(renameFile(b.id, "A.PDF")).rejects.toThrow("already in this folder");
    await renameFile(b.id, "Summary.pdf");
    await moveFile(a.id, folder.id);
    await setFileFavorite(a.id, true);
    await markFileOpened(a.id);

    const moved = await db.files.get(a.id);
    expect(moved).toMatchObject({ folderId: folder.id, name: "a (2).pdf", isFavorite: true });
    expect(moved?.lastOpenedAt).toEqual(expect.any(Number));
    expect((await db.files.get(b.id))?.name).toBe("Summary.pdf");
  });

  it("restores a file to the top level when its folder is in Trash", async () => {
    const folder = await createFolder("Folder", null);
    const [file] = (await importFiles([entry("x.csv")], folder.id)).files;
    await trashFile(file.id);
    await trashFolder(folder.id);

    await restoreFile(file.id);
    expect(await db.files.get(file.id)).toMatchObject({ deletedAt: null, folderId: null });
  });

  it("empties Trash, including files inside trashed folders", async () => {
    const folder = await createFolder("Folder", null);
    await importFiles([entry("inside.pdf")], folder.id);
    const [loose] = (await importFiles([entry("loose.pdf"), entry("kept.pdf")], null)).files;
    await trashFolder(folder.id);
    await trashFile(loose.id);

    expect(await emptyTrash()).toEqual({ folders: 1, files: 2 });
    expect(await counts()).toEqual({ folders: 0, files: 1, blobs: 1 });
  });
});
