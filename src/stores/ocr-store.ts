/**
 * OCR Store
 * Text-recognition settings and status shared by Settings and the scan
 * screens: the chosen profile (Auto, Standard or Accurate) and languages
 * (saved in this browser), the device's detected capabilities, whether the
 * needed model files are on this device, and a running download's progress
 * — so a download started in one place shows everywhere and can be cancelled.
 */

import { create } from "zustand";

import { detectCapabilities, ocrUnavailableReason, recommendProfile, type DeviceCapabilities, type ProfileChoice } from "@/core/ocr/models/capabilities";
import { MODEL_ASSETS, requiredAssets, totalBytes, type ModelAsset } from "@/core/ocr/models/model-assets";
import { checkAssets, downloadAssets, ModelError, removeAssets, storedBytes } from "@/core/ocr/models/model-manager";
import { ocrRuntime } from "@/core/ocr/engine/ocr-runtime";
import { errorMessage } from "@/core/storage/errors";
import type { OcrProfileId } from "@/types/ocr";

export type ProfileSetting = "auto" | OcrProfileId;

interface Preferences {
  profile: ProfileSetting;
  languages: string[];
}

const KEY = "salin.ocr";
const DEFAULTS: Preferences = { profile: "auto", languages: ["eng"] };

function read(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
    return {
      profile: saved.profile === "standard" || saved.profile === "accurate" ? saved.profile : "auto",
      languages: Array.isArray(saved.languages) && saved.languages.every((l) => typeof l === "string") ? [...new Set(["eng", ...saved.languages])] : DEFAULTS.languages,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(preferences: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
}

export type ModelState =
  | { status: "checking" }
  | { status: "missing"; bytes: number }
  | { status: "downloading"; loaded: number; total: number; label: string }
  | { status: "ready"; bytes: number }
  | { status: "error"; message: string; offline: boolean }
  | { status: "unsupported"; message: string };

interface OcrState extends Preferences {
  caps: DeviceCapabilities | null;
  /** Seconds per page from the last benchmark on this device, if any. */
  benchmarkSeconds: number | null;
  model: ModelState;
  storedBytes: number;
  setProfile: (profile: ProfileSetting) => void;
  setLanguages: (languages: string[]) => void;
  setBenchmarkSeconds: (seconds: number | null) => void;
  /** Detects capabilities (once) and refreshes the model status. */
  refresh: () => Promise<void>;
  download: () => Promise<boolean>;
  cancelDownload: () => void;
  removeModels: () => Promise<void>;
}

let downloadController: AbortController | null = null;

/** Text-recognition files only (the AI models share the cache and are managed by the AI store). */
const OCR_ASSETS = Object.values(MODEL_ASSETS);

export const useOcrStore = create<OcrState>()((set, get) => ({
  ...read(),
  caps: null,
  benchmarkSeconds: null,
  model: { status: "checking" },
  storedBytes: 0,

  setProfile: (profile) => {
    set({ profile });
    save({ profile, languages: get().languages });
  },
  setLanguages: (languages) => {
    const next = [...new Set(["eng", ...languages])];
    set({ languages: next });
    save({ profile: get().profile, languages: next });
    void get().refresh();
  },
  setBenchmarkSeconds: (benchmarkSeconds) => set({ benchmarkSeconds }),

  refresh: async () => {
    const caps = get().caps ?? (await detectCapabilities());
    if (!get().caps) set({ caps });
    const unavailable = ocrUnavailableReason(caps);
    if (unavailable) {
      set({ model: { status: "unsupported", message: unavailable } });
      return;
    }
    if (get().model.status === "downloading") return;
    try {
      const assets = requiredAssets(caps, get().languages);
      const status = await checkAssets(assets);
      const missing = status.filter((s) => !s.ready).map((s) => s.asset);
      set({
        model: missing.length ? { status: "missing", bytes: totalBytes(missing) } : { status: "ready", bytes: totalBytes(assets) },
        storedBytes: await storedBytes(OCR_ASSETS),
      });
    } catch (error) {
      set({ model: { status: "error", message: errorMessage(error, "The recognition files couldn't be checked."), offline: false } });
    }
  },

  download: async () => {
    const caps = get().caps ?? (await detectCapabilities());
    const assets: ModelAsset[] = requiredAssets(caps, get().languages);
    downloadController?.abort();
    downloadController = new AbortController();
    set({ model: { status: "downloading", loaded: 0, total: totalBytes(assets), label: assets[0].label } });
    try {
      await downloadAssets(assets, {
        signal: downloadController.signal,
        onProgress: ({ loaded, total, asset }) => set({ model: { status: "downloading", loaded, total, label: asset.label } }),
      });
      set({ model: { status: "ready", bytes: totalBytes(assets) }, storedBytes: await storedBytes(OCR_ASSETS) });
      return true;
    } catch (error) {
      if (downloadController?.signal.aborted) {
        set({ model: { status: "checking" } });
        await get().refresh();
        return false;
      }
      const offline = error instanceof ModelError && error.code === "offline-missing";
      set({ model: { status: "error", message: error instanceof ModelError ? error.message : errorMessage(error, "The download didn't finish. Check your connection and try again."), offline } });
      return false;
    } finally {
      downloadController = null;
    }
  },

  cancelDownload: () => downloadController?.abort(),

  removeModels: async () => {
    // Stop the engine first so no read is using the files being deleted.
    await ocrRuntime.shutdown();
    await removeAssets(OCR_ASSETS);
    set({ storedBytes: 0, model: { status: "checking" } });
    await get().refresh();
  },
}));

/** The profile to use now: the chosen one, or the recommendation for this device. */
export function effectiveProfile(state: Pick<OcrState, "profile" | "caps" | "benchmarkSeconds">): ProfileChoice {
  if (state.profile !== "auto") return { profile: state.profile, reason: "Chosen in Settings." };
  if (!state.caps) return { profile: "standard", reason: "Checking this device…" };
  return recommendProfile(state.caps, state.benchmarkSeconds);
}

/** The profile choice as a hook (selects plain values, so components don't re-render in a loop). */
export function useProfileChoice(): ProfileChoice {
  const profile = useOcrStore((s) => s.profile);
  const caps = useOcrStore((s) => s.caps);
  const benchmarkSeconds = useOcrStore((s) => s.benchmarkSeconds);
  return effectiveProfile({ profile, caps, benchmarkSeconds });
}
