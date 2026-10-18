/**
 * Storage Errors
 * The error type repositories throw for problems a user can act on (bad names,
 * missing items, full storage), plus a helper that turns any thrown value into
 * a short message suitable for a toast.
 */

export type WorkspaceErrorCode = "validation" | "not-found" | "quota" | "invalid-backup";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export const QUOTA_MESSAGE =
  "This device is out of storage space for Salin. Delete files from Trash or free up space, then try again.";

/** True for IndexedDB/Dexie quota failures, including ones wrapped in a transaction abort. */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, inner } = error as { name?: string; inner?: unknown };
  if (name === "QuotaExceededError") return true;
  if (error instanceof WorkspaceError) return error.code === "quota";
  return isQuotaError(inner);
}

/** User-facing text for any error a storage operation can throw. */
export function errorMessage(error: unknown, fallback = "Something went wrong while saving. Please try again.") {
  if (error instanceof WorkspaceError) return error.message;
  if (isQuotaError(error)) return QUOTA_MESSAGE;
  return fallback;
}
