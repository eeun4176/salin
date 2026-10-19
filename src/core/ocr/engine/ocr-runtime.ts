/**
 * OCR Runtime
 * Owns the one recognition engine the app uses: starts it on first use and
 * reuses it for every page (no repeated model initialisation — concurrent
 * callers share one start-up), restarts it when the profile or languages
 * change or after a cancel, runs reads one at a time, and shuts it down
 * after a minute idle to give the memory back. Also reads a whole page:
 * skips blank pages, takes a second "sparse text" pass on hard pages with
 * the Accurate profile, and classifies the result (ok, blank, unreadable).
 */

import { engineKey, type EngineConfig, type EngineStatus, type OcrEngine, type RawRecognition } from "@/core/ocr/engine/ocr-engine";
import type { OcrPageResult, PageMarks } from "@/types/ocr";

const IDLE_SHUTDOWN_MS = 60_000;
/** Pages with less ink than this are blank (no OCR is run). */
export const BLANK_INK_RATIO = 0.0015;
/** Below this mean confidence a page counts as unreadable. */
export const UNREADABLE_CONFIDENCE = 35;
/** The Accurate profile re-reads pages below this confidence in sparse-text mode. */
const SECOND_PASS_BELOW = 82;

export type EngineFactory = (config: EngineConfig, options: { signal?: AbortSignal; onStatus?: EngineStatus }) => Promise<OcrEngine>;

const defaultFactory: EngineFactory = async (config, options) => (await import("@/core/ocr/engine/tesseract-engine")).createTesseractEngine(config, options);

export interface PageReadOptions {
  signal?: AbortSignal;
  onStatus?: EngineStatus;
  /** 0–1 through this page. */
  onProgress?: (fraction: number) => void;
}

export function createOcrRuntime(factory: EngineFactory = defaultFactory) {
  let engine: Promise<OcrEngine> | null = null;
  let key = "";
  let queue: Promise<unknown> = Promise.resolve();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let running = 0;

  function scheduleShutdown() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (running === 0) void shutdown();
    }, IDLE_SHUTDOWN_MS);
  }

  async function engineFor(config: EngineConfig, signal?: AbortSignal, onStatus?: EngineStatus) {
    const wanted = engineKey(config);
    if (engine && key === wanted) {
      const current = await engine.catch(() => null);
      if (current?.alive) return current;
    }
    if (engine) await shutdown();
    key = wanted;
    engine = factory(config, { signal, onStatus });
    // A failed start must not be reused.
    engine.catch(() => {
      if (key === wanted) {
        engine = null;
        key = "";
      }
    });
    return engine;
  }

  async function shutdown() {
    const current = engine;
    engine = null;
    key = "";
    if (current) await (await current.catch(() => null))?.terminate();
  }

  /** Runs `task` after any read already in progress (reads never overlap). */
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }

  async function read(image: Blob, config: EngineConfig, mode: "auto" | "sparse", options: PageReadOptions): Promise<RawRecognition> {
    running++;
    try {
      const current = await engineFor(config, options.signal, options.onStatus);
      return await current.read(image, { mode, signal: options.signal, onProgress: options.onProgress });
    } finally {
      running--;
      scheduleShutdown();
    }
  }

  /** Reads one prepared page. Never throws for content problems — those become the result's status. */
  function readPage(image: Blob, marks: PageMarks | null, config: EngineConfig, options: PageReadOptions = {}): Promise<Omit<OcrPageResult, "width" | "height" | "autoRotated">> {
    return exclusive(async () => {
      const started = performance.now();
      const base = { engine: "", profile: config.profile, languages: config.languages };
      if (marks && marks.inkRatio < BLANK_INK_RATIO) {
        return { ...base, engine: "skipped (blank)", lines: [], text: "", confidence: 0, status: "blank" as const, durationMs: 0 };
      }
      const progress = options.onProgress;
      let result = await read(image, config, "auto", { ...options, onProgress: (f) => progress?.(config.profile === "accurate" ? f * 0.6 : f) });
      if (config.profile === "accurate" && result.confidence < SECOND_PASS_BELOW) {
        const sparse = await read(image, config, "sparse", { ...options, onProgress: (f) => progress?.(0.6 + f * 0.4) });
        // Keep whichever pass read more text, weighted by how sure it was.
        const score = (r: RawRecognition) => r.confidence * r.lines.reduce((n, l) => n + l.words.length, 0);
        if (score(sparse) > score(result)) result = sparse;
      }
      progress?.(1);
      const current = await engine;
      const words = result.lines.reduce((n, l) => n + l.words.length, 0);
      const status = words === 0 ? "blank" : result.confidence < UNREADABLE_CONFIDENCE ? "unreadable" : "ok";
      return { ...base, engine: current?.label ?? "", ...result, status, durationMs: Math.round(performance.now() - started) };
    });
  }

  return {
    /** Starts the engine ahead of time (e.g. while the user picks a template). */
    warmUp: (config: EngineConfig, onStatus?: EngineStatus) => engineFor(config, undefined, onStatus).then(() => scheduleShutdown()),
    readPage,
    /** Raw read without page logic (benchmarks). */
    read: (image: Blob, config: EngineConfig, mode: "auto" | "sparse" = "auto", options: PageReadOptions = {}) => exclusive(() => read(image, config, mode, options)),
    shutdown,
    isBusy: () => running > 0,
    isLoaded: () => engine !== null,
  };
}

export type OcrRuntime = ReturnType<typeof createOcrRuntime>;

/** The app-wide runtime. */
export const ocrRuntime = createOcrRuntime();
