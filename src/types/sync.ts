/**
 * Sync Types
 * One change waiting in the outbox to be sent to the City Veterinary
 * Office's server (see src/core/sync/outbox.ts).
 */

export type OutboxStatus = "pending" | "sending" | "attention";

export interface OutboxItem {
  /** Also sent as the request id, so the server recognises a resend. */
  id: string;
  /** Account Key / username of whoever made the change; only their session sends it. */
  account: string;
  path: string;
  method: "POST";
  body: Record<string, unknown>;
  /** Plain words for the sync list, e.g. "Add Juana Cruz". */
  label: string;
  /** Error codes that mean an earlier send already went through (e.g. a resend after a lost reply). */
  doneIfCodes?: string[];
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms; server trouble backs off before trying again. */
  nextAttemptAt: number;
  createdAt: number;
  /** Why the server refused it (status "attention"), or the last temporary failure. */
  lastError?: { code: string; message: string };
}
