/**
 * Model Manager
 * Downloads the model files a device needs (only those) — the OCR engine
 * and languages, and the optional AI models — with progress and
 * cancellation; streams each file straight into Cache Storage (so a 500 MB
 * model never sits in memory) and keeps it only once it arrived complete,
 * so an interrupted download resumes from the files already stored. Files
 * come only from Salin's own site or the approved AI model host. Also
 * checks files are present and intact, reports the space they use, removes
 * them, and cleans up copies left behind by an app update. Missing files
 * while offline raise a clear, actionable error instead of a network failure.
 */

import { AI_ASSETS, isApprovedModelUrl } from "@/core/ai/ai-models";
import { isQuotaError, QUOTA_MESSAGE, WorkspaceError } from "@/core/storage/errors";
import { ensureSpaceFor, requestPersistentStorage } from "@/core/storage/storage-health";
import { MODEL_ASSETS, type ModelAsset } from "@/core/ocr/models/model-assets";

/** Holds every on-device model file (OCR and AI); the name predates the AI models. */
export const MODEL_CACHE = "salin-ocr-models";

export type ModelErrorCode = "offline-missing" | "download-failed" | "quota" | "unavailable" | "corrupt";

export class ModelError extends Error {
  readonly code: ModelErrorCode;

  constructor(code: ModelErrorCode, message: string) {
    super(message);
    this.name = "ModelError";
    this.code = code;
  }
}

export const OFFLINE_MISSING_MESSAGE =
  "The text-recognition files aren't on this device yet, and you're offline. Connect to the internet once, then download them in Settings → Reading scanned pages (or start reading again). Your pages are saved — you can also type the values yourself.";

function openCache(name = MODEL_CACHE) {
  if (typeof caches === "undefined") throw new ModelError("unavailable", "This browser can't store recognition files (Cache Storage is unavailable — private browsing?).");
  return caches.open(name);
}

const cacheOf = (asset: ModelAsset) => openCache(asset.cache ?? MODEL_CACHE);

/** Every cache that holds model files: Salin's own and those the AI runtimes read from. */
const modelCaches = () => [...new Set([MODEL_CACHE, ...AI_ASSETS.map((a) => a.cache ?? MODEL_CACHE)])];

/** Absolute URL, so cache keys match however the asset URL was written (the AI worker reads files by this key). */
export const keyOf = (asset: ModelAsset) => new URL(asset.url, location.href).href;

export interface AssetStatus {
  asset: ModelAsset;
  ready: boolean;
  /** Stored size, when ready. */
  storedBytes: number | null;
}

/** Which of `assets` are stored and complete. */
export async function checkAssets(assets: ModelAsset[]): Promise<AssetStatus[]> {
  return Promise.all(
    assets.map(async (asset) => {
      const response = await (await cacheOf(asset)).match(keyOf(asset));
      const verified = Number(response?.headers.get("x-salin-bytes") ?? NaN);
      const ready = Boolean(response) && verified === asset.bytes;
      return { asset, ready, storedBytes: ready ? Number(response!.headers.get("x-salin-stored")) : null };
    }),
  );
}

export async function allReady(assets: ModelAsset[]) {
  try {
    return (await checkAssets(assets)).every((s) => s.ready);
  } catch {
    return false;
  }
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  /** The file being downloaded. */
  asset: ModelAsset;
}

const headersFor = (asset: ModelAsset, stored: number) => ({
  "content-type": asset.url.endsWith(".js") ? "text/javascript" : asset.url.endsWith(".json") ? "application/json" : "application/octet-stream",
  "content-length": String(stored),
  // The catalogue size it was verified against, and what it actually takes up.
  "x-salin-bytes": String(asset.bytes),
  "x-salin-stored": String(stored),
});

/** Streams one file into the cache; it's kept only if exactly the expected bytes arrived. */
async function downloadInto(cache: Cache, asset: ModelAsset, signal: AbortSignal | undefined, onBytes: (n: number) => void) {
  if (!isApprovedModelUrl(asset.url)) throw new ModelError("unavailable", `${asset.label} isn't from an approved download source, so it wasn't downloaded.`);
  let response: Response;
  try {
    response = await fetch(asset.url, { signal, cache: "no-store" });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!navigator.onLine) throw new ModelError("offline-missing", OFFLINE_MISSING_MESSAGE);
    throw new ModelError("download-failed", `${asset.label} couldn't be downloaded. Check your connection and try again.`);
  }
  if (!response.ok || !response.body) throw new ModelError("download-failed", `${asset.label} couldn't be downloaded (server said ${response.status}). Try again later.`);

  let received = 0;
  let head: Uint8Array | null = null;
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        head ??= chunk;
        received += chunk.byteLength;
        onBytes(chunk.byteLength);
        controller.enqueue(chunk);
      },
    }),
  );
  const key = keyOf(asset);
  try {
    await cache.put(key, new Response(counted, { headers: headersFor(asset, asset.bytes) }));
  } catch (error) {
    await cache.delete(key).catch(() => undefined);
    if (signal?.aborted) throw signal.reason ?? error;
    if (isQuotaError(error)) throw new WorkspaceError("quota", QUOTA_MESSAGE);
    throw new ModelError("download-failed", `${asset.label} stopped downloading. Check your connection and try again — files already downloaded are kept.`);
  }
  if (received === asset.bytes) return;
  // Some servers transparently decompress .gz files: a larger, un-gzipped language file is fine too.
  const gzipped = head?.[0] === 0x1f && head?.[1] === 0x8b;
  if (asset.kind === "language" && received > asset.bytes && !gzipped) {
    const blob = await (await cache.match(key))!.blob();
    await cache.put(key, new Response(blob, { headers: headersFor(asset, blob.size) }));
    return;
  }
  await cache.delete(key);
  throw new ModelError("corrupt", `${asset.label} downloaded incompletely (${received} of ${asset.bytes} bytes). Try again.`);
}

/**
 * Downloads every asset that isn't stored yet. Reports overall progress.
 * Nothing partial is stored: each file is kept only once it's complete, so
 * after an interruption only the unfinished files download again.
 */
export async function downloadAssets(assets: ModelAsset[], options: { signal?: AbortSignal; onProgress?: (p: DownloadProgress) => void } = {}) {
  const status = await checkAssets(assets);
  const missing = status.filter((s) => !s.ready).map((s) => s.asset);
  if (missing.length === 0) return;
  const total = missing.reduce((sum, a) => sum + a.bytes, 0);
  await ensureSpaceFor(total);
  // Ask the browser not to evict the models (and the workspace) under storage pressure.
  void requestPersistentStorage();

  let loaded = 0;
  for (const asset of missing) {
    options.signal?.throwIfAborted();
    options.onProgress?.({ loaded, total, asset });
    await downloadInto(await cacheOf(asset), asset, options.signal, (n) => {
      loaded += n;
      options.onProgress?.({ loaded, total, asset });
    });
  }
  await pruneStale();
}

/**
 * Deep check of stored files: each one's actual stored size must match its
 * record (catches a file cut short by a crash mid-save). Damaged files are
 * removed so they download again. Resolves to the assets that were damaged.
 */
export async function verifyAssets(assets: ModelAsset[]): Promise<ModelAsset[]> {
  const damaged: ModelAsset[] = [];
  for (const asset of assets) {
    const cache = await cacheOf(asset);
    const response = await cache.match(keyOf(asset));
    if (!response) continue;
    const stored = Number(response.headers.get("x-salin-stored"));
    const size = (await response.blob()).size;
    if (Number(response.headers.get("x-salin-bytes")) !== asset.bytes || size !== stored) {
      damaged.push(asset);
      await cache.delete(keyOf(asset));
    }
  }
  return damaged;
}

/**
 * The stored bytes of an asset. When it isn't stored yet it is downloaded
 * first (only while online); offline, a clear "files missing" error is thrown.
 */
export async function loadAsset(asset: ModelAsset, signal?: AbortSignal): Promise<Blob> {
  const cache = await cacheOf(asset);
  const cached = await cache.match(keyOf(asset));
  if (cached) return cached.blob();
  if (!navigator.onLine) throw new ModelError("offline-missing", OFFLINE_MISSING_MESSAGE);
  await downloadAssets([asset], { signal });
  const stored = await cache.match(keyOf(asset));
  if (!stored) throw new ModelError("download-failed", `${asset.label} couldn't be saved on this device.`);
  return stored.blob();
}

/** Bytes used by stored model files: the given assets, or all of them. */
export async function storedBytes(assets?: ModelAsset[]) {
  if (typeof caches === "undefined") return 0;
  const only = assets ? new Set(assets.map(keyOf)) : null;
  let sum = 0;
  for (const name of modelCaches()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (only && !only.has(request.url)) continue;
      const response = await cache.match(request);
      sum += Number(response?.headers.get("x-salin-stored") ?? 0);
    }
  }
  return sum;
}

/** Removes stored files: the given assets, or all of them. Callers stop recognition first. */
export async function removeAssets(assets?: ModelAsset[]) {
  if (typeof caches === "undefined") return;
  if (!assets) {
    await Promise.all(modelCaches().map((name) => caches.delete(name)));
    return;
  }
  await Promise.all(assets.map(async (a) => (await cacheOf(a)).delete(keyOf(a))));
}

/** Deletes cached files that no current asset points to (left over from an older app version). */
export async function pruneStale() {
  if (typeof caches === "undefined") return;
  const current = new Set([...Object.values(MODEL_ASSETS), ...AI_ASSETS].map(keyOf));
  for (const name of modelCaches()) {
    const cache = await caches.open(name);
    await Promise.all((await cache.keys()).filter((r) => !current.has(r.url)).map((r) => cache.delete(r)));
  }
}
