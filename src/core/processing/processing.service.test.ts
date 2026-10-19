/**
 * Processing Service Tests
 * Runs jobs end to end with in-memory parsers and the network disabled:
 * extraction, caching, merging into one dataset, every failure code,
 * cancellation (here and from another tab), retry, and rollback of a failed
 * save.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/core/storage/database";
import { getDatasetRows } from "@/core/storage/repositories/dataset.repository";
import { deleteFileForever, duplicateFile, importFiles } from "@/core/storage/repositories/file-repository";
import { cancelJob, createJob } from "@/core/storage/repositories/processing.repository";
import { entry } from "@/test/fixtures";
import { ProcessingError } from "./processing-errors";
import { createProcessingService, type DocumentParser, type ProgressUpdate } from "./processing.service";

/** Minimal CSV parser: one table, comma-separated, no quoting. */
function csvParser(overrides: Partial<DocumentParser> = {}): DocumentParser {
  return {
    id: "test-csv",
    version: 1,
    kinds: ["csv"],
    parse: vi.fn<DocumentParser["parse"]>(async ({ blob }, { onProgress }) => {
      const rows = (await blob.text()).split("\n").map((line) => line.split(","));
      onProgress(1);
      return { pages: [], tables: [{ name: "Sheet1", sheet: null, page: null, rows, firstRowNumber: 1 }], warnings: [] };
    }),
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function importCsv(name = "pets.csv", text = "Name,Pet\nAna,Bantay\nBen,Mingming") {
  return (await importFiles([entry(name, text)], null)).files[0];
}

beforeEach(() => {
  // Processing must never touch the network.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network used"))));
  return () => vi.unstubAllGlobals();
});

describe("processing service", () => {
  it("uses the built-in parsers by default and types the columns", async () => {
    const file = await importCsv("visits.csv", "Name,Visits,Date\nAna,3,10/18/2026\nBen,12,10/19/2026");
    const { dataset } = await createProcessingService().process([file.id]);
    expect(dataset?.columns.map((c) => [c.name, c.type])).toEqual([
      ["Name", "text"],
      ["Visits", "number"],
      ["Date", "date"],
    ]);
    const rows = await getDatasetRows(dataset!.id);
    expect(rows.map((r) => Object.values(r.values))).toEqual([
      ["Ana", 3, "2026-10-18"],
      ["Ben", 12, "2026-10-19"],
    ]);
  });

  it("turns a document into a saved dataset, entirely locally", async () => {
    const file = await importCsv();
    const service = createProcessingService({ parsers: [csvParser()] });
    const updates: ProgressUpdate[] = [];

    const { job, dataset } = await service.process([file.id], undefined, { onProgress: (u) => updates.push(u) });

    expect(job).toMatchObject({ status: "completed", progress: 1, datasetId: dataset?.id, error: null });
    expect(dataset).toMatchObject({ name: "pets", rowCount: 2, sourceFileIds: [file.id], jobId: job.id });
    expect(dataset?.columns.map((c) => c.name)).toEqual(["Name", "Pet"]);
    expect(await db.extractedDocuments.where("blobId").equals(file.blobId).count()).toBe(1);

    expect(updates.map((u) => u.stage)).toEqual(["extracting", "extracting", "structuring", "saving", "saving"]);
    const progress = updates.map((u) => u.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("merges several documents into one dataset and honours a custom name", async () => {
    const a = await importCsv("a.csv", "Name,Pet\nAna,Bantay");
    const b = await importCsv("b.csv", "Name,Pet\nBen,Mingming");
    const service = createProcessingService({ parsers: [csvParser()] });

    expect((await service.process([a.id, b.id])).dataset).toMatchObject({ name: "a + 1 more", rowCount: 2 });
    expect((await service.process([a.id], { datasetName: "Pets" })).dataset?.name).toBe("Pets");
  });

  it("reuses the cached extraction for the same bytes", async () => {
    const file = await importCsv();
    const copy = await duplicateFile(file.id);
    const parser = csvParser();
    const service = createProcessingService({ parsers: [parser] });

    await service.process([file.id]);
    await service.process([copy.id]);
    expect(parser.parse).toHaveBeenCalledTimes(1);

    // A new parser version re-extracts.
    const upgraded = csvParser({ version: 2 });
    await createProcessingService({ parsers: [upgraded] }).process([file.id]);
    expect(upgraded.parse).toHaveBeenCalledTimes(1);
  });

  it("records a clear error for unsupported, unreadable, empty and missing documents", async () => {
    const pdf = (await importFiles([entry("form.pdf")], null)).files[0];
    const service = createProcessingService({ parsers: [csvParser()] });
    expect((await service.process([pdf.id])).job.error).toEqual({
      code: "unsupported-file",
      message: "Data can't be extracted from PDF files yet. Try a PDF, Excel, CSV or text file.",
      fileId: pdf.id,
    });

    const broken = await importCsv("broken.csv");
    const failing = createProcessingService({
      parsers: [csvParser({ parse: () => Promise.reject(new Error("bad bytes")) })],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await failing.process([broken.id])).job.error).toMatchObject({ code: "parse-failed", fileId: broken.id });

    const locked = createProcessingService({
      parsers: [csvParser({ parse: () => Promise.reject(new ProcessingError("parse-failed", "This PDF is password-protected.")) })],
    });
    expect((await locked.process([broken.id])).job.error).toEqual({
      code: "parse-failed",
      message: "This PDF is password-protected.",
      fileId: broken.id,
    });

    const blank = await importCsv("blank.csv", "");
    const empty = await service.process([blank.id]);
    expect(empty.job).toMatchObject({ status: "failed", error: { code: "no-content" } });
    expect(empty.dataset).toBeNull();

    const gone = await importCsv("gone.csv");
    const job = await createJob([gone.id]);
    await deleteFileForever(gone.id);
    expect((await service.run(job.id)).job.error).toMatchObject({ code: "file-missing", fileId: gone.id });

    expect(await db.datasets.count()).toBe(0);
  });

  it("cancels a running job without saving anything", async () => {
    const file = await importCsv();
    const started = deferred();
    const parser = csvParser({
      parse: (_input, { signal }) =>
        new Promise((_resolve, reject) => {
          started.resolve();
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    });
    const service = createProcessingService({ parsers: [parser] });
    const job = await service.queue([file.id]);

    const running = service.run(job.id);
    await started.promise;
    expect(service.isRunning(job.id)).toBe(true);
    await service.cancel(job.id);

    const result = await running;
    expect(result).toMatchObject({ job: { status: "cancelled", stage: null }, dataset: null });
    expect(service.isRunning(job.id)).toBe(false);
    expect(await db.extractedDocuments.count()).toBe(0);
    expect(await db.datasets.count()).toBe(0);
  });

  it("stops when the job is cancelled from another tab", async () => {
    const file = await importCsv();
    const started = deferred();
    const release = deferred();
    const base = csvParser();
    const service = createProcessingService({
      parsers: [csvParser({ parse: async (input, ctx) => (started.resolve(), await release.promise, base.parse(input, ctx)) })],
    });
    const job = await service.queue([file.id]);

    const running = service.run(job.id);
    await started.promise;
    await cancelJob(job.id); // what another tab's service.cancel() does
    release.resolve();

    expect(await running).toMatchObject({ job: { status: "cancelled" }, dataset: null });
    expect(await db.datasets.count()).toBe(0);
  });

  it("retries a failed job", async () => {
    const file = await importCsv();
    let fail = true;
    const base = csvParser();
    const service = createProcessingService({
      parsers: [csvParser({ parse: (input, ctx) => (fail ? Promise.reject(new ProcessingError("parse-failed", "Try again")) : base.parse(input, ctx)) })],
    });

    const first = await service.process([file.id]);
    expect(first.job.status).toBe("failed");
    fail = false;
    const second = await service.retry(first.job.id);
    expect(second.job).toMatchObject({ id: first.job.id, status: "completed", error: null });
    expect(second.dataset?.rowCount).toBe(2);
  });

  it("fails the job and keeps no partial dataset when saving runs out of space", async () => {
    const file = await importCsv();
    const service = createProcessingService({ parsers: [csvParser()] });
    vi.spyOn(db.datasetRows, "bulkAdd").mockImplementation(() => {
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    });

    const { job, dataset } = await service.process([file.id]);
    expect(job).toMatchObject({ status: "failed", datasetId: null, error: { code: "storage" } });
    expect(dataset).toBeNull();
    expect(await db.datasets.count()).toBe(0);
  });

  it("refuses to run the same job twice at once", async () => {
    const file = await importCsv();
    const service = createProcessingService({ parsers: [csvParser()] });
    const job = await service.queue([file.id]);
    const first = service.run(job.id);
    await expect(service.run(job.id)).rejects.toThrow("already running");
    expect((await first).job.status).toBe("completed");
  });
});
