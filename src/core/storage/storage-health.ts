/**
 * Storage Health
 * Wraps the browser StorageManager API: how much space Salin uses and may use,
 * whether storage is persistent (protected from automatic eviction), asking for
 * persistence, and refusing writes that clearly won't fit.
 */

import { WorkspaceError, QUOTA_MESSAGE } from "./errors";

/** Show a storage warning once usage passes this share of the quota. */
export const STORAGE_WARNING_RATIO = 0.8;

// Leave headroom for IndexedDB overhead and the app's own caches.
const SAFETY_MARGIN_BYTES = 8 * 1024 * 1024;

export interface StorageStatus {
  /** False when the browser has no StorageManager estimate (old browsers, some WebViews). */
  supported: boolean;
  usage: number;
  quota: number;
  /** `null` when the browser can't report persistence. */
  persisted: boolean | null;
}

function storageManager(): StorageManager | undefined {
  return typeof navigator !== "undefined" ? navigator.storage : undefined;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const storage = storageManager();
  if (!storage?.estimate) return { supported: false, usage: 0, quota: 0, persisted: null };
  const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
    storage.estimate(),
    storage.persisted ? storage.persisted().catch(() => null) : Promise.resolve(null),
  ]);
  return { supported: true, usage, quota, persisted };
}

export function isStorageLow(status: StorageStatus) {
  return status.supported && status.quota > 0 && status.usage / status.quota >= STORAGE_WARNING_RATIO;
}

/**
 * Asks the browser to keep Salin's data even under storage pressure. Chrome
 * decides silently (installed apps and engaged sites are granted); Firefox may
 * show a prompt. Returns whether storage is now persistent.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = storageManager();
  if (!storage?.persist) return false;
  try {
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Throws a quota error before a write of `bytes` that the estimate says can't fit. */
export async function ensureSpaceFor(bytes: number) {
  const status = await getStorageStatus().catch(() => null);
  if (!status?.supported || status.quota === 0) return;
  if (status.usage + bytes + SAFETY_MARGIN_BYTES > status.quota) {
    throw new WorkspaceError("quota", QUOTA_MESSAGE);
  }
}
