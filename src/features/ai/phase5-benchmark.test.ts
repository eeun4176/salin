import { readFile, writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
vi.mock("@/core/ai/ai-runtime", () => ({ aiRuntime: { generate: vi.fn(async () => '{"quotes":[]}') } }));
import { answerDataQuestion } from "./ai-actions";
import { answerGroundedQuestion } from "./grounded-answers";
import { PHASE5_CASES, phase5Documents, phase5Indexes } from "@/test/phase5-fixtures";

it("measures the same parsed document questions before and after grounding", async () => {
  const indexes = await phase5Indexes();
  const baseline = process.env.SALIN_PHASE5_BASELINE === "1";
  const results: { question: string; document: string; correct: boolean; citationCorrect: boolean; calculation: boolean; unsupportedAnswer: boolean; latencyMs: number; answer: string }[] = [];
  for (const test of PHASE5_CASES) {
    const index = indexes[test.document];
    const start = performance.now();
    const answer = baseline ? await answerDataQuestion(test.question, index.columns, index.rows, null) : await answerGroundedQuestion(test.question, index, null);
    const latencyMs = performance.now() - start;
    const values = "rows" in answer ? answer.rows ?? [] : [];
    const found = test.value !== undefined && (typeof test.value === "number" ? values.some((r) => r.includes(test.value!)) : answer.text.includes(String(test.value)) || values.some((r) => r.includes(test.value!)));
    const count = test.count !== undefined && new RegExp(`(^|\\D)${test.count}(\\D|$)`).test(answer.text);
    const sourceColumn = "headers" in answer ? answer.headers?.indexOf("Source") : undefined;
    const tableValues = sourceColumn !== undefined && sourceColumn >= 0 ? values.map((row) => row.filter((_, i) => i !== sourceColumn)) : values;
    const table = test.table && JSON.stringify(tableValues) === JSON.stringify(test.table);
    const correct = test.refuse ? answer.kind === "unsupported" : Boolean(found || count || table);
    const citations = "citations" in answer ? answer.citations : [];
    const validCitations = answer.kind === "unsupported" || citations.length > 0 && citations.every((c) => c.id === `dataset:${index.id}` || index.evidence.some((e) => e.id === c.id && e.text === c.text)) && (!test.page || citations.every((c) => c.page === test.page));
    results.push({ question: test.question, document: test.document, correct, citationCorrect: validCitations, calculation: !!test.calculation, unsupportedAnswer: !!test.refuse && answer.kind !== "unsupported", latencyMs, answer: answer.text });
  }
  const rate = (xs: typeof results, key: "correct" | "citationCorrect" | "unsupportedAnswer") => xs.length ? xs.filter((r) => r[key]).length / xs.length : 0;
  const report = {
    date: new Date().toISOString(), environment: "Node on development laptop; deterministic offline path; no Qwen inference", cases: results.length,
    exactMatchAccuracy: rate(results, "correct"), calculationCorrectness: rate(results.filter((r) => r.calculation), "correct"), evidenceCitationAccuracy: rate(results, "citationCorrect"), unsupportedAnswerRate: rate(results, "unsupportedAnswer"),
    latencyMs: { mean: results.reduce((n, r) => n + r.latencyMs, 0) / results.length, max: Math.max(...results.map((r) => r.latencyMs)) },
    memory: { nodeHeapUsedBytes: process.memoryUsage().heapUsed, devicePeakBytes: null },
    laptopQwen: { status: "not measured" }, physicalPhone: { status: "not measured" }, results,
  };
  if (process.env.SALIN_PHASE5_RECORD === "1" || baseline) {
    await writeFile(`docs/benchmarks/phase5/${baseline ? "baseline" : "after"}.json`, JSON.stringify(report, null, 2));
    for (const sample of await phase5Documents()) if (sample.kind === "pdf" || sample.kind === "xlsx") await writeFile(`docs/benchmarks/phase5/${sample.name}`, sample.bytes);
  }
  if (!baseline) {
    const before = JSON.parse(await readFile("docs/benchmarks/phase5/baseline.json", "utf8"));
    expect(report.exactMatchAccuracy).toBeGreaterThan(before.exactMatchAccuracy);
    expect(results.filter((r) => !r.correct || !r.citationCorrect)).toEqual([]);
    expect(report.unsupportedAnswerRate).toBe(0);
  }
}, 60_000);
