/**
 * Tesseract Engine
 * On-device OCR with tesseract.js (Tesseract 5's LSTM recogniser compiled to
 * WebAssembly), running in its own Web Worker. The engine build and language
 * files come from the model cache (see model-manager.ts) — nothing is
 * fetched from a CDN and no image ever leaves the device. Cancelling a read
 * terminates the worker immediately.
 */

import { engineKey, fromTesseract, type EngineConfig, type EngineStatus, type OcrEngine, type ReadOptions, type RawRecognition } from "@/core/ocr/engine/ocr-engine";
import { ENGINE_LABEL, languageAsset, workerScriptUrl } from "@/core/ocr/models/model-assets";
import { loadAsset, ModelError } from "@/core/ocr/models/model-manager";

/** Longest a healthy engine takes to start on a slow phone (the files are already on the device). */
const START_TIMEOUT_MS = 120_000;

const abortError = () => new DOMException("Recognition was cancelled.", "AbortError");

/**
 * tesseract.js 7 starts the engine with each language's bytes instead of its
 * code when languages are passed as data (worker-script/index.js uses
 * `l.data` where `l.code` is meant). This runs first in the worker and
 * swaps in the codes before tesseract.js sees the message.
 */
const LANGUAGE_CODE_FIX = `self.addEventListener("message", function (event) {
  var d = event.data;
  if (d && d.action === "initialize" && d.payload && Array.isArray(d.payload.langs)) {
    d.payload.langs = d.payload.langs.map(function (l) { return typeof l === "string" ? l : l.code; });
  }
});
`;

/** The engine worker script (precached with the app, so this works offline) with the fix in front. */
async function workerBlobUrl() {
  const response = await fetch(workerScriptUrl);
  if (!response.ok) throw new ModelError("download-failed", "The text-recognition worker couldn't be loaded. Reload the app while online, then try again.");
  return URL.createObjectURL(new Blob([LANGUAGE_CODE_FIX, await response.text()], { type: "text/javascript" }));
}

export async function createTesseractEngine(config: EngineConfig, options: { signal?: AbortSignal; onStatus?: EngineStatus } = {}): Promise<OcrEngine> {
  const { signal, onStatus } = options;
  const Tesseract = await import("tesseract.js");
  const codes = [...new Set(["eng", ...config.languages])];

  onStatus?.("loading recognition files", 0);
  const core = await loadAsset(config.core, signal);
  const langs = await Promise.all(
    codes.map(async (code) => ({ code, data: new Uint8Array(await (await loadAsset(languageAsset(code), signal)).arrayBuffer()) })),
  );
  signal?.throwIfAborted();

  // tesseract.js loads the engine with importScripts(); a blob URL keeps that offline-proof.
  // The fragment only makes the URL end in ".js", which is how tesseract.js recognises a file path.
  const coreUrl = URL.createObjectURL(new Blob([core], { type: "text/javascript" }));
  const workerUrl = await workerBlobUrl();
  let onRead: ((fraction: number) => void) | undefined;
  let worker: Tesseract.Worker;
  // tesseract.js can leave start-up hanging when it fails inside the worker: give up with a clear error instead.
  let failStart: (error: Error) => void = () => undefined;
  const startFailed = new Promise<never>((_, reject) => (failStart = reject));
  const timer = setTimeout(() => failStart(new ModelError("corrupt", "Text recognition didn't start. Remove the recognition files in Settings, download them again, and retry.")), START_TIMEOUT_MS);
  try {
    const starting = Tesseract.createWorker(langs, Tesseract.OEM.LSTM_ONLY, {
      workerPath: workerUrl,
      workerBlobURL: false,
      corePath: `${coreUrl}#tesseract-core.wasm.js`,
      cacheMethod: "none",
      logger: (m) => {
        if (m.status === "recognizing text") onRead?.(m.progress);
        else onStatus?.(m.status, m.progress);
      },
      errorHandler: (error: unknown) => failStart(new ModelError("corrupt", `Text recognition couldn't start (${String(error)}). Remove the recognition files in Settings, download them again, and retry.`)),
    });
    worker = await Promise.race([starting, startFailed]);
  } finally {
    clearTimeout(timer);
    URL.revokeObjectURL(coreUrl);
    URL.revokeObjectURL(workerUrl);
  }
  await worker.setParameters({ user_defined_dpi: "300" });

  let alive = true;
  let mode: ReadOptions["mode"] | null = null;

  return {
    key: engineKey(config),
    label: ENGINE_LABEL,
    get alive() {
      return alive;
    },
    async read(image: Blob, { mode: nextMode, signal: readSignal, onProgress }: ReadOptions): Promise<RawRecognition> {
      if (!alive) throw new Error("This recognition engine was stopped.");
      readSignal?.throwIfAborted();
      if (nextMode !== mode) {
        await worker.setParameters({ tessedit_pageseg_mode: nextMode === "sparse" ? Tesseract.PSM.SPARSE_TEXT : Tesseract.PSM.AUTO });
        mode = nextMode;
      }
      onRead = onProgress;
      // Tesseract can't abort a job, so cancelling stops the whole worker.
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => {
          alive = false;
          void worker.terminate();
          reject(abortError());
        };
        readSignal?.addEventListener("abort", onAbort, { once: true });
      });
      try {
        const result = await Promise.race([worker.recognize(image, {}, { blocks: true, text: true }), aborted]);
        return fromTesseract(result.data.blocks as Parameters<typeof fromTesseract>[0]);
      } finally {
        if (onAbort) readSignal?.removeEventListener("abort", onAbort);
        onRead = undefined;
      }
    },
    async terminate() {
      if (!alive) return;
      alive = false;
      await worker.terminate();
    },
  };
}
