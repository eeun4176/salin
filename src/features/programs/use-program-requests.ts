/**
 * Program Requests Hook
 * The signed-in paravet's barangay request from the City Vet server, kept on
 * the device (settings table) so the page also opens offline, plus the
 * changes still waiting in the outbox. Reloads after the outbox sends.
 */

import { liveQuery } from "dexie";
import { useCallback, useEffect, useState } from "react";

import { AdminApiError } from "@/core/admin/admin-api";
import { currentRequest, loadRequest, loadRequests, mergedFrom, requestCacheKey as cacheKey, type ProgramRequest, type RequestDetail } from "@/core/programs/program-requests";
import { db } from "@/core/storage/database";
import type { Session } from "@/core/auth/local-auth";
import { listOutbox } from "@/core/sync/outbox";
import { useAuthStore } from "@/stores/auth-store";
import { useSyncStore } from "@/stores/sync-store";
import type { OutboxItem } from "@/types/sync";

interface Cached {
  requests: ProgramRequest[];
  detail: RequestDetail | null;
  savedAt: number;
}

export interface ProgramRequestsState {
  status: "loading" | "ready" | "unavailable";
  current: ProgramRequest | null;
  /** The barangay's own request, when it was merged into `current`. */
  merged: ProgramRequest | null;
  detail: RequestDetail | null;
  /** When the shown data was last loaded from the server (it may be older when offline). */
  savedAt: number | null;
  /** True while showing the copy on this device because the server can't be reached. */
  fromDevice: boolean;
  error: string | null;
  pending: OutboxItem[];
  reload: () => Promise<void>;
}

interface Loaded {
  data: Cached | null;
  status: ProgramRequestsState["status"];
  fromDevice: boolean;
  error: string | null;
}

/** From the server (and saved on the device), or the device's saved copy when the server can't be reached. */
async function load(session: Session): Promise<Loaded> {
  try {
    const { campaigns } = await loadRequests(session.token);
    const current = currentRequest(campaigns, session.barangayId);
    const detail = current ? await loadRequest(session.token, current.id) : null;
    const data: Cached = { requests: campaigns, detail, savedAt: Date.now() };
    await db.settings.put({ key: cacheKey(session.key), value: data });
    return { data, status: "ready", fromDevice: false, error: null };
  } catch (failure) {
    const saved = ((await db.settings.get(cacheKey(session.key)))?.value as Cached | undefined) ?? null;
    return { data: saved, status: saved ? "ready" : "unavailable", fromDevice: true, error: failure instanceof AdminApiError ? failure.message : "The request couldn't be loaded." };
  }
}

export function useProgramRequests(): ProgramRequestsState {
  const session = useAuthStore((state) => state.session);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const [loaded, setLoaded] = useState<Loaded>({ data: null, status: "loading", fromDevice: false, error: null });
  const [pending, setPending] = useState<OutboxItem[]>([]);

  const reload = useCallback(async () => {
    if (session) setLoaded(await load(session));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    void load(session).then((next) => live && setLoaded(next));
    return () => {
      live = false;
    };
  }, [session, lastSyncedAt]);

  useEffect(() => {
    const subscription = liveQuery(listOutbox).subscribe({
      next: (items) => setPending(items.filter((item) => item.path === "/program-interest" && item.account === session?.key)),
      error: (failure: unknown) => console.error(failure),
    });
    return () => subscription.unsubscribe();
  }, [session?.key]);

  const barangayId = session?.barangayId ?? null;
  const { data, status, fromDevice, error } = loaded;
  return {
    status,
    current: data ? currentRequest(data.requests, barangayId) : null,
    merged: data ? mergedFrom(data.requests, barangayId) : null,
    detail: data?.detail ?? null,
    savedAt: data?.savedAt ?? null,
    fromDevice,
    error,
    pending,
    reload,
  };
}
