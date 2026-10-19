/**
 * Device Benchmark
 * Measures text recognition on this device with a built-in test page (a
 * printed pet registration form drawn at 150 dpi with known values): model
 * download (if needed), engine start-up, page preparation, reading time (a
 * cold and a warm run), memory where the browser exposes it, character and
 * word error rates, and field-level accuracy through the registration
 * template. Results are saved locally and can be copied for documentation.
 * Run it on the target Android phone to get real numbers for that hardware.
 */

import { characterErrorRate, fieldAccuracy, wordErrorRate } from "@/core/ocr/benchmark/accuracy";
import { ocrRuntime } from "@/core/ocr/engine/ocr-runtime";
import { prepareImage } from "@/core/ocr/imaging/imaging-client";
import { DEFAULT_EDITS } from "@/core/ocr/imaging/pipeline";
import { analyzeLayout } from "@/core/ocr/layout/layout-analysis";
import type { DeviceCapabilities } from "@/core/ocr/models/capabilities";
import { ENGINE_LABEL, engineAssetFor, requiredAssets, totalBytes } from "@/core/ocr/models/model-assets";
import { allReady, downloadAssets } from "@/core/ocr/models/model-manager";
import { builtinTemplate } from "@/core/ocr/templates/builtin-templates";
import { extractDocument } from "@/core/ocr/templates/field-mapping";
import type { OcrProfileId } from "@/types/ocr";

export const SAMPLE_FIELDS: Record<string, string> = {
  registration_no: "2026-0142",
  date: "10/18/2026",
  owner_name: "Juan Dela Cruz",
  address: "Purok 2, Poblacion",
  contact: "0917 555 0142",
  pet_name: "Bantay",
  species: "Dog",
  breed: "Aspin",
  sex: "Male",
  age: "2 years",
  color: "Brown and white",
  vaccinated: "Yes",
};

/** The printed text of the sample, line by line (the reference for CER/WER). */
export const SAMPLE_TEXT = [
  "CITY VETERINARY OFFICE",
  "PET REGISTRATION FORM",
  "Registration No.: 2026-0142 Date: 10/18/2026",
  "Owner's Name: Juan Dela Cruz",
  "Address: Purok 2, Poblacion",
  "Contact No.: 0917 555 0142",
  "Pet's Name: Bantay Breed: Aspin",
  "Species: Dog Cat Other",
  "Sex: Male Female",
  "Age: 2 years Color: Brown and white",
  "Vaccinated against rabies",
].join("\n");

function box(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, checked: boolean) {
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, size, size);
  if (checked) {
    ctx.beginPath();
    ctx.moveTo(x + 6, y + size / 2);
    ctx.lineTo(x + size / 2.4, y + size - 7);
    ctx.lineTo(x + size - 5, y + 5);
    ctx.lineWidth = 5;
    ctx.stroke();
  }
}

/** Draws the sample form (A4 at 150 dpi) and returns it as a PNG. */
export async function renderSampleForm(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  ctx.strokeStyle = "#111";
  ctx.textBaseline = "alphabetic";
  const font = (size: number, bold = false) => `${bold ? "bold " : ""}${size}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.font = font(46, true);
  ctx.fillText("CITY VETERINARY OFFICE", 620, 140);
  ctx.font = font(36, true);
  ctx.fillText("PET REGISTRATION FORM", 620, 200);
  ctx.textAlign = "left";
  ctx.font = font(30);
  const y0 = 320;
  const gap = 78;
  const line = (x: number, y: number, text: string) => ctx.fillText(text, x, y);
  line(100, y0, "Registration No.: 2026-0142");
  line(700, y0, "Date: 10/18/2026");
  line(100, y0 + gap, "Owner's Name: Juan Dela Cruz");
  line(100, y0 + gap * 2, "Address: Purok 2, Poblacion");
  line(100, y0 + gap * 3, "Contact No.: 0917 555 0142");
  line(100, y0 + gap * 4, "Pet's Name: Bantay");
  line(700, y0 + gap * 4, "Breed: Aspin");
  // Choices with checkboxes.
  const sy = y0 + gap * 5;
  line(100, sy, "Species:");
  box(ctx, 260, sy - 28, 34, true);
  line(310, sy, "Dog");
  box(ctx, 420, sy - 28, 34, false);
  line(470, sy, "Cat");
  box(ctx, 580, sy - 28, 34, false);
  line(630, sy, "Other");
  const xy = y0 + gap * 6;
  line(100, xy, "Sex:");
  box(ctx, 200, xy - 28, 34, true);
  line(250, xy, "Male");
  box(ctx, 380, xy - 28, 34, false);
  line(430, xy, "Female");
  line(100, y0 + gap * 7, "Age: 2 years");
  line(700, y0 + gap * 7, "Color: Brown and white");
  box(ctx, 100, y0 + gap * 8 - 28, 34, true);
  line(150, y0 + gap * 8, "Vaccinated against rabies");
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The test page couldn't be drawn.");
  return blob;
}

export interface BenchmarkReport {
  version: 1;
  date: string;
  device: {
    userAgent: string;
    mobile: boolean;
    cpuCores: number | null;
    deviceMemoryGb: number | null;
    wasmSimd: boolean;
    wasmRelaxedSimd: boolean;
    webGpu: string;
  };
  engine: string;
  engineBuild: string;
  profile: OcrProfileId;
  languages: string[];
  modelBytes: number;
  /** Download time when the files weren't on the device yet; `null` if already stored. */
  downloadMs: number | null;
  initMs: number;
  prepareMs: number;
  /** First read (includes warming up) and a second read. */
  readMs: [number, number];
  /** JS heap in use after reading (Chromium's performance.memory), or null where unavailable. */
  heapMb: number | null;
  accuracy: { cer: number; wer: number; fieldAccuracy: number; fieldsCorrect: number; fieldsTotal: number; misses: { field: string; expected: string; got: string }[] };
}

const now = () => performance.now();

export async function runBenchmark(caps: DeviceCapabilities, profile: OcrProfileId, languages: string[], onStep?: (step: string) => void): Promise<BenchmarkReport> {
  const assets = requiredAssets(caps, languages);
  let downloadMs: number | null = null;
  if (!(await allReady(assets))) {
    onStep?.("Downloading recognition files");
    const t = now();
    await downloadAssets(assets);
    downloadMs = Math.round(now() - t);
  }
  const config = { profile, languages, core: engineAssetFor(caps) };

  // Measure a cold start: stop any running engine first.
  await ocrRuntime.shutdown();
  onStep?.("Starting the engine");
  let t = now();
  await ocrRuntime.warmUp(config);
  const initMs = Math.round(now() - t);

  onStep?.("Preparing the test page");
  const sample = await renderSampleForm();
  t = now();
  const prepared = await prepareImage(sample, DEFAULT_EDITS, profile);
  const prepareMs = Math.round(now() - t);

  onStep?.("Reading (1 of 2)");
  t = now();
  const first = await ocrRuntime.readPage(prepared.blob, prepared.marks, config);
  const read1 = Math.round(now() - t);
  onStep?.("Reading (2 of 2)");
  t = now();
  await ocrRuntime.readPage(prepared.blob, prepared.marks, config);
  const read2 = Math.round(now() - t);

  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const layout = analyzeLayout({ width: prepared.width, height: prepared.height, lines: first.lines, marks: prepared.marks });
  const extraction = extractDocument(builtinTemplate("vet-registration"), [{ page: 1, width: prepared.width, height: prepared.height, layout, result: { ...first, width: prepared.width, height: prepared.height, autoRotated: 0 } }]);
  const got = Object.fromEntries((extraction.forms[0]?.fields ?? []).map((f) => [f.key, f.value.text]));
  const fields = fieldAccuracy(SAMPLE_FIELDS, got);

  return {
    version: 1,
    date: new Date().toISOString(),
    device: { userAgent: caps.userAgent, mobile: caps.mobile, cpuCores: caps.cpuCores, deviceMemoryGb: caps.deviceMemoryGb, wasmSimd: caps.wasmSimd, wasmRelaxedSimd: caps.wasmRelaxedSimd, webGpu: caps.webGpu },
    engine: ENGINE_LABEL,
    engineBuild: config.core.id,
    profile,
    languages,
    modelBytes: totalBytes(assets),
    downloadMs,
    initMs,
    prepareMs,
    readMs: [read1, read2],
    heapMb: memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null,
    accuracy: {
      cer: Math.round(characterErrorRate(SAMPLE_TEXT, first.text) * 1000) / 1000,
      wer: Math.round(wordErrorRate(SAMPLE_TEXT, first.text) * 1000) / 1000,
      fieldAccuracy: Math.round(fields.accuracy * 1000) / 1000,
      fieldsCorrect: fields.correct,
      fieldsTotal: fields.total,
      misses: fields.scores.filter((s) => !s.correct).map((s) => ({ field: s.key, expected: s.expected, got: s.actual })),
    },
  };
}

/** A Markdown table row set for docs/ocr-benchmarks.md. */
export function reportToMarkdown(r: BenchmarkReport) {
  const s = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(2)} s`);
  return [
    `### ${r.date.slice(0, 10)} — ${r.device.mobile ? "mobile" : "desktop"}, ${r.profile} profile`,
    "",
    `- Device: ${r.device.userAgent}`,
    `- CPU cores: ${r.device.cpuCores ?? "unknown"} · memory: ${r.device.deviceMemoryGb ?? "unknown"} GB · WASM SIMD: ${r.device.wasmSimd ? "yes" : "no"} (relaxed: ${r.device.wasmRelaxedSimd ? "yes" : "no"}) · WebGPU: ${r.device.webGpu}`,
    `- Engine: ${r.engine} (${r.engineBuild}) · languages: ${r.languages.join("+")} · model files: ${(r.modelBytes / 1024 / 1024).toFixed(1)} MB`,
    "",
    "| Download | Engine start | Prepare page | Read (cold) | Read (warm) | JS heap | CER | WER | Fields |",
    "|---|---|---|---|---|---|---|---|---|",
    `| ${s(r.downloadMs)} | ${s(r.initMs)} | ${s(r.prepareMs)} | ${s(r.readMs[0])} | ${s(r.readMs[1])} | ${r.heapMb === null ? "n/a" : `${r.heapMb} MB`} | ${(r.accuracy.cer * 100).toFixed(1)}% | ${(r.accuracy.wer * 100).toFixed(1)}% | ${r.accuracy.fieldsCorrect}/${r.accuracy.fieldsTotal} |`,
    r.accuracy.misses.length ? `\nMissed fields: ${r.accuracy.misses.map((m) => `${m.field} (expected “${m.expected}”, got “${m.got}”)`).join("; ")}` : "",
  ].join("\n");
}
