/**
 * Processing Repository Tests
 * Job creation, allowed status transitions, progress/heartbeat, recovery of
 * jobs left running by a closed tab, and the per-document extraction cache.
 */

import { describe, expect, it } from "vitest";

import { db } from "@/core/storage/database";
import { entry } from "@/test/fixtures";

import { deleteFileForever, duplicateFile, importFiles, trashFile } from "./file-repository";
import {
  cancelJob,
  completeJob,
  createJob,
  deleteJob,
  failInterruptedJobs,
  failJob,
  findExtraction,
  getJobOrThrow,
  listJobsForFile,
  reportJobProgress,
  requeueJob,
  saveExtraction,
  startJob,
} from "./processing.repository";

async function twoFiles() {
  const { files } = await importFiles([entry("a.csv", "x"), entry("b.csv", "y")], null);
  return files;
}

const extraction = (blobId: string, fileId: string, parserVersion = 1) => ({
  blobId,
  fileId,
  kind: "csv" as const,
  parserId: "csv",
  parserVersion,
  pages: [],
  tables: [],
  warnings: [],
});

describe("processing jobs", () => {
  it("queues a job for live files, without duplicates", async () => {
    const [a, b] = await twoFiles();
    const job = await createJob([a.id, b.id, a.id], { datasetName: "Census" });
    expect(job).toMatchObject({ sourceFileIds: [a.id, b.id], status: "queued", progress: 0, error: null, datasetId: null });
    expect((await listJobsForFile(b.id)).map((j) => j.id)).toEqual([job.id]);
  });

  it("refuses empty, missing or trashed sources", async () => {
    const [a] = await twoFiles();
    await expect(createJob([])).rejects.toThrow("at least one document");
    await expect(createJob(["missing"])).rejects.toThrow("no longer exists");
    await trashFile(a.id);
    await expect(createJob([a.id])).rejects.toThrow("in Trash");
    expect(await db.processingJobs.count()).toBe(0);
  });

  it("moves through the lifecycle and blocks invalid transitions", async () => {
    const [a] = await twoFiles();
    const { id } = await createJob([a.id]);

    await expect(completeJob(id, "d1")).rejects.toThrow("queued job can't be marked completed");
    expect(await startJob(id)).toMatchObject({ status: "running", stage: "extracting" });
    expect(await reportJobProgress(id, "structuring", 1.4)).toBe(true);
    expect(await getJobOrThrow(id)).toMatchObject({ stage: "structuring", progress: 1 });

    const failed = await failJob(id, { code: "parse-failed", message: "Bad file", fileId: a.id });
    expect(failed).toMatchObject({ status: "failed", stage: null, error: { code: "parse-failed" } });
    expect(failed.finishedAt).not.toBeNull();
    expect(await reportJobProgress(id, "extracting", 0.5)).toBe(false);

    expect(await requeueJob(id)).toMatchObject({ status: "queued", error: null, finishedAt: null });
    await startJob(id);
    await expect(deleteJob(id)).rejects.toThrow("Cancel this job");
    expect(await completeJob(id, "d1")).toMatchObject({ status: "completed", progress: 1, datasetId: "d1" });
    await expect(cancelJob(id)).rejects.toThrow("completed job can't be marked cancelled");

    await deleteJob(id);
    expect(await db.processingJobs.count()).toBe(0);
  });

  it("marks jobs whose heartbeat stopped as interrupted", async () => {
    const [a, b] = await twoFiles();
    const stale = await createJob([a.id]);
    const fresh = await createJob([b.id]);
    await startJob(stale.id);
    await startJob(fresh.id);
    await db.processingJobs.update(stale.id, { updatedAt: Date.now() - 10 * 60 * 1000 });

    expect(await failInterruptedJobs()).toBe(1);
    expect(await getJobOrThrow(stale.id)).toMatchObject({ status: "failed", error: { code: "interrupted" } });
    expect((await getJobOrThrow(fresh.id)).status).toBe("running");
  });
});

describe("extraction cache", () => {
  it("finds results by bytes and parser version, replacing older versions", async () => {
    const [a] = await twoFiles();
    await saveExtraction(extraction(a.blobId, a.id, 1));
    expect(await findExtraction(a.blobId, "csv", 1)).toBeDefined();
    expect(await findExtraction(a.blobId, "csv", 2)).toBeUndefined();
    expect(await findExtraction(a.blobId, "pdf", 1)).toBeUndefined();

    await saveExtraction(extraction(a.blobId, a.id, 2));
    expect(await db.extractedDocuments.count()).toBe(1);
    expect((await findExtraction(a.blobId, "csv", 2))?.parserVersion).toBe(2);
  });

  it("is deleted with the last file that uses those bytes", async () => {
    const [a] = await twoFiles();
    const copy = await duplicateFile(a.id);
    await saveExtraction(extraction(a.blobId, a.id));

    await deleteFileForever(a.id);
    expect(await db.extractedDocuments.count()).toBe(1); // the copy still shares the bytes
    await deleteFileForever(copy.id);
    expect(await db.extractedDocuments.count()).toBe(0);
  });
});
