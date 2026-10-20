/**
 * Device Capabilities & OCR Profiles
 * Detects what this browser and device can do for on-device recognition —
 * WebAssembly (and its SIMD extensions), threads, WebGPU, Web Workers,
 * OffscreenCanvas, memory and CPU cores where the browser exposes them,
 * camera and storage — and picks the OCR profile to use: Standard
 * (lightweight, for most phones) or Accurate (sharper images and a second
 * reading pass, for stronger devices). Without WebAssembly or workers, OCR
 * is unavailable and pages can still be transcribed by hand.
 */

import { relaxedSimd, simd, threads } from "wasm-feature-detect";

import type { OcrProfileId } from "@/types/ocr";

export type WebGpuSupport = "available" | "no-adapter" | "unsupported";

export interface DeviceCapabilities {
  webAssembly: boolean;
  wasmSimd: boolean;
  wasmRelaxedSimd: boolean;
  /** Needs cross-origin isolation, which Salin doesn't use — reported for completeness. */
  wasmThreads: boolean;
  webGpu: WebGpuSupport;
  /** The GPU can run 16-bit float shaders (needed by the smaller, faster assistant model build). */
  webGpuF16: boolean;
  workers: boolean;
  offscreenCanvas: boolean;
  /** Approximate RAM in GB (Chromium only; capped at 8 by the browser). */
  deviceMemoryGb: number | null;
  cpuCores: number | null;
  cacheStorage: boolean;
  camera: boolean;
  secureContext: boolean;
  mobile: boolean;
  userAgent: string;
}

export interface OcrProfile {
  id: OcrProfileId;
  label: string;
  description: string;
}

export const OCR_PROFILES: Record<OcrProfileId, OcrProfile> = {
  standard: {
    id: "standard",
    label: "Standard",
    description: "Lightweight. Reads pages at up to 2,200 px in one pass — best for most phones.",
  },
  accurate: {
    id: "accurate",
    label: "Accurate",
    description: "Reads pages at up to 3,000 px and takes a second pass on hard pages. Slower; needs more memory.",
  },
};

async function detectWebGpu(): Promise<{ support: WebGpuSupport; f16: boolean }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu;
  if (!gpu) return { support: "unsupported", f16: false };
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? { support: "available", f16: adapter.features.has("shader-f16") } : { support: "no-adapter", f16: false };
  } catch {
    return { support: "no-adapter", f16: false };
  }
}

const safely = async (check: () => Promise<boolean>) => {
  try {
    return await check();
  } catch {
    return false;
  }
};

export async function detectCapabilities(): Promise<DeviceCapabilities> {
  const webAssembly = typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const [wasmSimd, wasmRelaxedSimd, wasmThreads, webGpu] = await Promise.all([
    webAssembly ? safely(simd) : false,
    webAssembly ? safely(relaxedSimd) : false,
    webAssembly ? safely(threads) : false,
    detectWebGpu(),
  ]);
  return {
    webAssembly,
    wasmSimd,
    wasmRelaxedSimd,
    wasmThreads: wasmThreads && typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true,
    webGpu: webGpu.support,
    webGpuF16: webGpu.f16,
    workers: typeof Worker !== "undefined",
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    deviceMemoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cpuCores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    cacheStorage: typeof caches !== "undefined",
    camera: Boolean(navigator.mediaDevices?.getUserMedia),
    secureContext: window.isSecureContext,
    mobile: nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
    userAgent: navigator.userAgent,
  };
}

/** Why OCR can't run on this device, or `null` when it can. */
export function ocrUnavailableReason(caps: DeviceCapabilities): string | null {
  if (!caps.webAssembly) return "This browser doesn't support WebAssembly, which on-device text recognition needs.";
  if (!caps.workers) return "This browser can't run background workers, which on-device text recognition needs.";
  if (!caps.cacheStorage) return "This browser can't store the recognition files offline (Cache Storage is unavailable — private browsing?).";
  return null;
}

export interface ProfileChoice {
  profile: OcrProfileId;
  reason: string;
}

/**
 * Picks a profile from the device's capabilities and, when one was run, its
 * benchmark (seconds per page with the Standard profile).
 */
export function recommendProfile(caps: DeviceCapabilities, benchmarkSecondsPerPage?: number | null): ProfileChoice {
  const memory = caps.deviceMemoryGb;
  const cores = caps.cpuCores ?? 2;
  if (memory !== null && memory <= 2) return { profile: "standard", reason: `About ${memory} GB of memory — Standard keeps memory use low.` };
  if (!caps.wasmSimd) return { profile: "standard", reason: "No WebAssembly SIMD — Standard is faster here." };
  if (typeof benchmarkSecondsPerPage === "number") {
    return benchmarkSecondsPerPage <= 6
      ? { profile: "accurate", reason: `This device read the test page in ${benchmarkSecondsPerPage.toFixed(1)} s — fast enough for Accurate.` }
      : { profile: "standard", reason: `This device read the test page in ${benchmarkSecondsPerPage.toFixed(1)} s — Standard keeps waits short.` };
  }
  if ((memory === null || memory >= 6) && cores >= 6 && !caps.mobile) return { profile: "accurate", reason: `${cores} CPU cores${memory ? ` and ${memory}+ GB memory` : ""}.` };
  return { profile: "standard", reason: caps.mobile ? "Phones use Standard unless a benchmark shows they're fast enough." : "A moderate device — Standard keeps waits short." };
}
