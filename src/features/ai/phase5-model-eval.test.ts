import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { ChatMessage } from "@/core/ai/llm-tasks";
import { answerGroundedQuestion, evidenceMessages, verifyQuotes } from "./grounded-answers";
import { phase5Indexes } from "@/test/phase5-fixtures";
import type { AiModelVariant } from "@/core/ai/ai-models";

const inference = vi.hoisted(() => ({ generate: vi.fn<(m: ChatMessage[]) => Promise<string>>() }));
vi.mock("@/core/ai/ai-runtime", () => ({ aiRuntime: inference }));

it.skipIf(!process.env.SALIN_PHASE5_MODEL)("measures cached Qwen weights locally, with networking disabled", { timeout: 1_800_000 }, async () => {
  const profile = process.env.SALIN_PHASE5_MODEL === "laptop" ? "laptop" : "phone-model-on-laptop";
  const repo = profile === "laptop" ? "Qwen3-1.7B-ONNX" : "Qwen3-0.6B-ONNX";
  const { AutoModelForCausalLM, AutoTokenizer, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const modelPath = path.resolve(`node_modules/.cache/hf/onnx-community/${repo}`).replaceAll("\\", "/");
  const t0 = performance.now();
  const tokenizer = await AutoTokenizer.from_pretrained(modelPath, { local_files_only: true });
  const model = await AutoModelForCausalLM.from_pretrained(modelPath, { dtype: "q4", local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
  const loadMs = performance.now() - t0;
  const indexes = await phase5Indexes();
  const samples = ["What should I bring?", "Ano ang dapat dalhin?", "What ang requirements na dapat dalhin?"];
  const evidence = indexes.pdf.evidence.find((e) => e.label === "Requirements")!;
  const rows = [];
  let rssPeak = process.memoryUsage().rss;
  const sampler = setInterval(() => { rssPeak = Math.max(rssPeak, process.memoryUsage().rss); }, 100);
  inference.generate.mockImplementation(async (messages) => {
    const options = { add_generation_prompt: true, return_dict: true, enable_thinking: false } as { add_generation_prompt: boolean; return_dict: true };
    const inputs = tokenizer.apply_chat_template(messages, options) as unknown as Record<string, unknown> & { input_ids: { dims: number[] } };
    const length = inputs.input_ids.dims.at(-1)!;
    expect(length + 360).toBeLessThanOrEqual(4096);
    const output = await model.generate({ ...inputs, max_new_tokens: 200, do_sample: false }) as { slice: (...a: unknown[]) => unknown };
    return tokenizer.batch_decode(output.slice(null, [length, null]) as never, { skip_special_tokens: true })[0];
  });
  try {
    for (const question of samples) {
      // Isolate semantic interpretation of the same evidence in three languages.
      const prompt = evidenceMessages(question, [evidence]);
      const start = performance.now();
      const reply = await inference.generate(prompt.messages);
      const verified = verifyQuotes(reply, prompt.evidence);
      rows.push({ question, reply, exactMatch: verified?.some((q) => q.quote.includes("valid ID") && q.quote.includes("proof of residence")) ?? false, citationsValid: !!verified, latencyMs: performance.now() - start });
      console.log(`${profile}: ${question} — ${Math.round((performance.now() - start) / 1000)}s`);
    }
    const missing = await answerGroundedQuestion("What is the mayor's salary?", indexes.pdf, { device: "wasm", assets: [] } as AiModelVariant);
    const report = { profile, physicalDevice: "development laptop", runtime: "ONNX Runtime Node CPU, q4; not browser WebLLM or physical phone", repo, network: "disabled; existing local files only", loadMs, exactMatchAccuracy: rows.filter((r) => r.exactMatch).length / rows.length, evidenceCitationAccuracy: rows.filter((r) => r.citationsValid).length / rows.length, calculationCorrectness: null, unsupportedAnswerRate: missing.kind === "unsupported" ? 0 : 1, meanLatencyMs: rows.reduce((n, r) => n + r.latencyMs, 0) / rows.length, sampledPeakProcessRssBytes: rssPeak, results: rows };
    await writeFile(`docs/benchmarks/phase5/${profile}-qwen.json`, JSON.stringify(report, null, 2));
    expect(report.unsupportedAnswerRate).toBe(0);
    expect(report.exactMatchAccuracy).toBeGreaterThan(0);
  } finally { clearInterval(sampler); await model.dispose(); }
});
