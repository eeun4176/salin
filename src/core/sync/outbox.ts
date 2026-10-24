/**
 * Outbox
 * Changes meant for the City Veterinary Office (program requests now;
 * program-day scans and census later) are saved here first, then sent one at
 * a time, oldest first, whenever Salin is online and signed in — so work done
 * with no signal is never lost. Each item's id is also the server's request
 * id, so a resend after a dropped reply is recognised instead of duplicated.
 * Offline, signed out or server trouble leaves items waiting (server trouble
 * backs off before retrying, and later items wait behind it to keep order);
 * a refusal (conflict, invalid, refused) marks the item "needs attention"
 * with the server's message until the user retries or discards it.
 */

import { z } from "zod";

import { AdminApiError, adminRequest, type AdminErrorKind } from "@/core/admin/admin-api";
import { db } from "@/core/storage/database";

export interface NewOutboxItem {
  id?: string;
  account: string;
  path: string;
  body: Record<string, unknown>;
  label: string;
  doneIfCodes?: string[];
}

export interface FlushResult {
  sent: number;
  /** Why sending stopped early, if it did. */
  stopped: Extract<AdminErrorKind, "offline" | "unauthenticated" | "not_configured" | "server"> | null;
}

const BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;

export const newRequestId = () => crypto.randomUUID();

// Strictly increasing, so two changes made in the same millisecond still go out in the order they were made.
let lastCreatedAt = 0;

/** Saves a change to send; returns its id. */
export async function enqueue({ id = newRequestId(), ...item }: NewOutboxItem): Promise<string> {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  await db.outbox.add({ ...item, id, method: "POST", status: "pending", attempts: 0, nextAttemptAt: 0, createdAt: lastCreatedAt });
  return id;
}

export function listOutbox() {
  return db.outbox.orderBy("createdAt").toArray();
}

/** Sends a "needs attention" item again (e.g. after the user fixed the cause in e-Kapon). */
export async function retryItem(id: string) {
  await db.outbox.update(id, { status: "pending", attempts: 0, nextAttemptAt: 0 });
}

export async function discardItem(id: string) {
  await db.outbox.delete(id);
}

let running: Promise<FlushResult> | null = null;

/** Sends what `account` has waiting, in order. Concurrent calls share one run. */
export function flushOutbox(session: { token: string; key: string }, now = () => Date.now()): Promise<FlushResult> {
  running ??= send(session, now).finally(() => {
    running = null;
  });
  return running;
}

async function send({ token, key }: { token: string; key: string }, now: () => number): Promise<FlushResult> {
  const items = (await db.outbox.where("status").anyOf("pending", "sending").sortBy("createdAt")).filter((item) => item.account === key);
  let sent = 0;
  for (const item of items) {
    if (item.nextAttemptAt > now()) break;
    await db.outbox.update(item.id, { status: "sending" });
    try {
      await adminRequest(item.path, { method: item.method, token, body: item.body, schema: z.unknown() });
      await db.outbox.delete(item.id);
      sent++;
    } catch (error) {
      if (!(error instanceof AdminApiError)) {
        await db.outbox.update(item.id, { status: "pending" });
        throw error;
      }
      const lastError = { code: error.code, message: error.message };
      if (item.doneIfCodes?.includes(error.code)) {
        await db.outbox.delete(item.id);
        sent++;
      } else if (error.kind === "offline" || error.kind === "unauthenticated" || error.kind === "not_configured") {
        await db.outbox.update(item.id, { status: "pending" });
        return { sent, stopped: error.kind };
      } else if (error.kind === "server") {
        const attempts = item.attempts + 1;
        await db.outbox.update(item.id, { status: "pending", attempts, nextAttemptAt: now() + Math.min(BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS), lastError });
        return { sent, stopped: "server" };
      } else {
        await db.outbox.update(item.id, { status: "attention", lastError });
      }
    }
  }
  return { sent, stopped: null };
}

/** When the next backed-off item may be tried (epoch ms), if any is waiting. */
export async function nextRetryAt(key: string): Promise<number | null> {
  const waiting = (await db.outbox.where("status").equals("pending").toArray()).filter((item) => item.account === key && item.nextAttemptAt > 0);
  return waiting.length ? Math.min(...waiting.map((item) => item.nextAttemptAt)) : null;
}
