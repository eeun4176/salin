/**
 * AI Benchmark
 * Measures the optional on-device AI on this device, for the Android tests:
 * the handwriting reader on a few handwriting-style test values (load time,
 * time per value, character error rate) and, when downloaded, the
 * assistant on fixed requests over a small sample dataset (load time, time
 * per answer, how many became the right command). Also the device facts
 * that matter (WebGPU, 16-bit GPU support, memory) and the JS heap. Results
 * are saved locally and can be copied into docs/PHASE5_AI.md.
 */

import { AI_MODELS, type AiModelVariant } from "@/core/ai/ai-models";
import { aiRuntime, type LineCrop } from "@/core/ai/ai-runtime";
import { LINE_HEIGHT, lineWidth } from "@/core/ai/handwriting";
import { commandMessages, parseCommandReply } from "@/core/ai/llm-tasks";
import { characterErrorRate } from "@/core/ocr/benchmark/accuracy";
import type { DeviceCapabilities } from "@/core/ocr/models/capabilities";
import type { DatasetCommand } from "@/core/processing/dataset-commands";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

export interface AiBenchmarkReport {
  version: 1;
  kind: "ai";
  date: string;
  device: { userAgent: string; mobile: boolean; cpuCores: number | null; deviceMemoryGb: number | null; webGpu: string; webGpuF16: boolean };
  handwriting: { loadMs: number; perValueMs: number; cer: number; readings: { expected: string; read: string; confidence: number }[] } | null;
  assistant: { device: string; dtype: string; loadMs: number; perAnswerMs: number; correct: number; total: number } | null;
  heapMb: number | null;
}

const SAMPLES = ["Juan Dela Cruz", "Purok 2, Muzon", "Bantay", "10/18/2026", "0917 555 0142", "Brown and white"];

/** Draws test values in a handwriting-style font, each as one line crop. */
function handwritingSamples(): LineCrop[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return SAMPLES.map((text) => {
    const font = "italic 34px 'Segoe Script', 'Bradley Hand', 'Dancing Script', cursive";
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + 24;
    const height = 56;
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#1a1a2e";
    ctx.font = font;
    ctx.fillText(text, 12, 40);
    const scaled = document.createElement("canvas");
    scaled.width = lineWidth(width, height);
    scaled.height = LINE_HEIGHT;
    const sctx = scaled.getContext("2d", { willReadFrequently: true })!;
    sctx.drawImage(canvas, 0, 0, scaled.width, LINE_HEIGHT);
    return { pixels: sctx.getImageData(0, 0, scaled.width, LINE_HEIGHT).data, width: scaled.width };
  });
}

const col = (name: string, type: DatasetColumn["type"] = "text"): DatasetColumn => ({ id: name.toLowerCase().replace(/\W+/g, "_"), name, type, required: false, sourceHeader: name });
const COLUMNS = [col("Owner"), col("Barangay"), col("Pet name"), col("Species"), col("Age", "number"), col("Vaccinated", "boolean")];
const ROWS: DatasetRow[] = [
  ["Juan Dela Cruz", "Muzon", "Bantay", "Dog", 2, true],
  ["Maria Santos", "Tungkong Mangga", "Mingming", "Cat", 1, false],
].map((values, i) => ({ id: `r${i}`, datasetId: "bench", position: i, source: null, values: Object.fromEntries(COLUMNS.map((c, j) => [c.id, values[j]])) }));
const REQUESTS: [string, (c: DatasetCommand) => boolean][] = [
  ["show unvaccinated dogs in Muzon", (c) => c.action === "filter" && c.where.length === 3],
  ["how many pets per barangay", (c) => c.action === "summarize" && c.group_by[0] === "barangay"],
  ["oldest pets first", (c) => c.action === "sort" && c.by[0].column === "age" && c.by[0].direction === "desc"],
];

const now = () => performance.now();

export async function runAiBenchmark(caps: DeviceCapabilities, options: { assistant: AiModelVariant | null; onStep?: (step: string) => void }): Promise<AiBenchmarkReport> {
  await aiRuntime.unload();
  options.onStep?.("Reading handwriting samples");
  let t = now();
  const first = await aiRuntime.readLines(handwritingSamples().slice(0, 1));
  const loadMs = Math.round(now() - t);
  t = now();
  const rest = await aiRuntime.readLines(handwritingSamples().slice(1));
  const perValueMs = Math.round((now() - t) / (SAMPLES.length - 1));
  const readings = [...first, ...rest].map((r, i) => ({ expected: SAMPLES[i], read: r.text, confidence: Math.round(r.confidence * 100) / 100 }));

  let assistant: AiBenchmarkReport["assistant"] = null;
  if (options.assistant) {
    options.onStep?.("Loading the assistant");
    let correct = 0;
    let loadAssistant = 0;
    const times: number[] = [];
    for (const [i, [request, check]] of REQUESTS.entries()) {
      options.onStep?.(`Assistant request ${i + 1} of ${REQUESTS.length}`);
      t = now();
      const reply = parseCommandReply(await aiRuntime.generate(commandMessages(request, COLUMNS, ROWS), options.assistant, { maxNewTokens: 160 }), COLUMNS, request);
      const ms = now() - t;
      if (i === 0) loadAssistant = Math.round(ms);
      else times.push(ms);
      if (reply.ok && check(reply.command)) correct++;
    }
    assistant = {
      device: options.assistant.device,
      dtype: options.assistant.dtype ?? "",
      loadMs: loadAssistant,
      perAnswerMs: Math.round(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)),
      correct,
      total: REQUESTS.length,
    };
  }

  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    version: 1,
    kind: "ai",
    date: new Date().toISOString(),
    device: { userAgent: caps.userAgent, mobile: caps.mobile, cpuCores: caps.cpuCores, deviceMemoryGb: caps.deviceMemoryGb, webGpu: caps.webGpu, webGpuF16: caps.webGpuF16 },
    handwriting: { loadMs, perValueMs, cer: Math.round(characterErrorRate(SAMPLES.join("\n"), readings.map((r) => r.read).join("\n")) * 1000) / 1000, readings },
    assistant,
    heapMb: memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null,
  };
}

export function aiReportToMarkdown(r: AiBenchmarkReport) {
  const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
  return [
    `### ${r.date.slice(0, 10)} — ${r.device.mobile ? "mobile" : "desktop"}, on-device AI`,
    "",
    `- Device: ${r.device.userAgent}`,
    `- CPU cores: ${r.device.cpuCores ?? "unknown"} · memory: ${r.device.deviceMemoryGb ?? "unknown"} GB · WebGPU: ${r.device.webGpu}${r.device.webGpuF16 ? " (16-bit)" : ""} · JS heap: ${r.heapMb ?? "n/a"} MB`,
    "",
    "| Model | Load (first use) | Per value / answer | Accuracy |",
    "|---|---|---|---|",
    r.handwriting ? `| ${AI_MODELS.handwriting.name} | ${s(r.handwriting.loadMs)} | ${s(r.handwriting.perValueMs)} | CER ${(r.handwriting.cer * 100).toFixed(1)}% (handwriting-style font) |` : "",
    r.assistant ? `| ${AI_MODELS.assistant.name} (${r.assistant.device}, ${r.assistant.dtype}) | ${s(r.assistant.loadMs)} | ${s(r.assistant.perAnswerMs)} | ${r.assistant.correct}/${r.assistant.total} commands |` : `| ${AI_MODELS.assistant.name} | not downloaded | — | — |`,
  ]
    .filter(Boolean)
    .join("\n");
}
