/**
 * AI Worker
 * Runs the on-device AI models off the main thread, so the screen never
 * freezes: the handwriting recognizer (an ONNX model run directly with ONNX
 * Runtime Web) and the assistant language model (Transformers.js on the same
 * ONNX Runtime, on WebGPU or the CPU). Only one model is kept in memory at a
 * time — loading one unloads the other. Every file is read from Salin's
 * model cache; this worker has no way to fetch anything from the network,
 * and only text and pixel data (never documents) come in.
 */

/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/webgpu";
// The engine's small JS loader ships with the app (precached for offline use); the 27 MB engine itself comes from the model cache.
import engineLoaderUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";

import { decodeLine, LINE_HEIGHT, lineTensor, type LineReading } from "@/core/ai/handwriting";
import type { ChatMessage } from "@/core/ai/llm-tasks";

export interface LineCrop {
  /** RGBA pixels already scaled to LINE_HEIGHT × width. */
  pixels: Uint8ClampedArray;
  width: number;
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
  assistant = null;
  await current?.model.dispose();
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
      out.push({ ...decodeLine(probs.data as Float32Array, probs.dims[1], probs.dims[2]), empty: false });
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
  let tokens = 0;
  const streamer = new tf.TextStreamer(tokenizer, { skip_prompt: true, token_callback_function: () => progress("running", null, ++tokens) });
  const output = (await model.generate({ ...inputs, max_new_tokens: request.maxNewTokens, do_sample: false, streamer })) as { slice: (...args: unknown[]) => unknown };
  const promptLength = inputs.input_ids.dims.at(-1)!;
  return tokenizer.batch_decode(output.slice(null, [promptLength, null]) as never, { skip_special_tokens: true })[0];
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
