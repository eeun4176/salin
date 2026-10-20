/**
 * AI Store
 * On-device AI settings and status shared by Settings and every screen
 * that offers AI suggestions: the chosen processing mode (Auto, Standard,
 * AI Lite or AI Advanced — saved in this browser), the recommendation for
 * this device, and each optional model's state (not downloaded, downloading
 * with progress, ready, damaged or unavailable), so a download started in
 * one place shows everywhere and can be cancelled. Removing a model keeps
 * the shared AI engine while the other model still needs it.
 */

import { useEffect } from "react";
import { create } from "zustand";

import { AI_MODELS, AI_RUNTIME, modelUnavailableReason, recommendAiMode, variantFor, type AiMode, type AiModeChoice, type AiModelId, type AiModelVariant } from "@/core/ai/ai-models";
import { aiRuntime } from "@/core/ai/ai-runtime";
import { detectCapabilities, type DeviceCapabilities } from "@/core/ocr/models/capabilities";
import { totalBytes } from "@/core/ocr/models/model-assets";
import { checkAssets, downloadAssets, ModelError, removeAssets, storedBytes, verifyAssets } from "@/core/ocr/models/model-manager";
import { errorMessage } from "@/core/storage/errors";
import { useOcrStore, type ModelState } from "@/stores/ocr-store";

export type AiModeSetting = "auto" | AiMode;

const KEY = "salin.ai";

function readSetting(): AiModeSetting {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { mode?: string };
    return saved.mode === "standard" || saved.mode === "lite" || saved.mode === "advanced" ? saved.mode : "auto";
  } catch {
    return "auto";
  }
}

const MODEL_IDS = Object.keys(AI_MODELS) as AiModelId[];

interface AiState {
  setting: AiModeSetting;
  caps: DeviceCapabilities | null;
  /** Seconds per assistant answer from the last AI benchmark on this device, if any. */
  assistantSeconds: number | null;
  models: Record<AiModelId, ModelState>;
  stored: Record<AiModelId, number>;
  setSetting: (setting: AiModeSetting) => void;
  setAssistantSeconds: (seconds: number | null) => void;
  /** Detects capabilities (once) and checks which model files are stored. */
  refresh: () => Promise<void>;
  download: (id: AiModelId) => Promise<boolean>;
  cancelDownload: (id: AiModelId) => void;
  remove: (id: AiModelId) => Promise<void>;
  /** Deep-checks stored files; damaged ones are removed. Resolves to a message for the user. */
  verify: (id: AiModelId) => Promise<string>;
}

const controllers = new Map<AiModelId, AbortController>();
let refreshing: Promise<void> | null = null;

async function capabilities() {
  return useAiStore.getState().caps ?? useOcrStore.getState().caps ?? (await detectCapabilities());
}

const setModel = (id: AiModelId, state: ModelState, stored?: number) =>
  useAiStore.setState((s) => ({ models: { ...s.models, [id]: state }, ...(stored === undefined ? {} : { stored: { ...s.stored, [id]: stored } }) }));

async function checkModels() {
  const caps = await capabilities();
  if (!useAiStore.getState().caps) useAiStore.setState({ caps });
  for (const id of MODEL_IDS) {
    const model = AI_MODELS[id];
    const unavailable = modelUnavailableReason(model, caps);
    if (unavailable) {
      setModel(id, { status: "unsupported", message: unavailable });
      continue;
    }
    if (useAiStore.getState().models[id].status === "downloading") continue;
    try {
      const assets = variantFor(model, caps).assets;
      const missing = (await checkAssets(assets)).filter((s) => !s.ready).map((s) => s.asset);
      const stored = await storedBytes(assets.filter((a) => a.id !== AI_RUNTIME.id));
      setModel(id, missing.length ? { status: "missing", bytes: totalBytes(missing) } : { status: "ready", bytes: totalBytes(assets) }, stored);
    } catch (error) {
      setModel(id, { status: "error", message: errorMessage(error, "The AI files couldn't be checked."), offline: false });
    }
  }
}

export const useAiStore = create<AiState>()((set, get) => ({
  setting: readSetting(),
  caps: null,
  assistantSeconds: null,
  models: { handwriting: { status: "checking" }, assistant: { status: "checking" } },
  stored: { handwriting: 0, assistant: 0 },

  setSetting: (setting) => {
    set({ setting });
    try {
      localStorage.setItem(KEY, JSON.stringify({ mode: setting }));
    } catch {
      // Storage blocked: the choice still applies for this visit.
    }
  },
  setAssistantSeconds: (assistantSeconds) => set({ assistantSeconds }),

  refresh: () => (refreshing ??= checkModels().finally(() => (refreshing = null))),

  download: async (id) => {
    const assets = variantFor(AI_MODELS[id], await capabilities()).assets;
    controllers.get(id)?.abort();
    const controller = new AbortController();
    controllers.set(id, controller);
    setModel(id, { status: "downloading", loaded: 0, total: totalBytes(assets), label: assets[0].label });
    try {
      await downloadAssets(assets, {
        signal: controller.signal,
        onProgress: ({ loaded, total, asset }) => setModel(id, { status: "downloading", loaded, total, label: asset.label }),
      });
      setModel(id, { status: "ready", bytes: totalBytes(assets) });
      await get().refresh();
      return true;
    } catch (error) {
      if (controller.signal.aborted) {
        setModel(id, { status: "checking" });
        await get().refresh();
        return false;
      }
      const offline = error instanceof ModelError && error.code === "offline-missing";
      const message = error instanceof ModelError ? error.message : errorMessage(error, "The download didn't finish. Check your connection and try again — files already downloaded are kept.");
      setModel(id, { status: "error", message, offline });
      return false;
    } finally {
      if (controllers.get(id) === controller) controllers.delete(id);
    }
  },

  cancelDownload: (id) => controllers.get(id)?.abort(),

  remove: async (id) => {
    await aiRuntime.unload();
    const others = MODEL_IDS.filter((m) => m !== id && get().models[m].status === "ready");
    // Every build of the model (a device may have switched builds); the shared engine only if nothing else uses it.
    await removeAssets(AI_MODELS[id].variants.flatMap((v) => v.assets).filter((a) => a.id !== AI_RUNTIME.id || others.length === 0));
    setModel(id, { status: "checking" }, 0);
    await get().refresh();
  },

  verify: async (id) => {
    const damaged = await verifyAssets(variantFor(AI_MODELS[id], await capabilities()).assets);
    await get().refresh();
    return damaged.length ? `${damaged.length} damaged file${damaged.length === 1 ? " was" : "s were"} removed — download again to repair.` : "All files are complete and ready offline.";
  },
}));

/** The mode in effect: the chosen one, or the recommendation for this device. */
export function effectiveAiMode(state: Pick<AiState, "setting" | "caps" | "assistantSeconds">): AiModeChoice {
  if (state.setting !== "auto") return { mode: state.setting, reason: "Chosen in Settings." };
  if (!state.caps) return { mode: "standard", reason: "Checking this device…" };
  return recommendAiMode(state.caps, state.assistantSeconds);
}

export function useAiMode(): AiModeChoice {
  const setting = useAiStore((s) => s.setting);
  const caps = useAiStore((s) => s.caps);
  const assistantSeconds = useAiStore((s) => s.assistantSeconds);
  return effectiveAiMode({ setting, caps, assistantSeconds });
}

export interface AiFeature {
  /** The model is downloaded and the mode includes it. */
  ready: boolean;
  /** Why it isn't ready, for a hint next to the disabled control. */
  reason: string | null;
  variant: AiModelVariant;
}

/** Whether a model can be used right now (checks the device and stored files on first use). */
export function useAiFeature(id: AiModelId): AiFeature {
  const { mode } = useAiMode();
  const state = useAiStore((s) => s.models[id]);
  const caps = useAiStore((s) => s.caps);
  const refresh = useAiStore((s) => s.refresh);
  useEffect(() => {
    if (state.status === "checking") void refresh();
  }, [state.status, refresh]);
  const variant = variantFor(AI_MODELS[id], caps);
  const included = mode === "advanced" || (mode === "lite" && id === "handwriting");
  if (state.status === "unsupported") return { ready: false, reason: state.message, variant };
  if (!included) return { ready: false, reason: `Turn on ${id === "handwriting" ? "AI Lite or AI Advanced" : "AI Advanced"} in Settings → On-device AI.`, variant };
  if (state.status !== "ready") return { ready: false, reason: `Download the ${AI_MODELS[id].name.toLowerCase()} in Settings → On-device AI.`, variant };
  return { ready: true, reason: null, variant };
}
