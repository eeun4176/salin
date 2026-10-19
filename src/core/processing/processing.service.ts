/**
 * Processing Service
 * Runs processing jobs end to end, with no React and no network: load each
 * document's bytes from IndexedDB, extract its text/tables with the parser
 * registered for its file type (reusing cached results), structure everything
 * into one dataset, and save the dataset and the finished job together.
 * Supports progress callbacks, cancellation (also from another tab) and retry.
 */

import { buildDatasetContent, type DatasetTransformer, type TransformSource } from "@/core/processing/dataset-transformer";
import { isAbortError, ProcessingError, toJobError } from "@/core/processing/processing-errors";
import { documentParsers } from "@/core/processing/parsers";
import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import { splitExtension } from "@/core/storage/names";
import { createDataset } from "@/core/storage/repositories/dataset.repository";
import { getFileWithBlob } from "@/core/storage/repositories/file-repository";
import {
  cancelJob,
  completeJob,
  createJob,
  failJob,
  findExtraction,
  getJobOrThrow,
  reportJobProgress,
  requeueJob,
  saveExtraction,
  startJob,
} from "@/core/storage/repositories/processing.repository";
import type { FileKind, WorkspaceFile } from "@/types/domain";
import type { Dataset, ExtractedContent, JobOptions, JobStage, ProcessingJob, TableSelection } from "@/types/processing";

export interface ParseInput {
  file: WorkspaceFile;
  blob: Blob;
  /** Tables the user confirmed in this workbook (Excel only); omitted = detect automatically. */
  tables?: TableSelection[];
}

export interface ParseContext {
  /** Aborted when the job is cancelled; long parsers should check it between steps. */
  signal: AbortSignal;
  /** Report progress through this document, 0–1. */
  onProgress: (fraction: number) => void;
}

/** Reads one document locally and returns its text and tables. */
export type ParseFn = (input: ParseInput, context: ParseContext) => Promise<ExtractedContent>;

/**
 * Reads one kind of document locally. Bump `version` whenever the output
 * changes, so cached extractions from the old version are redone.
 */
export interface DocumentParser {
  id: string;
  version: number;
  kinds: readonly FileKind[];
  parse: ParseFn;
}

export interface ProgressUpdate {
  jobId: string;
  stage: JobStage;
  /** 0–1 across the whole job. */
  progress: number;
  /** The document being worked on, if any. */
  fileId: string | null;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface ProcessingResult {
  job: ProcessingJob;
  /** The saved dataset when the job completed, otherwise `null` (see `job.error`). */
  dataset: Dataset | null;
}

export interface ProcessingServiceOptions {
  parsers?: DocumentParser[];
  transform?: DatasetTransformer;
}

// Share of the progress bar each stage covers.
const EXTRACT_END = 0.85;
const SAVE_START = 0.95;
/** How often parser progress is written to the job record (its heartbeat). */
const HEARTBEAT_MS = 1000;

function defaultDatasetName(files: { name: string }[]) {
  const [base] = splitExtension(files[0]?.name ?? "", true);
  const name = base.trim() || "Dataset";
  return files.length > 1 ? `${name} + ${files.length - 1} more` : name;
}

/** Short stable id for a set of table selections (cache key). */
function selectionKey(tables: TableSelection[]) {
  let hash = 0;
  for (const ch of JSON.stringify(tables)) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

export type ProcessingService = ReturnType<typeof createProcessingService>;

export function createProcessingService({ parsers = documentParsers, transform = buildDatasetContent }: ProcessingServiceOptions = {}) {
  /** Jobs running in this tab, so they can be cancelled immediately. */
  const controllers = new Map<string, AbortController>();

  function parserFor(kind: FileKind) {
    return parsers.find((p) => p.kinds.includes(kind));
  }

  async function extractFile(
    fileId: string,
    tables: TableSelection[] | undefined,
    signal: AbortSignal,
    onProgress: (fraction: number) => void,
  ): Promise<TransformSource> {
    let loaded: Awaited<ReturnType<typeof getFileWithBlob>>;
    try {
      loaded = await getFileWithBlob(fileId);
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === "not-found") {
        throw new ProcessingError("file-missing", "A document in this job was deleted before it could be processed.", fileId);
      }
      throw error;
    }
    const { file, blob } = loaded;
    if (file.deletedAt !== null) {
      throw new ProcessingError("file-missing", `"${file.name}" is in Trash. Restore it, then try again.`, file.id);
    }

    const parser = parserFor(file.kind);
    if (!parser) throw new ProcessingError("unsupported-file", `Data can't be extracted from ${file.kind.toUpperCase()} files yet. Try a PDF, Excel, CSV or text file.`, file.id);

    // Each set of confirmed tables is cached separately from automatic detection.
    const cacheId = tables ? `${parser.id}#${selectionKey(tables)}` : parser.id;
    const cached = await findExtraction(file.blobId, cacheId, parser.version);
    if (cached) return { file, extraction: cached };

    let content: ExtractedContent;
    try {
      content = await parser.parse({ file, blob, tables }, { signal, onProgress });
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw error;
      if (error instanceof ProcessingError) throw new ProcessingError(error.code, error.message, error.fileId ?? file.id);
      console.error(error);
      throw new ProcessingError("parse-failed", `"${file.name}" couldn't be read. It may be damaged or password-protected.`, file.id);
    }
    signal.throwIfAborted();

    const extraction = await saveExtraction({
      blobId: file.blobId,
      fileId: file.id,
      kind: file.kind,
      parserId: cacheId,
      parserVersion: parser.version,
      pages: content.pages,
      tables: content.tables,
      warnings: content.warnings,
    });
    return { file, extraction };
  }

  /** Runs a queued job to completion. Failures and cancellation are recorded on the job, not thrown. */
  async function run(jobId: string, options: RunOptions = {}): Promise<ProcessingResult> {
    if (controllers.has(jobId)) throw new WorkspaceError("validation", "This job is already running.");
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    controllers.set(jobId, controller);

    let currentFileId: string | null = null;
    let lastBeat = 0;
    const emit = (stage: JobStage, progress: number) => options.onProgress?.({ jobId, stage, progress, fileId: currentFileId });
    const beat = async (stage: JobStage, progress: number) => {
      lastBeat = Date.now();
      // The job stopped running elsewhere (e.g. cancelled from another tab).
      if (!(await reportJobProgress(jobId, stage, progress))) controller.abort();
    };
    const step = async (stage: JobStage, progress: number) => {
      emit(stage, progress);
      await beat(stage, progress);
      signal.throwIfAborted();
    };

    try {
      let job = await startJob(jobId);
      try {
        const sources: TransformSource[] = [];
        const count = job.sourceFileIds.length;
        for (const [index, fileId] of job.sourceFileIds.entries()) {
          currentFileId = fileId;
          const start = (index / count) * EXTRACT_END;
          await step("extracting", start);
          const onParserProgress = (fraction: number) => {
            const progress = start + Math.min(1, Math.max(0, fraction)) * (EXTRACT_END / count);
            emit("extracting", progress);
            if (Date.now() - lastBeat >= HEARTBEAT_MS) beat("extracting", progress).catch(() => {});
          };
          sources.push(await extractFile(fileId, job.options.tables?.[fileId], signal, onParserProgress));
        }
        currentFileId = null;

        await step("structuring", EXTRACT_END);
        const content = transform(sources);
        if (content.rows.length === 0) {
          throw new ProcessingError("no-content", count === 1 ? "No text or tables were found in this document." : "No text or tables were found in these documents.");
        }

        await step("saving", SAVE_START);
        const name = job.options.datasetName?.trim() || defaultDatasetName(sources.map((s) => s.file));
        // Dataset and job completion are saved together: never a completed job without its data.
        const dataset = await db.transaction("rw", db.datasets, db.datasetRows, db.processingJobs, async () => {
          const created = await createDataset({ name, sourceFileIds: job.sourceFileIds, jobId, content });
          job = await completeJob(jobId, created.id);
          return created;
        });
        emit("saving", 1);
        return { job, dataset };
      } catch (error) {
        const current = await getJobOrThrow(jobId);
        if (current.status !== "running") return { job: current, dataset: null };
        job = signal.aborted || isAbortError(error) ? await cancelJob(jobId) : await failJob(jobId, toJobError(error, currentFileId));
        return { job, dataset: null };
      }
    } finally {
      controllers.delete(jobId);
    }
  }

  return {
    parserFor,
    /** True if a parser is registered for this file type. */
    canProcess: (kind: FileKind) => parserFor(kind) !== undefined,
    isRunning: (jobId: string) => controllers.has(jobId),

    /** Queues a job for these files (does not start it). */
    queue: (fileIds: string[], options?: JobOptions) => createJob(fileIds, options),
    run,

    /** Queues and runs a job in one call. */
    async process(fileIds: string[], jobOptions?: JobOptions, runOptions?: RunOptions) {
      const job = await createJob(fileIds, jobOptions);
      return run(job.id, runOptions);
    },

    /** Runs a failed or cancelled job again. Cached extractions make retries fast. */
    async retry(jobId: string, runOptions?: RunOptions) {
      await requeueJob(jobId);
      return run(jobId, runOptions);
    },

    /** Stops a job. A job running in another tab stops at its next progress check. */
    async cancel(jobId: string) {
      const controller = controllers.get(jobId);
      if (controller) {
        controller.abort();
        return;
      }
      const job = await getJobOrThrow(jobId);
      if (job.status === "queued" || job.status === "running") await cancelJob(jobId);
    },
  };
}
