/**
 * AI Runtime
 * The app's single entry point to on-device AI, behind one provider
 * interface (`LocalAiProvider`). This provider runs the models in the AI
 * worker (Transformers.js and ONNX Runtime Web; WebLLM for the laptop build
 * of the assistant): one request at a time, with progress, cancellation (the
 * worker is stopped, freeing its memory) and a clear error when model files
 * are missing. Before the assistant loads, the OCR engine is shut down so
 * text recognition, handwriting and the language model never sit in memory
 * together; after a minute idle the worker is stopped too.
 */

import { AI_MODEL_HOST, AI_MODELS, variantSource, type AiModelVariant } from "@/core/ai/ai-models";
import type { LineReading } from "@/core/ai/handwriting";
import type { ChatMessage } from "@/core/ai/llm-tasks";
import type { AiWorkerMessage, AiWorkerRequest, LineCrop } from "@/core/ai/ai.worker";
import { ocrRuntime } from "@/core/ocr/engine/ocr-runtime";
import { keyOf, MODEL_CACHE } from "@/core/ocr/models/model-manager";

export type { LineCrop };

const IDLE_SHUTDOWN_MS = 60_000;

/** A worker request before it gets its id. */
type Request = AiWorkerRequest extends infer R ? (R extends unknown ? Omit<R, "id"> : never) : never;

export type AiErrorCode = "missing-files" | "memory" | "failed" | "unavailable";

export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

const MESSAGES: Record<AiErrorCode, string> = {
  "missing-files": "The AI model isn't on this device. Download it in Settings → On-device AI, then try again.",
  memory: "This device ran out of memory running the AI model. Close other apps or tabs and try again, or switch to a lighter AI mode in Settings.",
  failed: "The AI model stopped unexpectedly. Try again — your work is saved.",
  unavailable: "On-device AI isn't available in this browser.",
};

export interface AiProgress {
  stage: "loading" | "running";
  /** 0–1 when known. */
  fraction: number | null;
  /** Words (tokens) written so far by the assistant. */
  tokens?: number;
}

export interface AiCallOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AiProgress) => void;
}

/** A local inference runtime that can read handwriting and run a chat model. */
export interface LocalAiProvider {
  readonly id: string;
  readonly label: string;
  readLines(crops: LineCrop[], options?: AiCallOptions): Promise<(LineReading & { empty: boolean })[]>;
  generate(messages: ChatMessage[], variant: AiModelVariant, options?: AiCallOptions & { maxNewTokens?: number }): Promise<string>;
  /** Frees model memory now (e.g. before OCR reads pages). */
  unload(): Promise<void>;
  isBusy(): boolean;
}

type WorkerLike = Pick<Worker, "postMessage" | "terminate"> & { onmessage: ((event: MessageEvent<AiWorkerMessage>) => void) | null; onerror: ((event: ErrorEvent) => void) | null };

const defaultWorker = (): WorkerLike => new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module", name: "salin-ai" }) as WorkerLike;

const runtimeKeyOf = (variant: AiModelVariant) => keyOf(variant.assets.find((a) => a.id === "ai-runtime")!);

export function createAiRuntime(makeWorker: () => WorkerLike = defaultWorker, beforeAssistant: () => Promise<void> = () => ocrRuntime.shutdown()): LocalAiProvider {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  let queue: Promise<unknown> = Promise.resolve();
  let running = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; onProgress?: AiCallOptions["onProgress"] }>();

  function stop(reason: Error) {
    worker?.terminate();
    worker = null;
    for (const job of pending.values()) job.reject(reason);
    pending.clear();
  }

  function getWorker() {
    if (worker) return worker;
    if (typeof Worker === "undefined" && makeWorker === defaultWorker) throw new AiError("unavailable", MESSAGES.unavailable);
    worker = makeWorker();
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      if (data.type === "progress") return job.onProgress?.({ stage: data.stage, fraction: data.fraction, tokens: data.tokens });
      pending.delete(data.id);
      if (data.type === "result") job.resolve(data.result);
      else job.reject(new AiError(data.code, MESSAGES[data.code]));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      stop(new AiError("failed", MESSAGES.failed));
    };
    return worker;
  }

  function scheduleShutdown() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (running === 0) stop(new AiError("failed", MESSAGES.failed));
    }, IDLE_SHUTDOWN_MS);
  }

  /** Sends one request after any request already running; cancelling stops the worker. */
  function call<T>(request: Request, options: AiCallOptions = {}): Promise<T> {
    const task = () =>
      new Promise<T>((resolve, reject) => {
        const { signal } = options;
        if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        const id = nextId++;
        running++;
        const done = () => {
          running--;
          signal?.removeEventListener("abort", onAbort);
          scheduleShutdown();
        };
        const onAbort = () => stop(signal!.reason ?? new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", onAbort, { once: true });
        pending.set(id, {
          resolve: (value) => (done(), resolve(value as T)),
          reject: (error) => (done(), reject(error)),
          onProgress: options.onProgress,
        });
        try {
          getWorker().postMessage({ ...request, id } as AiWorkerRequest, request.type === "read-lines" ? request.crops.map((c) => c.pixels.buffer as ArrayBuffer) : []);
        } catch (error) {
          pending.delete(id);
          done();
          reject(error instanceof AiError ? error : new AiError("failed", MESSAGES.failed));
        }
      });
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }

  const handwriting = AI_MODELS.handwriting.variants[0];

  return {
    id: "transformers.js",
    label: "Transformers.js + ONNX Runtime Web",
    readLines: (crops, options) =>
      call({ type: "read-lines", cacheName: MODEL_CACHE, runtimeKey: runtimeKeyOf(handwriting), modelKey: keyOf(handwriting.assets.find((a) => a.id !== "ai-runtime")!), crops }, options),
    generate: async (messages, variant, options = {}) => {
      await beforeAssistant();
      if (variant.webllm) {
        const { repo, revision } = variantSource(AI_MODELS.assistant, variant);
        const files = variant.assets.map((a) => ({ cache: a.cache ?? MODEL_CACHE, key: keyOf(a) }));
        const modelLib = files.find((f) => f.cache === "webllm/wasm")!.key;
        const engine = { cache: MODEL_CACHE, key: keyOf(variant.assets.find((a) => a.id === "assistant-laptop:engine")!) };
        return call({ type: "generate-webllm", engine, model: `${AI_MODEL_HOST}/${repo}/resolve/${revision}/`, modelId: variant.webllm, modelLib, files, messages, maxNewTokens: options.maxNewTokens ?? 200 }, options);
      }
      return call(
        {
          type: "generate",
          cacheName: MODEL_CACHE,
          runtimeKey: runtimeKeyOf(variant),
          host: AI_MODEL_HOST,
          ...variantSource(AI_MODELS.assistant, variant),
          dtype: variant.dtype ?? "q4",
          device: variant.device,
          messages,
          maxNewTokens: options.maxNewTokens ?? 200,
        },
        options,
      );
    },
    unload: async () => {
      if (!worker || running > 0) return;
      await call({ type: "unload" }).catch(() => undefined);
    },
    isBusy: () => running > 0,
  };
}

/** The app-wide AI runtime. */
export const aiRuntime = createAiRuntime();
