/**
 * OCR Model Assets
 * The files on-device recognition needs, all served from Salin's own site
 * (never a third-party CDN): the Tesseract engine compiled to WebAssembly —
 * in three builds, of which a device downloads only the one it can run —
 * and the trained text models per language. The small engine worker script
 * ships with the app shell instead (it is precached for offline use).
 */

import coreBasicUrl from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import coreRelaxedSimdUrl from "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js?url";
import coreSimdUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import engUrl from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url";
import tglUrl from "@tesseract.js-data/tgl/4.0.0/tgl.traineddata.gz?url";
import workerScriptUrl from "tesseract.js/dist/worker.min.js?url";

import type { DeviceCapabilities } from "@/core/ocr/models/capabilities";

export { workerScriptUrl };

export type AssetId = "core-relaxed-simd" | "core-simd" | "core-basic" | "lang-eng" | "lang-tgl";

export interface ModelAsset {
  id: AssetId | string;
  label: string;
  kind: "engine" | "language" | "ai";
  url: string;
  /** Download size in bytes. */
  bytes: number;
}

export interface OcrLanguage {
  code: string;
  label: string;
  assetId: AssetId;
  /** English is always needed (forms mix it in, and it's the fallback). */
  required: boolean;
}

export const MODEL_ASSETS: Record<AssetId, ModelAsset> = {
  "core-relaxed-simd": { id: "core-relaxed-simd", label: "Recognition engine (relaxed SIMD build)", kind: "engine", url: coreRelaxedSimdUrl, bytes: 3_905_767 },
  "core-simd": { id: "core-simd", label: "Recognition engine (SIMD build)", kind: "engine", url: coreSimdUrl, bytes: 3_899_472 },
  "core-basic": { id: "core-basic", label: "Recognition engine (compatibility build)", kind: "engine", url: coreBasicUrl, bytes: 3_896_484 },
  "lang-eng": { id: "lang-eng", label: "English text model", kind: "language", url: engUrl, bytes: 2_952_873 },
  "lang-tgl": { id: "lang-tgl", label: "Filipino (Tagalog) text model", kind: "language", url: tglUrl, bytes: 3_296_556 },
};

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: "eng", label: "English", assetId: "lang-eng", required: true },
  { code: "tgl", label: "Filipino", assetId: "lang-tgl", required: false },
];

export const ENGINE_LABEL = "Tesseract 5 (LSTM) via tesseract.js 7";

/** The one engine build this device should use: the fastest its WebAssembly supports. */
export function engineAssetFor(caps: Pick<DeviceCapabilities, "wasmSimd" | "wasmRelaxedSimd">): ModelAsset {
  if (caps.wasmRelaxedSimd) return MODEL_ASSETS["core-relaxed-simd"];
  if (caps.wasmSimd) return MODEL_ASSETS["core-simd"];
  return MODEL_ASSETS["core-basic"];
}

export function languageAsset(code: string): ModelAsset {
  const language = OCR_LANGUAGES.find((l) => l.code === code);
  if (!language) throw new Error(`Unknown OCR language: ${code}`);
  return MODEL_ASSETS[language.assetId];
}

/** Everything needed to read `languages` on this device. */
export function requiredAssets(caps: Pick<DeviceCapabilities, "wasmSimd" | "wasmRelaxedSimd">, languages: string[]): ModelAsset[] {
  const codes = new Set(["eng", ...languages]);
  return [engineAssetFor(caps), ...[...codes].map(languageAsset)];
}

export const totalBytes = (assets: ModelAsset[]) => assets.reduce((sum, a) => sum + a.bytes, 0);
