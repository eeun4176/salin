/**
 * OCR Runtime & Model Manager Tests
 * With a fake engine: the model starts once and is reused (no repeated
 * initialisation, even for concurrent callers), restarts when languages
 * change or after a cancel, reads never overlap, blank pages skip OCR, the
 * Accurate profile takes a second pass, and results are classified. With a
 * fake Cache Storage and fetch: model files download with progress, are
 * verified, load offline once stored, fail with clear instructions when
 * missing offline, and stale copies are removed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOcrRuntime, type EngineFactory } from "@/core/ocr/engine/ocr-runtime";
import type { EngineConfig, OcrEngine, RawRecognition } from "@/core/ocr/engine/ocr-engine";
import { MODEL_ASSETS, requiredAssets, type ModelAsset } from "@/core/ocr/models/model-assets";
import { checkAssets, downloadAssets, loadAsset, MODEL_CACHE, ModelError, pruneStale, removeAssets, storedBytes } from "@/core/ocr/models/model-manager";
import { recommendProfile, type DeviceCapabilities } from "@/core/ocr/models/capabilities";
import { emptyMarks, line } from "@/test/ocr-fixtures";

const config: EngineConfig = { profile: "standard", languages: ["eng"], core: MODEL_ASSETS["core-simd"] };
const recognition = (confidence: number, wordsText = "Owner: Ana"): RawRecognition => {
  const l = line(10, [[10, wordsText, confidence]]);
  return { lines: [l], text: l.text, confidence };
};

function fakeFactory(read: (mode: string) => Promise<RawRecognition> = async () => recognition(90)) {
  const starts: string[] = [];
  let active = 0;
  let maxActive = 0;
  const factory: EngineFactory = async (cfg) => {
    starts.push(cfg.languages.join("+"));
    await new Promise((r) => setTimeout(r, 5));
    let alive = true;
    const engine: OcrEngine = {
      key: cfg.languages.join("+"),
      label: "fake",
      get alive() {
        return alive;
      },
      async read(_image, { mode, signal }) {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((r) => setTimeout(r, 5));
          if (signal?.aborted) {
            alive = false;
            throw new DOMException("cancelled", "AbortError");
          }
          return await read(mode);
        } finally {
          active--;
        }
      },
      async terminate() {
        alive = false;
      },
    };
    return engine;
  };
  return { factory, starts, maxActive: () => maxActive };
}

const image = new Blob(["x"]);

describe("OCR runtime", () => {
  it("starts the model once for many pages and concurrent callers, and never overlaps reads", async () => {
    const fake = fakeFactory();
    const runtime = createOcrRuntime(fake.factory);
    const results = await Promise.all([1, 2, 3].map(() => runtime.readPage(image, emptyMarks(), config)));
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(fake.starts).toEqual(["eng"]);
    expect(fake.maxActive()).toBe(1);
    await runtime.readPage(image, emptyMarks(), { ...config, languages: ["eng", "tgl"] });
    expect(fake.starts).toEqual(["eng", "eng+tgl"]);
    await runtime.shutdown();
  });

  it("restarts the engine after a cancelled read", async () => {
    const fake = fakeFactory();
    const runtime = createOcrRuntime(fake.factory);
    const controller = new AbortController();
    const cancelled = runtime.readPage(image, emptyMarks(), config, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancelled/);
    expect((await runtime.readPage(image, emptyMarks(), config)).status).toBe("ok");
    expect(fake.starts).toHaveLength(2);
  });

  it("skips blank pages, flags unreadable ones, and takes a second pass with Accurate", async () => {
    const modes: string[] = [];
    const fake = fakeFactory(async (mode) => {
      modes.push(mode);
      return mode === "sparse" ? recognition(70, "Owner: Ana Pet: Bantay") : recognition(30);
    });
    const runtime = createOcrRuntime(fake.factory);
    expect((await runtime.readPage(image, emptyMarks({ inkRatio: 0 }), config)).status).toBe("blank");
    expect(modes).toEqual([]);
    expect((await runtime.readPage(image, emptyMarks(), config)).status).toBe("unreadable");
    const accurate = await runtime.readPage(image, emptyMarks(), { ...config, profile: "accurate" });
    expect(modes).toEqual(["auto", "auto", "sparse"]);
    expect(accurate).toMatchObject({ status: "ok", confidence: 70 });
  });
});

describe("profile choice", () => {
  const caps: DeviceCapabilities = {
    webAssembly: true,
    wasmSimd: true,
    wasmRelaxedSimd: false,
    wasmThreads: false,
    webGpu: "unsupported",
    webGpuF16: false,
    workers: true,
    offscreenCanvas: true,
    deviceMemoryGb: 8,
    cpuCores: 8,
    cacheStorage: true,
    camera: true,
    secureContext: true,
    mobile: false,
    userAgent: "test",
  };

  it("uses Standard on phones and low-memory devices, Accurate on strong ones or fast benchmarks", () => {
    expect(recommendProfile(caps).profile).toBe("accurate");
    expect(recommendProfile({ ...caps, mobile: true }).profile).toBe("standard");
    expect(recommendProfile({ ...caps, deviceMemoryGb: 2 }).profile).toBe("standard");
    expect(recommendProfile({ ...caps, mobile: true }, 4.2).profile).toBe("accurate");
    expect(recommendProfile(caps, 14).profile).toBe("standard");
  });

  it("downloads only the engine build this device can run, plus the chosen languages", () => {
    expect(requiredAssets({ wasmSimd: true, wasmRelaxedSimd: false }, ["eng"]).map((a) => a.id)).toEqual(["core-simd", "lang-eng"]);
    expect(requiredAssets({ wasmSimd: false, wasmRelaxedSimd: false }, ["tgl"]).map((a) => a.id)).toEqual(["core-basic", "lang-eng", "lang-tgl"]);
  });
});

/* ------------------------------------------------------------------
   Model manager with fake Cache Storage + fetch
------------------------------------------------------------------- */

class FakeCache {
  store = new Map<string, Response>();
  async match(key: string | Request) {
    const r = this.store.get(typeof key === "string" ? key : key.url);
    return r?.clone();
  }
  async put(key: string, response: Response) {
    // Like the real Cache API: the body is read completely (a failing stream rejects the put).
    this.store.set(key, new Response(await response.arrayBuffer(), { headers: response.headers }));
  }
  async delete(key: string | Request) {
    return this.store.delete(typeof key === "string" ? key : key.url);
  }
  async keys() {
    return [...this.store.keys()].map((url) => new Request(url));
  }
}

describe("model manager", () => {
  let cache: FakeCache;
  const asset: ModelAsset = { ...MODEL_ASSETS["lang-eng"], bytes: 1000 };

  beforeEach(() => {
    cache = new FakeCache();
    // Salin's own cache, plus the separate ones WebLLM reads from.
    const named = new Map<string, FakeCache>([[MODEL_CACHE, cache]]);
    const open = async (name: string) => named.get(name) ?? named.set(name, new FakeCache()).get(name)!;
    vi.stubGlobal("caches", { open, delete: async (name: string) => void (await open(name)).store.clear() });
    vi.stubGlobal("location", { href: "http://localhost/" });
    vi.stubGlobal("navigator", { onLine: true, storage: undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("downloads with progress, verifies the size, and then loads offline", async () => {
    const body = new Uint8Array(1000).fill(7);
    const fetchMock = vi.fn(async () => new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const progress: number[] = [];
    await downloadAssets([asset], { onProgress: (p) => progress.push(p.loaded) });
    expect(progress.at(-1)).toBe(1000);
    expect((await checkAssets([asset]))[0]).toMatchObject({ ready: true, storedBytes: 1000 });
    expect(await storedBytes()).toBe(1000);

    vi.stubGlobal("navigator", { onLine: false });
    expect((await loadAsset(asset)).size).toBe(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a truncated download and stores nothing", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(400)));
    await expect(downloadAssets([asset])).rejects.toThrow(/incompletely/);
    expect((await checkAssets([asset]))[0].ready).toBe(false);
  });

  it("explains how to recover when files are missing offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const error = await loadAsset(asset).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.code).toBe("offline-missing");
    expect(error.message).toMatch(/Connect to the internet once/);
  });

  it("removes stale copies and can clear everything", async () => {
    await cache.put("http://localhost/assets/old-model.gz", new Response("x"));
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(1000)));
    await downloadAssets([asset]);
    await pruneStale();
    expect([...cache.store.keys()]).toEqual([new URL(asset.url, "http://localhost/").href]);
    await removeAssets();
    expect(cache.store.size).toBe(0);
  });
});

describe("reading Tesseract output", () => {
  it("drops rule lines and checkbox outlines read as text, keeps real symbols, and lists unclear characters", async () => {
    const { fromTesseract } = await import("@/core/ocr/engine/ocr-engine");
    const bbox = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const word = (text: string, symbols: { text: string; confidence: number }[] = []) => ({ text, confidence: 90, bbox, symbols });
    const raw = fromTesseract([{ paragraphs: [{ lines: [{ text: "", confidence: 90, bbox, words: [word("[#]"), word("|"), word("____"), word("#"), word("Dog", [{ text: "D", confidence: 95 }, { text: "o", confidence: 40 }, { text: "g", confidence: 90 }])] }] }] }]);
    expect(raw.lines[0].words.map((w) => w.text)).toEqual(["#", "Dog"]);
    expect(raw.lines[0].words[1].unclear).toBe("o");
  });
});
