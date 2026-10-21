/**
 * AI Model Catalog
 * The optional on-device AI models Salin can download, chosen by benchmark
 * (see docs/PHASE5_AI.md): a handwriting recognizer (PaddleOCR PP-OCRv5
 * English, 7.8 MB, run with ONNX Runtime Web) and a small instruction-
 * following language model for the assistant (run with Transformers.js),
 * with a larger build for WebGPU laptops and desktops.
 * Each file is pinned to an exact model revision and byte size, so what is
 * downloaded is what was tested, and its integrity can be checked. Model
 * files come only from the configured model host (Hugging Face by default;
 * set VITE_AI_MODEL_HOST to self-host them); the shared ONNX Runtime engine
 * ships with Salin itself. Also the processing modes (Standard, AI Lite,
 * AI Advanced) and which one suits a device.
 */

import runtimeUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import laptopLibUrl from "@/core/ai/webllm/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm?url";
// The WebLLM engine (one self-contained module), downloaded only for the laptop build.
import webllmEngineUrl from "@mlc-ai/web-llm/lib/index.js?url";

import type { DeviceCapabilities } from "@/core/ocr/models/capabilities";
import type { ModelAsset } from "@/core/ocr/models/model-assets";

/** Where model files are downloaded from. Only this host (and Salin's own site) is ever contacted for models. */
export const AI_MODEL_HOST = ((import.meta.env?.VITE_AI_MODEL_HOST as string | undefined) || "https://huggingface.co").replace(/\/+$/, "");

/** True for Salin's own site and the configured model host. */
export function isApprovedModelUrl(url: string) {
  const origin = new URL(url, location.href).origin;
  return origin === new URL(location.href).origin || origin === new URL(AI_MODEL_HOST).origin;
}

/** A file in a model repository at a pinned revision, as Transformers.js addresses it. */
const hub = (repo: string, revision: string, file: string) => `${AI_MODEL_HOST}/${repo}/resolve/${revision}/${file}`;

/** ONNX Runtime Web's engine (WebAssembly, with WebGPU support), shared by both models. Served by Salin. */
export const AI_RUNTIME: ModelAsset = { id: "ai-runtime", label: "AI engine (ONNX Runtime Web)", kind: "ai", url: runtimeUrl, bytes: 26_861_777 };

export type AiModelId = "handwriting" | "assistant";
export type AiDevice = "wasm" | "webgpu";

export interface AiModelVariant {
  device: AiDevice;
  /** Transformers.js weight format (language model only). */
  dtype?: "q4f16" | "q4";
  /** A larger build for laptops and desktops: another repository at its own pinned revision (the model's when absent). */
  repo?: string;
  revision?: string;
  laptop?: boolean;
  /** Runs through WebLLM (MLC's compiled WebGPU code) instead of Transformers.js, as this WebLLM model id. */
  webllm?: string;
  assets: ModelAsset[];
}

export interface AiModel {
  id: AiModelId;
  name: string;
  purpose: string;
  capabilities: string[];
  languages: string;
  license: string;
  /** Repository and pinned revision. */
  repo: string;
  revision: string;
  requirements: string;
  /** Below this much device memory (when the browser reports it) the model isn't offered. */
  minMemoryGb: number;
  variants: AiModelVariant[];
}

const HANDWRITING_REPO = "PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx";
const HANDWRITING_REVISION = "3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b";
const ASSISTANT_REPO = "onnx-community/Qwen3-0.6B-ONNX";
const ASSISTANT_REVISION = "58ca03a5e7b354b480b1a82b34bde8dc7b854cc0";

const LAPTOP_REPO = "mlc-ai/Qwen3-1.7B-q4f16_1-MLC";
const LAPTOP_REVISION = "80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc";
/** Sizes of the laptop build's 30 weight shards, params_shard_0.bin onwards. */
const LAPTOP_SHARDS = [155_582_464, 26_529_792, ...Array<number>(27).fill(28_320_256), 21_242_368];

const assistantFile = (file: string, bytes: number, label = "Assistant model settings"): ModelAsset => ({ id: `assistant:${file}`, label, kind: "ai", url: hub(ASSISTANT_REPO, ASSISTANT_REVISION, file), bytes });
// WebLLM reads each file from its own cache by this URL, so Salin stores them there.
const laptopFile = (file: string, bytes: number, label: string, cache = "webllm/model"): ModelAsset => ({ id: `assistant-laptop:${file}`, label, kind: "ai", url: hub(LAPTOP_REPO, LAPTOP_REVISION, file), bytes, cache });
const ASSISTANT_SHARED = [
  assistantFile("config.json", 912),
  assistantFile("generation_config.json", 219),
  assistantFile("tokenizer.json", 9_117_040, "Assistant vocabulary"),
  assistantFile("tokenizer_config.json", 10_369),
];

export const AI_MODELS: Record<AiModelId, AiModel> = {
  handwriting: {
    id: "handwriting",
    name: "Handwriting reader",
    purpose: "Reads handwritten values in form fields and table cells, one box at a time, and suggests them for review.",
    capabilities: ["Handwritten names, places, numbers and dates", "Printed text Tesseract found hard to read", "Gives a confidence for every reading"],
    languages: "English letters, digits and accents (ñ, é…) — Filipino names and places included",
    license: "Apache-2.0 (PaddleOCR PP-OCRv5)",
    repo: HANDWRITING_REPO,
    revision: HANDWRITING_REVISION,
    requirements: "Any device that runs text recognition. About 100 MB of memory while reading.",
    minMemoryGb: 2,
    variants: [
      {
        device: "wasm",
        assets: [AI_RUNTIME, { id: "handwriting:inference.onnx", label: "Handwriting model", kind: "ai", url: hub(HANDWRITING_REPO, HANDWRITING_REVISION, "inference.onnx"), bytes: 7_848_423 }],
      },
    ],
  },
  assistant: {
    id: "assistant",
    name: "On-device assistant",
    purpose: "Turns plain-language requests into dataset actions, suggests fixes for recognition slips, finds requested fields and matches labels — always as suggestions you approve.",
    capabilities: ["Questions like “how many customers per city?”", "OCR correction suggestions", "Finding requested fields on generic forms", "Matching Filipino labels to template fields"],
    languages: "English and Filipino (Tagalog/Taglish) requests",
    license: "Apache-2.0 (Qwen3-0.6B; Qwen3-1.7B on laptops, run with WebLLM)",
    repo: ASSISTANT_REPO,
    revision: ASSISTANT_REVISION,
    requirements: "Best with WebGPU (most recent Chrome on Android 12+ and desktops). Without WebGPU it runs on the CPU, slowly. Needs about 1.5 GB of free memory. Laptops and desktops with WebGPU and 8 GB of memory get a larger, more accurate build (about 1 GB, run with WebLLM).",
    minMemoryGb: 4,
    variants: [
      {
        device: "webgpu",
        dtype: "q4f16",
        assets: [AI_RUNTIME, ...ASSISTANT_SHARED, assistantFile("onnx/model_q4f16.onnx", 569_789_750, "Assistant model (GPU build)")],
      },
      {
        // Benchmarked higher on unseen wordings (docs/PHASE5_AI.md); WebGPU laptops and desktops only — too big for phone memory.
        // Through WebLLM: ~25 s per answer on Intel UHD graphics, where ONNX Runtime took minutes (and can't load Qwen3-1.7B's single 1.4 GB .onnx).
        device: "webgpu",
        repo: LAPTOP_REPO,
        revision: LAPTOP_REVISION,
        laptop: true,
        webllm: "Qwen3-1.7B-q4f16_1-MLC",
        assets: [
          { id: "assistant-laptop:engine", label: "WebLLM engine", kind: "ai", url: webllmEngineUrl, bytes: 6_586_947 },
          // MLC's compiled GPU code for this model (Apache-2.0, binary-mlc-llm-libs @ 025bcaf), served by Salin.
          { id: "assistant-laptop:lib", label: "Assistant GPU code (laptop build)", kind: "ai", url: laptopLibUrl, bytes: 5_566_554, cache: "webllm/wasm" },
          laptopFile("mlc-chat-config.json", 2_075, "Assistant model settings (laptop build)", "webllm/config"),
          laptopFile("tensor-cache.json", 134_335, "Assistant model settings (laptop build)"),
          laptopFile("tokenizer.json", 11_422_654, "Assistant vocabulary (laptop build)"),
          ...LAPTOP_SHARDS.map((bytes, i) => laptopFile(`params_shard_${i}.bin`, bytes, "Assistant model weights (laptop build, Qwen3-1.7B)")),
        ],
      },
      {
        device: "wasm",
        dtype: "q4",
        assets: [AI_RUNTIME, ...ASSISTANT_SHARED, assistantFile("onnx/model_q4.onnx", 919_096_585, "Assistant model (CPU build)")],
      },
    ],
  },
};

/** Every AI file Salin knows (so the model manager keeps them and removes anything else). */
export const AI_ASSETS: ModelAsset[] = [...new Map(Object.values(AI_MODELS).flatMap((m) => m.variants.flatMap((v) => v.assets)).map((a) => [a.url, a])).values()];

/** Laptop builds need WebGPU, a non-mobile browser and 8 GB of reported memory (Chromium's maximum; other browsers report none and get the regular build). */
const LAPTOP_MEMORY_GB = 8;

/** The build of a model this device should download: the GPU build when WebGPU can run it, the larger laptop build on laptops and desktops. */
export function variantFor(model: AiModel, caps: Pick<DeviceCapabilities, "webGpu" | "webGpuF16" | "mobile" | "deviceMemoryGb"> | null): AiModelVariant {
  const gpu = caps?.webGpu === "available" && caps.webGpuF16;
  const laptop = gpu && !caps.mobile && (caps.deviceMemoryGb ?? 0) >= LAPTOP_MEMORY_GB;
  const device = gpu ? "webgpu" : "wasm";
  return (laptop && model.variants.find((v) => v.laptop)) || model.variants.find((v) => v.device === device && !v.laptop) || model.variants[0];
}

/** The repository and pinned revision a build is loaded from. */
export const variantSource = (model: AiModel, variant: AiModelVariant) => ({ repo: variant.repo ?? model.repo, revision: variant.revision ?? model.revision });

/** Why a model can't run on this device, or `null` when it can. */
export function modelUnavailableReason(model: AiModel, caps: DeviceCapabilities): string | null {
  if (!caps.webAssembly || !caps.workers) return "This browser can't run on-device AI (it needs WebAssembly and background workers).";
  if (!caps.cacheStorage) return "This browser can't store AI models offline (Cache Storage is unavailable — private browsing?).";
  if (caps.deviceMemoryGb !== null && caps.deviceMemoryGb < model.minMemoryGb) return `This device reports about ${caps.deviceMemoryGb} GB of memory; the ${model.name.toLowerCase()} needs ${model.minMemoryGb} GB or more.`;
  return null;
}

/* ------------------------------------------------------------------
   Processing modes
------------------------------------------------------------------- */

export type AiMode = "standard" | "lite" | "advanced";

export const AI_MODES: Record<AiMode, { label: string; description: string; models: AiModelId[] }> = {
  standard: { label: "Standard", description: "Text recognition, templates and rule-based checks. No AI downloads.", models: [] },
  lite: { label: "AI Lite", description: "Adds the handwriting reader (about 35 MB). Suits most phones.", models: ["handwriting"] },
  advanced: { label: "AI Advanced", description: "Adds the on-device assistant (about 600 MB; 1 GB on laptops) for plain-language questions, requests and suggestions. Experimental; needs a strong device.", models: ["handwriting", "assistant"] },
};

export interface AiModeChoice {
  mode: AiMode;
  reason: string;
}

/**
 * The mode a device can comfortably run, from what it reports and, when an
 * AI benchmark was run, how fast the assistant answered (seconds per request).
 */
export function recommendAiMode(caps: DeviceCapabilities, assistantSeconds?: number | null): AiModeChoice {
  if (modelUnavailableReason(AI_MODELS.handwriting, caps)) return { mode: "standard", reason: modelUnavailableReason(AI_MODELS.handwriting, caps)! };
  const memory = caps.deviceMemoryGb;
  if (typeof assistantSeconds === "number") {
    return assistantSeconds <= 15
      ? { mode: "advanced", reason: `The assistant answered in ${assistantSeconds.toFixed(1)} s on this device.` }
      : { mode: "lite", reason: `The assistant took ${assistantSeconds.toFixed(1)} s per answer here — too slow to be pleasant, so only handwriting is on.` };
  }
  if (memory !== null && memory < AI_MODELS.assistant.minMemoryGb) return { mode: "lite", reason: `About ${memory} GB of memory — enough for the handwriting reader, not the assistant.` };
  if (caps.webGpu === "available" && (memory === null || memory >= 6)) return { mode: "advanced", reason: "WebGPU and enough memory for the assistant." };
  return { mode: "lite", reason: caps.webGpu === "available" ? "The assistant needs about 6 GB of memory to run well." : "No WebGPU: the assistant would run slowly on the CPU. Run the AI benchmark to check." };
}
