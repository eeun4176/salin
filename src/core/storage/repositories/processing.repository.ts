/**
 * Processing Repository
 * Every write to the `processingJobs` and `extractedDocuments` tables:
 * creating jobs for workspace files, moving them through their statuses
 * (queued → running → completed / failed / cancelled, and back to queued for a
 * retry), recording progress, recovering jobs a closed tab left running, and
 * caching parser output per document so it is only extracted once.
 */

import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import type {
  ExtractedDocument,
  JobError,
  JobOptions,
  JobStage,
  JobStatus,
  ProcessingJob,
} from "@/types/processing";

/** Which statuses a job may move to from each status. */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: ["queued"],
};

export function canTransition(from: JobStatus, to: JobStatus) {
  return TRANSITIONS[from].includes(to);
}

function invalid(message: string): never {
  throw new WorkspaceError("validation", message);
}

export async function getJobOrThrow(id: string) {
  const job = await db.processingJobs.get(id);
  if (!job) throw new WorkspaceError("not-found", "That processing job no longer exists.");
  return job;
}

export function getJob(id: string) {
  return db.processingJobs.get(id);
}

/** Every job, newest first. */
export async function listJobs() {
  return (await db.processingJobs.orderBy("createdAt").toArray()).reverse();
}

/** Jobs that include `fileId`, newest first. */
export async function listJobsForFile(fileId: string) {
  const jobs = await db.processingJobs.where("sourceFileIds").equals(fileId).toArray();
  return jobs.sort((a, b) => b.createdAt - a.createdAt);
}

/** Queues a job for the given workspace files (duplicates removed, order kept). */
export async function createJob(fileIds: string[], options: JobOptions = {}): Promise<ProcessingJob> {
  const sourceFileIds = [...new Set(fileIds)];
  if (sourceFileIds.length === 0) invalid("Choose at least one document to process.");

  return db.transaction("rw", db.files, db.processingJobs, async () => {
    for (const file of await db.files.bulkGet(sourceFileIds)) {
      if (!file || file.deletedAt !== null) {
        throw new WorkspaceError("not-found", "One of the chosen documents no longer exists or is in Trash.");
      }
    }
    const now = Date.now();
    const job: ProcessingJob = {
      id: crypto.randomUUID(),
      sourceFileIds,
      status: "queued",
      stage: null,
      progress: 0,
      options,
      datasetId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    await db.processingJobs.add(job);
    return job;
  });
}

/** Moves a job to `to`, applying `changes`. Throws if the move isn't allowed from its current status. */
function transition(id: string, to: JobStatus, changes: Partial<ProcessingJob> = {}): Promise<ProcessingJob> {
  return db.transaction("rw", db.processingJobs, async () => {
    const job = await getJobOrThrow(id);
    if (!canTransition(job.status, to)) invalid(`A ${job.status} job can't be marked ${to}.`);
    const updated: ProcessingJob = { ...job, ...changes, status: to, updatedAt: Date.now() };
    await db.processingJobs.put(updated);
    return updated;
  });
}

export function startJob(id: string) {
  return transition(id, "running", {
    stage: "extracting",
    progress: 0,
    datasetId: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  });
}

/**
 * Records progress on a running job (also its heartbeat). Returns `false`
 * when the job is no longer running — e.g. it was cancelled from another tab —
 * so the caller can stop.
 */
export function reportJobProgress(id: string, stage: JobStage, progress: number): Promise<boolean> {
  return db.transaction("rw", db.processingJobs, async () => {
    const job = await db.processingJobs.get(id);
    if (job?.status !== "running") return false;
    await db.processingJobs.update(id, { stage, progress: Math.min(1, Math.max(0, progress)), updatedAt: Date.now() });
    return true;
  });
}

export function completeJob(id: string, datasetId: string) {
  return transition(id, "completed", { stage: null, progress: 1, datasetId, finishedAt: Date.now() });
}

export function failJob(id: string, error: JobError) {
  return transition(id, "failed", { stage: null, error, finishedAt: Date.now() });
}

export function cancelJob(id: string) {
  return transition(id, "cancelled", { stage: null, finishedAt: Date.now() });
}

/** Puts a failed or cancelled job back in the queue so it can run again. */
export function requeueJob(id: string) {
  return transition(id, "queued", { stage: null, progress: 0, error: null, startedAt: null, finishedAt: null });
}

/** Removes a finished or queued job. The dataset it produced is kept. */
export function deleteJob(id: string) {
  return db.transaction("rw", db.processingJobs, async () => {
    const job = await getJobOrThrow(id);
    if (job.status === "running") invalid("Cancel this job before deleting it.");
    await db.processingJobs.delete(id);
  });
}

/** Five minutes without a heartbeat means the tab running the job is gone. */
export const STALE_JOB_MS = 5 * 60 * 1000;

/**
 * Marks running jobs whose heartbeat stopped as failed ("interrupted"), so
 * they can be retried. Call on startup. Returns how many were recovered.
 */
export function failInterruptedJobs(staleAfterMs = STALE_JOB_MS, now = Date.now()) {
  return db.transaction("rw", db.processingJobs, async () => {
    const stale = await db.processingJobs
      .where("status")
      .equals("running")
      .filter((job) => job.updatedAt < now - staleAfterMs)
      .toArray();
    for (const job of stale) {
      await db.processingJobs.update(job.id, {
        status: "failed",
        stage: null,
        error: { code: "interrupted", message: "Processing stopped because the app was closed. Try again.", fileId: null },
        updatedAt: now,
        finishedAt: now,
      });
    }
    return stale.length;
  });
}

/* ------------------------------------------------------------------
   Extraction cache
------------------------------------------------------------------- */

/** Cached output of `parserId` at `parserVersion` for these document bytes, if any. */
export async function findExtraction(blobId: string, parserId: string, parserVersion: number) {
  const cached = await db.extractedDocuments.where("[blobId+parserId]").equals([blobId, parserId]).first();
  return cached?.parserVersion === parserVersion ? cached : undefined;
}

/** Stores parser output, replacing any older result from the same parser for the same bytes. */
export function saveExtraction(input: Omit<ExtractedDocument, "id" | "createdAt">): Promise<ExtractedDocument> {
  return db.transaction("rw", db.extractedDocuments, async () => {
    await db.extractedDocuments.where("[blobId+parserId]").equals([input.blobId, input.parserId]).delete();
    const doc: ExtractedDocument = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
    await db.extractedDocuments.add(doc);
    return doc;
  });
}

export function getExtraction(id: string) {
  return db.extractedDocuments.get(id);
}

/** Every cached extraction of these document bytes (e.g. to show parser warnings). */
export function listExtractionsForBlobs(blobIds: string[]) {
  return db.extractedDocuments.where("blobId").anyOf(blobIds).toArray();
}
