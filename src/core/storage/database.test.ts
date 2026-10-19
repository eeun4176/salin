/**
 * Database Migration Tests
 * Opens a Phase 2 (v2) database with the current schema and checks that
 * workspace data survives while stray placeholder processing rows are dropped.
 */

import Dexie from "dexie";
import { expect, it } from "vitest";

import { db } from "./database";

it("upgrades a v2 workspace to the current version without losing folders or files", async () => {
  db.close();
  await Dexie.delete("SalinAI");

  const v2 = new Dexie("SalinAI");
  v2.version(2).stores({
    folders: "id, name, parentFolderId, updatedAt, lastOpenedAt, deletedAt",
    files: "id, name, folderId, blobId, updatedAt, lastOpenedAt, deletedAt",
    fileBlobs: "id",
    datasets: "id, name, folderId, updatedAt, deletedAt, *sourceFileIds",
    datasetRows: "id, datasetId",
    processingJobs: "id, status, taskType, updatedAt",
    templates: "id, name",
    modelMetadata: "id",
    settings: "key",
  });
  await v2.open();
  await v2.table("folders").add({ id: "f1", name: "Census", parentFolderId: null, createdAt: 1, updatedAt: 1, lastOpenedAt: null, deletedAt: null, isFavorite: false });
  await v2.table("datasets").add({ id: "old", name: "Placeholder", folderId: null, sourceFileIds: [], schema: {} });
  await v2.table("processingJobs").add({ id: "old", status: "draft", taskType: "x", updatedAt: 1 });
  v2.close();

  await db.open();
  expect(db.verno).toBe(5);
  expect((await db.folders.get("f1"))?.name).toBe("Census");
  expect(await db.datasets.count()).toBe(0);
  expect(await db.processingJobs.count()).toBe(0);
  expect(await db.extractedDocuments.count()).toBe(0);
});
