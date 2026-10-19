/**
 * Imaging Client
 * The app's entry point for page image work. Sends jobs to the imaging Web
 * Worker when the browser supports OffscreenCanvas in workers, and falls
 * back to running the same code on the main thread when it doesn't (or the
 * worker fails to start). Requests can be cancelled with an AbortSignal.
 */

import type { ImagingRequest, PreparedImage, PreviewImage } from "@/core/ocr/imaging/imaging-ops";
import { canUseOffscreen, UnreadableImageError } from "@/core/ocr/imaging/image-io";
import type { OcrProfileId, PageEdits, Quad, QuarterTurn } from "@/types/ocr";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerFailed || typeof Worker === "undefined" || !canUseOffscreen()) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./imaging.worker.ts", import.meta.url), { type: "module", name: "salin-imaging" });
    worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: { name: string; message: string } }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.error) {
        const { name, message } = event.data.error;
        job.reject(name === "UnreadableImageError" ? new UnreadableImageError() : new Error(message));
      } else {
        job.resolve(event.data.result);
      }
    };
    worker.onerror = () => {
      // The worker couldn't load: fall back to the main thread from now on.
      workerFailed = true;
      worker = null;
      for (const job of pending.values()) job.reject(new Error("worker-failed"));
      pending.clear();
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

async function onMainThread(request: ImagingRequest) {
  const { runImaging } = await import("@/core/ocr/imaging/imaging-ops");
  return runImaging(request);
}

function run<T>(request: ImagingRequest, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const target = getWorker();
  if (!target) return onMainThread(request) as Promise<T>;
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      reject(signal!.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, {
      resolve: (value) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(value as T);
      },
      reject: (error) => {
        signal?.removeEventListener("abort", onAbort);
        if (error.message === "worker-failed") onMainThread(request).then((v) => resolve(v as T), reject);
        else reject(error);
      },
    });
    target.postMessage({ id, request });
  });
}

/** Prepares a page for OCR (full resolution, with line and checkbox detection). */
export function prepareImage(blob: Blob, edits: PageEdits, profile: OcrProfileId, signal?: AbortSignal) {
  return run<PreparedImage>({ op: "prepare", blob, edits, profile }, signal);
}

/** A quick, screen-sized preview of what the edits will produce. */
export function previewImage(blob: Blob, edits: PageEdits, signal?: AbortSignal) {
  return run<PreviewImage>({ op: "preview", blob, edits }, signal);
}

/** Finds the page's corners in a photo, or `null` if no clear page edge is visible. */
export async function detectPageEdges(blob: Blob, rotation: QuarterTurn, signal?: AbortSignal) {
  return (await run<{ quad: Quad | null }>({ op: "detect", blob, rotation }, signal)).quad;
}
