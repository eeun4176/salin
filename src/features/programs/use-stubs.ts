/**
 * Stubs and Program Day Hooks
 * `useStubs`: the programs the paravet can see and the stub sheets City Vet
 * sent their barangay to print. `useProgramDay`: one program's day pack
 * (every stub to scan) and its attendance so far. Both load from the City
 * Vet server when there's signal, keep a copy on the device (settings
 * table) for when there isn't, reload after the outbox sends, and list the
 * changes still waiting in the outbox.
 */

import { liveQuery } from "dexie";
import { useCallback, useEffect, useState } from "react";

import { AdminApiError } from "@/core/admin/admin-api";
import type { Session } from "@/core/auth/local-auth";
import { dayCacheKey, loadAttendance, loadDayPack, loadStubOverview, loadStubSheet, stubsCacheKey, type Attendance, type DayPack, type StubProgram, type StubSheet } from "@/core/programs/stubs";
import { db } from "@/core/storage/database";
import { listOutbox } from "@/core/sync/outbox";
import { useAuthStore } from "@/stores/auth-store";
import { useSyncStore } from "@/stores/sync-store";
import type { OutboxItem } from "@/types/sync";

interface Saved<T> {
  data: T | null;
  status: "loading" | "ready" | "unavailable";
  /** True while showing the device's copy because the server can't be reached. */
  fromDevice: boolean;
  savedAt: number | null;
  error: string | null;
}

const LOADING = { data: null, status: "loading", fromDevice: false, savedAt: null, error: null } as const;

/** Fetch, save on the device and return; or return the device's copy when the server can't be reached. */
async function cached<T>(key: string, fetch: (previous: T | null) => Promise<T>): Promise<Saved<T>> {
  const saved = (await db.settings.get(key))?.value as { data: T; savedAt: number } | undefined;
  try {
    const data = await fetch(saved?.data ?? null);
    const savedAt = Date.now();
    await db.settings.put({ key, value: { data, savedAt } });
    return { data, status: "ready", fromDevice: false, savedAt, error: null };
  } catch (failure) {
    return { data: saved?.data ?? null, status: saved ? "ready" : "unavailable", fromDevice: true, savedAt: saved?.savedAt ?? null, error: failure instanceof AdminApiError ? failure.message : "Couldn't load from City Vet." };
  }
}

/** Outbox changes for stubs and attendance from this account, still waiting to send. */
function useStubOutbox(account: string | undefined) {
  const [pending, setPending] = useState<OutboxItem[]>([]);
  useEffect(() => {
    const subscription = liveQuery(listOutbox).subscribe({
      next: (items) => setPending(items.filter((item) => item.path === "/stub-workflow" && item.account === account)),
      error: (failure: unknown) => console.error(failure),
    });
    return () => subscription.unsubscribe();
  }, [account]);
  return pending;
}

function useSaved<T>(load: ((session: Session) => Promise<Saved<T>>) | null) {
  const session = useAuthStore((state) => state.session);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const [saved, setSaved] = useState<Saved<T>>(LOADING);
  const reload = useCallback(async () => {
    if (session && load) setSaved(await load(session));
  }, [session, load]);
  useEffect(() => {
    if (!session || !load) return;
    let live = true;
    void load(session).then((next) => live && setSaved(next));
    return () => {
      live = false;
    };
  }, [session, load, lastSyncedAt]);
  return { ...saved, reload, pending: useStubOutbox(session?.key) };
}

export interface StubsData {
  programs: StubProgram[];
  /** Sheets sent to the barangay; a sheet that can't load now (e.g. after the program) keeps its saved copy. */
  sheets: StubSheet[];
  /** Each sheet's program day pack: the owners and pets encoded on its stubs, and which stubs were used. */
  packs: DayPack[];
}

const loadStubs = (session: Session) =>
  cached<StubsData>(stubsCacheKey(session.key), async (previous) => {
    const { programs, batches } = await loadStubOverview(session.token);
    const sent = batches.filter((batch) => batch.sentAt);
    const results = await Promise.allSettled(sent.map((batch) => loadStubSheet(session.token, batch.id)));
    const sheets = results.flatMap((result, i) => (result.status === "fulfilled" ? [result.value] : (previous?.sheets.filter((sheet) => sheet.batch.id === sent[i].id) ?? [])));
    const ids = [...new Set(sheets.map((sheet) => sheet.program.id))];
    const loaded = await Promise.allSettled(ids.map((id) => loadDayPack(session.token, id)));
    const packs = loaded.flatMap((result, i) => (result.status === "fulfilled" ? [result.value] : (previous?.packs?.filter((pack) => pack.program.id === ids[i]) ?? [])));
    return { programs, sheets, packs };
  });

export const useStubs = () => useSaved(loadStubs);

export interface ProgramDayData {
  pack: DayPack;
  attendance: Attendance[];
}

export function useProgramDay(campaignId: number | null) {
  const load = useCallback(
    (session: Session) =>
      cached<ProgramDayData>(dayCacheKey(session.key, campaignId!), async () => {
        const [pack, attendance] = await Promise.all([loadDayPack(session.token, campaignId!), loadAttendance(session.token, campaignId!).catch(() => [])]);
        return { pack, attendance };
      }),
    [campaignId],
  );
  return useSaved(campaignId === null ? null : load);
}
