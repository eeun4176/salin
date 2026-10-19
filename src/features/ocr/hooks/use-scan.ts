/**
 * Scan Hooks
 * `useScan(id)` — a scan and its pages, live from IndexedDB (updates as
 * pages are prepared and read, also from other tabs). `useScans()` — every
 * scan, newest first, for the Datasets page. `useObjectUrl(blob)` — a
 * temporary URL for showing a stored image, revoked when no longer needed.
 */

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { db } from "@/core/storage/database";
import { getOcrPages, listOcrDocuments } from "@/core/storage/repositories/ocr.repository";
import type { OcrDocument, OcrPage } from "@/types/ocr";

export type ScanState = { status: "loading" } | { status: "missing" } | { status: "ready"; doc: OcrDocument; pages: OcrPage[] };

export function useScan(documentId: string): ScanState {
  const [state, setState] = useState<{ id: string; value: ScanState }>({ id: documentId, value: { status: "loading" } });
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const doc = await db.ocrDocuments.get(documentId);
      return doc ? { doc, pages: await getOcrPages(documentId) } : null;
    }).subscribe({
      next: (result) => setState({ id: documentId, value: result ? { status: "ready", ...result } : { status: "missing" } }),
      error: (error) => {
        console.error(error);
        setState({ id: documentId, value: { status: "missing" } });
      },
    });
    return () => subscription.unsubscribe();
  }, [documentId]);
  return state.id === documentId ? state.value : { status: "loading" };
}

export function useScans(): OcrDocument[] | null {
  const [scans, setScans] = useState<OcrDocument[] | null>(null);
  useEffect(() => {
    const subscription = liveQuery(listOcrDocuments).subscribe({ next: setScans, error: () => setScans([]) });
    return () => subscription.unsubscribe();
  }, []);
  return scans;
}

/**
 * A temporary URL for a stored image. `key` says when it is a different
 * image (IndexedDB hands back a new Blob object on every read, so identity
 * can't be used); by default the blob's size and type.
 */
export function useObjectUrl(blob: Blob | null | undefined, key?: string) {
  const id = blob ? (key ?? `${blob.size}:${blob.type}`) : null;
  const [entry, setEntry] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!blob || !id) return;
    const url = URL.createObjectURL(blob);
    let active = true;
    // Published after the effect (not synchronously inside it); revoked when the image changes or on unmount.
    void Promise.resolve().then(() => active && setEntry({ id, url }));
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
    // Re-made only when it's a different image, not for every new Blob object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return id && entry?.id === id ? entry.url : null;
}

/** Temporary URLs for several stored images at once (e.g. every page of a scan), each identified by its key. */
export function useObjectUrls(items: { key: string; blob: Blob | null }[]): (string | null)[] {
  const [entries, setEntries] = useState<Map<string, string>>(new Map());
  const signature = items.map((i) => (i.blob ? i.key : "-")).join("|");
  useEffect(() => {
    const made = new Map(items.flatMap((i) => (i.blob ? [[i.key, URL.createObjectURL(i.blob)] as const] : [])));
    let active = true;
    void Promise.resolve().then(() => active && setEntries(made));
    return () => {
      active = false;
      made.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return items.map((i) => (i.blob ? (entries.get(i.key) ?? null) : null));
}
