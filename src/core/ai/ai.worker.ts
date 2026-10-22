/**
 * AI Worker
 * Runs the on-device AI models off the main thread, so the screen never
 * freezes: the handwriting recognizer (an ONNX model run directly with ONNX
 * Runtime Web) and the assistant language model (Transformers.js on the same
 * ONNX Runtime, on WebGPU or the CPU; on laptops, WebLLM on WebGPU). Only one
 * model is kept in memory at a time — loading one unloads the other. Every
 * file is read from the model caches Salin filled; this worker fetches
 * nothing from the network, and only text and pixel data (never documents)
 * come in.
 */

/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/webgpu";
// The engine's small JS loader ships with the app (precached for offline use); the 27 MB engine itself comes from the model cache.
import engineLoaderUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";

import { decodeLine, decodeSlots, LINE_HEIGHT, lineTensor, type LineReading, type LineSlot } from "@/core/ai/handwriting";
import type { ChatMessage } from "@/core/ai/llm-tasks";

export interface LineCrop {
  /** RGBA pixels already scaled to LINE_HEIGHT × width. */
  pixels: Uint8ClampedArray;
  width: number;
  /** Letter boxes in the crop: read exactly one allowed character in each. */
  slots?: LineSlot[];
  /** An open line: only these characters can be read. */
  allowed?: string;
  /** An open line: where the ink shows gaps between words (0–1 across the crop). */
  gaps?: number[];
}

export type AiWorkerRequest =
  | { id: number; type: "read-lines"; cacheName: string; runtimeKey: string; modelKey: string; crops: LineCrop[] }
  | {
      id: number;
      type: "generate";
      cacheName: string;
      runtimeKey: string;
      host: string;
      repo: string;
      revision: string;
      dtype: "q4f16" | "q4";
      device: "webgpu" | "wasm";
      messages: ChatMessage[];
      maxNewTokens: number;
    }
  | {
      id: number;
      type: "generate-webllm";
      /** The WebLLM engine module in Salin's cache; the pinned model folder URL, WebLLM model id and its compiled GPU code (in WebLLM's caches). */
      engine: { cache: string; key: string };
      model: string;
      modelId: string;
      modelLib: string;
      files: { cache: string; key: string }[];
      messages: ChatMessage[];
      maxNewTokens: number;
    }
  | { id: number; type: "unload" };

export type AiWorkerMessage =
  | { id: number; type: "progress"; stage: "loading" | "running"; fraction: number | null; tokens?: number }
  | { id: number; type: "result"; result: unknown }
  | { id: number; type: "error"; code: "missing-files" | "memory" | "failed"; message: string };

class MissingFiles extends Error {}

const scope = self as unknown as DedicatedWorkerGlobalScope;

let lineModel: { key: string; session: ort.InferenceSession } | null = null;
type Transformers = typeof import("@huggingface/transformers");
let assistant: { key: string; tokenizer: Awaited<ReturnType<Transformers["AutoTokenizer"]["from_pretrained"]>>; model: Awaited<ReturnType<Transformers["AutoModelForCausalLM"]["from_pretrained"]>> } | null = null;
type WebLlm = typeof import("@mlc-ai/web-llm");
let webllm: { key: string; engine: Awaited<ReturnType<WebLlm["CreateMLCEngine"]>> } | null = null;
let runtimeKey = "";

async function cached(cacheName: string, key: string): Promise<Response> {
  const response = await (await caches.open(cacheName)).match(key);
  if (!response) throw new MissingFiles(key);
  return response;
}

/** The ONNX Runtime engine from the cache (never from a CDN). */
async function ensureRuntime(cacheName: string, key: string) {
  if (runtimeKey === key) return;
  ort.env.wasm.wasmBinary = await (await cached(cacheName, key)).arrayBuffer();
  ort.env.wasm.wasmPaths = { mjs: engineLoaderUrl };
  runtimeKey = key;
}

async function unloadAssistant() {
  const current = assistant;
  const llm = webllm;
  assistant = null;
  webllm = null;
  await current?.model.dispose();
  await llm?.engine.unload().catch(() => undefined);
}

async function unloadLines() {
  const current = lineModel;
  lineModel = null;
  await current?.session.release();
}

async function readLines(request: Extract<AiWorkerRequest, { type: "read-lines" }>, progress: (fraction: number) => void): Promise<(LineReading & { empty: boolean })[]> {
  await unloadAssistant();
  await ensureRuntime(request.cacheName, request.runtimeKey);
  if (lineModel?.key !== request.modelKey) {
    await unloadLines();
    const bytes = new Uint8Array(await (await cached(request.cacheName, request.modelKey)).arrayBuffer());
    lineModel = { key: request.modelKey, session: await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] }) };
  }
  const { session } = lineModel;
  const out: (LineReading & { empty: boolean })[] = [];
  for (const [i, crop] of request.crops.entries()) {
    const input = lineTensor(crop.pixels, crop.width);
    if (!input) out.push({ text: "", confidence: 0, empty: true });
    else {
      const result = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, LINE_HEIGHT, crop.width]) });
      const probs = result[session.outputNames[0]];
      const data = probs.data as Float32Array;
      out.push({ ...(crop.slots?.length ? decodeSlots(data, probs.dims[1], probs.dims[2], crop.slots) : decodeLine(data, probs.dims[1], probs.dims[2], undefined, crop.allowed, crop.gaps)), empty: false });
      probs.dispose();
    }
    progress((i + 1) / request.crops.length);
  }
  return out;
}

async function generate(request: Extract<AiWorkerRequest, { type: "generate" }>, progress: (stage: "loading" | "running", fraction: number | null, tokens?: number) => void): Promise<string> {
  await unloadLines();
  await ensureRuntime(request.cacheName, request.runtimeKey);
  const tf = await import("@huggingface/transformers");
  const cache = await caches.open(request.cacheName);
  // Transformers.js checks for tokenizer_config.json at the "main" revision even when a revision is pinned;
  // Salin stores the pinned files, so "main" lookups for this model are served from them.
  const pinned = (key: string) => key.replace(`/${request.repo}/resolve/main/`, `/${request.repo}/resolve/${request.revision}/`);
  // Every model file comes from Salin's model cache; any attempt to fetch fails.
  Object.assign(tf.env, {
    allowLocalModels: false,
    allowRemoteModels: true,
    remoteHost: request.host,
    remotePathTemplate: "{model}/resolve/{revision}/",
    useBrowserCache: false,
    useWasmCache: false,
    useCustomCache: true,
    customCache: { match: (key: string) => cache.match(pinned(String(key))), put: async () => undefined },
    fetch: async (url: string) => {
      throw new MissingFiles(String(url));
    },
  });

  const key = `${request.repo}@${request.revision}:${request.dtype}:${request.device}`;
  if (assistant?.key !== key) {
    await unloadAssistant();
    const files = new Map<string, number>();
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file || !p.total) return;
      files.set(p.file, (p.loaded ?? 0) / p.total);
      progress("loading", [...files.values()].reduce((a, b) => a + b, 0) / Math.max(files.size, 4));
    };
    const tokenizer = await tf.AutoTokenizer.from_pretrained(request.repo, { revision: request.revision, progress_callback });
    const model = await tf.AutoModelForCausalLM.from_pretrained(request.repo, { revision: request.revision, dtype: request.dtype, device: request.device, progress_callback });
    assistant = { key, tokenizer, model };
  }

  const { tokenizer, model } = assistant!;
  // enable_thinking: models with a reasoning mode (Qwen3) answer directly; the template gets extra options as variables.
  const options = { add_generation_prompt: true, return_dict: true, enable_thinking: false } as { add_generation_prompt: boolean; return_dict: true };
  const inputs = tokenizer.apply_chat_template(request.messages, options) as unknown as Record<string, unknown> & { input_ids: { dims: number[] } };
  const promptLength = inputs.input_ids.dims.at(-1)!;
  if (promptLength + request.maxNewTokens > 4096) throw new Error("The request exceeds the assistant context. Select fewer columns or ask about a specific page.");
  let tokens = 0;
  const streamer = new tf.TextStreamer(tokenizer, { skip_prompt: true, token_callback_function: () => progress("running", null, ++tokens) });
  const output = (await model.generate({ ...inputs, max_new_tokens: request.maxNewTokens, do_sample: false, streamer })) as { slice: (...args: unknown[]) => unknown };
  return tokenizer.batch_decode(output.slice(null, [promptLength, null]) as never, { skip_special_tokens: true })[0];
}

/**
 * The laptop assistant through WebLLM. WebLLM fetches only files missing from
 * its caches, so every file is checked first: a missing one stops here
 * instead of being downloaded.
 */
async function generateWebLlm(request: Extract<AiWorkerRequest, { type: "generate-webllm" }>, progress: (stage: "loading" | "running", fraction: number | null) => void): Promise<string> {
  await unloadLines();
  if (webllm?.key !== request.model) {
    await unloadAssistant();
    for (const file of request.files) await cached(file.cache, file.key);
    // The engine module comes from the cache too (it's 6.6 MB, so it isn't part of the app shell).
    const engineUrl = URL.createObjectURL(await (await cached(request.engine.cache, request.engine.key)).blob());
    const { CreateMLCEngine } = (await import(/* @vite-ignore */ engineUrl).finally(() => URL.revokeObjectURL(engineUrl))) as WebLlm;
    const appConfig = { model_list: [{ model: request.model, model_id: request.modelId, model_lib: request.modelLib, overrides: { context_window_size: 4096 } }], cacheBackend: "cache" as const };
    webllm = { key: request.model, engine: await CreateMLCEngine(request.modelId, { appConfig, initProgressCallback: (p) => progress("loading", p.progress) }) };
  }
  progress("running", null);
  try {
    const reply = await webllm.engine.chat.completions.create({ messages: request.messages, temperature: 0, max_tokens: request.maxNewTokens, extra_body: { enable_thinking: false } });
    return (reply.choices[0]?.message.content ?? "").replace(/<think>[\s\S]*?<\/think>/, "").trim();
  } catch (error) {
    // A lost GPU device (an integrated GPU can reset under load) leaves the engine unusable: load it afresh next time.
    await unloadAssistant();
    throw error;
  }
}

function classify(error: unknown): Extract<AiWorkerMessage, { type: "error" }>["code"] {
  if (error instanceof MissingFiles) return "missing-files";
  const text = String((error as Error)?.message ?? error);
  return /out of memory|allocation failed|memory access out of bounds|Array buffer allocation/i.test(text) ? "memory" : "failed";
}

scope.onmessage = async (event: MessageEvent<AiWorkerRequest>) => {
  const request = event.data;
  const post = (message: AiWorkerMessage) => scope.postMessage(message);
  try {
    let result: unknown;
    if (request.type === "read-lines") result = await readLines(request, (fraction) => post({ id: request.id, type: "progress", stage: "running", fraction }));
    else if (request.type === "generate") result = await generate(request, (stage, fraction, tokens) => post({ id: request.id, type: "progress", stage, fraction, tokens }));
    else if (request.type === "generate-webllm") result = await generateWebLlm(request, (stage, fraction) => post({ id: request.id, type: "progress", stage, fraction }));
    else {
      await unloadAssistant();
      await unloadLines();
    }
    post({ id: request.id, type: "result", result });
  } catch (error) {
    console.error(error);
    post({ id: request.id, type: "error", code: classify(error), message: String((error as Error)?.message ?? error) });
  }
};
