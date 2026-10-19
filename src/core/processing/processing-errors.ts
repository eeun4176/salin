/**
 * Processing Errors
 * The error type parsers and the processing service throw for problems a
 * user should see (unsupported file, unreadable document, no content), and a
 * helper that turns anything thrown during a job into the `JobError` stored
 * on the job record.
 */

import { isQuotaError, QUOTA_MESSAGE, WorkspaceError } from "@/core/storage/errors";
import type { ID } from "@/types/domain";
import type { JobError, JobErrorCode } from "@/types/processing";

export class ProcessingError extends Error {
  readonly code: JobErrorCode;
  readonly fileId: ID | null;

  constructor(code: JobErrorCode, message: string, fileId: ID | null = null) {
    super(message);
    this.name = "ProcessingError";
    this.code = code;
    this.fileId = fileId;
  }
}

/** True for an AbortSignal cancellation (DOMException or anything named AbortError). */
export function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError";
}

/** Converts any thrown value into the error stored on a failed job. */
export function toJobError(error: unknown, fileId: ID | null = null): JobError {
  if (error instanceof ProcessingError) return { code: error.code, message: error.message, fileId: error.fileId ?? fileId };
  if (isQuotaError(error)) return { code: "storage", message: QUOTA_MESSAGE, fileId };
  if (error instanceof WorkspaceError && error.code === "not-found") return { code: "file-missing", message: error.message, fileId };
  return { code: "unknown", message: "Something went wrong while processing. Please try again.", fileId };
}
