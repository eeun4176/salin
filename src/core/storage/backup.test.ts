/**
 * Backup & Restore Tests
 * Round-trips a workspace through a backup archive, and checks that damaged,
 * tampered, outdated or inconsistent archives are rejected and that a failed
 * restore leaves the existing workspace untouched. Datasets travel with the
 * backup; job history and extraction caches are rebuilt, not restored.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/core/storage/database";
import { content, counts, entry } from "@/test/fixtures";

import { BACKUP_VERSION, createBackupArchive, readBackupArchive, restoreBackup } from "./backup";
import { createDataset } from "./repositories/dataset.repository";
import { importFiles } from "./repositories/file-repository";
import { createFolder, trashFolder } from "./repositories/folder-repository";
import { createJob, saveExtraction } from "./repositories/processing.repository";
import { clearWorkspace } from "./repositories/workspace-repository";

async function seed() {
  const census = await createFolder("Census", null);
  const old = await createFolder("Old", census.id);
  await importFiles([entry("form.pdf", "pdf bytes"), entry("rows.csv", "a,b\n1,2", "Batch")], census.id);
  await importFiles([entry("photo.jpg", "jpg bytes")], null);
  await trashFolder(old.id);
}

/** Unzips an archive, lets the test edit its entries, and zips it again. */
async function tamper(archive: Blob, edit: (entries: Record<string, Uint8Array>) => void) {
  const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  edit(entries);
  return new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>]);
}

function editManifest(entries: Record<string, Uint8Array>, edit: (manifest: Record<string, unknown>) => void) {
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  edit(manifest);
  entries["manifest.json"] = strToU8(JSON.stringify(manifest));
}

describe("workspace backup", () => {
  it("round-trips every folder, file record and document byte", async () => {
    await seed();
    const before = {
      folders: await db.folders.orderBy("id").toArray(),
      files: await db.files.orderBy("id").toArray(),
    };

    const archive = await createBackupArchive();
    await clearWorkspace();
    expect(await counts()).toEqual({ folders: 0, files: 0, blobs: 0 });

    const parsed = await readBackupArchive(archive);
    expect(parsed).toMatchObject({ folders: expect.any(Array), files: expect.any(Array) });
    await restoreBackup(parsed);

    expect(await db.folders.orderBy("id").toArray()).toEqual(before.folders);
    expect(await db.files.orderBy("id").toArray()).toEqual(before.files);
    const form = before.files.find((f) => f.name === "form.pdf")!;
    expect(await (await db.fileBlobs.get(form.blobId))!.blob.text()).toBe("pdf bytes");
  });

  it("round-trips datasets and drops derived processing data", async () => {
    await seed();
    const file = (await db.files.toArray())[0];
    const dataset = await createDataset({
      name: "Pets",
      sourceFileIds: [file.id],
      content: content(["Name", "Pet"], [["Ana", "Bantay"], ["Ben", null]]),
    });
    await createJob([file.id]);
    await saveExtraction({ blobId: file.blobId, fileId: file.id, kind: file.kind, parserId: "p", parserVersion: 1, pages: [], tables: [], warnings: [] });
    const rows = await db.datasetRows.orderBy("id").toArray();

    const parsed = await readBackupArchive(await createBackupArchive());
    await restoreBackup(parsed);

    expect(await db.datasets.toArray()).toEqual([dataset]);
    expect(await db.datasetRows.orderBy("id").toArray()).toEqual(rows);
    expect(await db.processingJobs.count()).toBe(0);
    expect(await db.extractedDocuments.count()).toBe(0);
  });

  it("restores version 2 backups, which have no datasets", async () => {
    await seed();
    const v2 = await tamper(await createBackupArchive(), (entries) =>
      editManifest(entries, (m) => {
        m.version = 2;
        delete m.datasets;
        delete m.datasetRows;
      }),
    );
    const parsed = await readBackupArchive(v2);
    expect(parsed.datasets).toEqual([]);
    await restoreBackup(parsed);
    expect(await counts()).toEqual({ folders: 3, files: 3, blobs: 3 });
  });

  it("rejects datasets with orphaned, unknown-column or missing rows", async () => {
    await seed();
    await createDataset({ name: "Pets", sourceFileIds: [], content: content(["Name"], [["Ana"], ["Ben"]]) });
    const archive = await createBackupArchive();
    type Manifest = { datasetRows: { datasetId: string; values: Record<string, unknown> }[] };

    const orphan = await tamper(archive, (entries) =>
      editManifest(entries, (m) => ((m as unknown as Manifest).datasetRows[0].datasetId = "nope")),
    );
    await expect(readBackupArchive(orphan)).rejects.toThrow("don't belong to any dataset");

    const unknownColumn = await tamper(archive, (entries) =>
      editManifest(entries, (m) => ((m as unknown as Manifest).datasetRows[0].values.ghost = "x")),
    );
    await expect(readBackupArchive(unknownColumn)).rejects.toThrow("unknown columns");

    const missingRow = await tamper(archive, (entries) =>
      editManifest(entries, (m) => (m as unknown as Manifest).datasetRows.pop()),
    );
    await expect(readBackupArchive(missingRow)).rejects.toThrow("missing from the backup");
  });

  it("rejects archives whose document bytes were altered", async () => {
    await seed();
    const archive = await tamper(await createBackupArchive(), (entries) => {
      const path = Object.keys(entries).find((p) => p.startsWith("blobs/"))!;
      entries[path] = entries[path].map((b) => b ^ 1); // same size, different bytes
    });
    await expect(readBackupArchive(archive)).rejects.toThrow("checksum mismatch");
  });

  it("rejects archives with missing documents, broken references or duplicate ids", async () => {
    await seed();
    const archive = await createBackupArchive();

    const missingBlob = await tamper(archive, (entries) => {
      delete entries[Object.keys(entries).find((p) => p.startsWith("blobs/"))!];
    });
    await expect(readBackupArchive(missingBlob)).rejects.toThrow("missing");

    const orphanFile = await tamper(archive, (entries) =>
      editManifest(entries, (m) => ((m.files as { folderId: string }[])[0].folderId = "nope")),
    );
    await expect(readBackupArchive(orphanFile)).rejects.toThrow("isn't in the backup");

    const duplicate = await tamper(archive, (entries) =>
      editManifest(entries, (m) => (m.folders = [...(m.folders as unknown[]), (m.folders as unknown[])[0]])),
    );
    await expect(readBackupArchive(duplicate)).rejects.toThrow("same folder twice");

    const cycle = await tamper(archive, (entries) =>
      editManifest(entries, (m) => {
        const [a, b] = m.folders as { id: string; parentFolderId: string | null }[];
        a.parentFolderId = b.id;
        b.parentFolderId = a.id;
      }),
    );
    await expect(readBackupArchive(cycle)).rejects.toThrow("loops back");
  });

  it("rejects other formats and versions with a clear reason", async () => {
    const phase1 = new Blob([JSON.stringify({ app: "salin", version: 1, items: [] })]);
    await expect(readBackupArchive(phase1)).rejects.toThrow("Phase 1 preview backup");
    await expect(readBackupArchive(new Blob(["not a zip"]))).rejects.toThrow("isn't a Salin backup");
    await expect(readBackupArchive(new Blob([]))).rejects.toThrow("empty");

    const newer = await tamper(await createBackupArchive(), (entries) =>
      editManifest(entries, (m) => (m.version = BACKUP_VERSION + 1)),
    );
    await expect(readBackupArchive(newer)).rejects.toThrow("newer version");
  });

  it("leaves the current workspace untouched when a restore fails part-way", async () => {
    await seed();
    const parsed = await readBackupArchive(await createBackupArchive());
    await clearWorkspace();
    await createFolder("Current work", null);
    await importFiles([entry("current.pdf")], null);

    vi.spyOn(db.files, "bulkAdd").mockImplementation(() => {
      throw new Error("storage full");
    });
    await expect(restoreBackup(parsed)).rejects.toThrow("storage full");

    expect(await counts()).toEqual({ folders: 1, files: 1, blobs: 1 });
    expect((await db.folders.toArray())[0].name).toBe("Current work");
  });
});
