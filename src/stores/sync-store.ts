/**
 * Sync Store
 * Sends the outbox (src/core/sync/outbox.ts) whenever it can: at start-up,
 * when the connection comes back, after a change is saved, when a
 * backed-off item is due, and from "Send now". Keeps whether it is sending
 * and why the last run stopped (offline, signed out, server trouble).
 */

import { create } from "zustand";

import { enqueue, flushOutbox, nextRetryAt, type FlushResult, type NewOutboxItem } from "@/core/sync/outbox";
import { useAuthStore } from "@/stores/auth-store";

interface SyncState {
  syncing: boolean;
  stopped: FlushResult["stopped"];
  lastSyncedAt: number | null;
}

export const useSyncStore = create<SyncState>()(() => ({ syncing: false, stopped: null, lastSyncedAt: null }));

let retryTimer: ReturnType<typeof setTimeout> | undefined;

export async function syncNow() {
  const session = useAuthStore.getState().session;
  if (!session) return;
  clearTimeout(retryTimer);
  useSyncStore.setState({ syncing: true });
  try {
    const { stopped } = await flushOutbox(session);
    useSyncStore.setState({ stopped, ...(stopped ? {} : { lastSyncedAt: Date.now() }) });
    const due = await nextRetryAt(session.key);
    if (due) retryTimer = setTimeout(() => void syncNow(), Math.max(0, due - Date.now()));
  } catch (error) {
    console.error(error);
  } finally {
    useSyncStore.setState({ syncing: false });
  }
}

/** Saves a change for the signed-in account and starts sending it. Returns the change's id (its request id). */
export async function queueChange(item: Omit<NewOutboxItem, "account">) {
  const session = useAuthStore.getState().session;
  if (!session) throw new Error("Sign in to save changes for the City Veterinary Office.");
  const id = await enqueue({ ...item, account: session.key });
  void syncNow();
  return id;
}

export function startSync() {
  window.addEventListener("online", () => void syncNow());
  useAuthStore.subscribe((state, previous) => {
    if (state.session?.token && state.session.token !== previous.session?.token) void syncNow();
  });
}
