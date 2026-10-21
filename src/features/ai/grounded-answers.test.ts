import { beforeEach, describe, expect, it, vi } from "vitest";
const generate = vi.hoisted(() => vi.fn<(messages: unknown, variant: unknown, options: unknown) => Promise<string>>(async () => ""));
vi.mock("@/core/ai/ai-runtime", () => ({ aiRuntime: { generate } }));
import { answerGroundedQuestion, answerLanguage, evidenceMessages, routeQuestion, verifyQuotes } from "./grounded-answers";
import { contentEvidence, retrieveEvidence, scanEvidence, type DocumentIndex } from "@/core/ai/document-evidence";
import { phase5Indexes } from "@/test/phase5-fixtures";
import type { AiModelVariant } from "@/core/ai/ai-models";
import type { OcrPage } from "@/types/ocr";
import { makeValue } from "@/core/ocr/templates/field-mapping";

let indexes: Record<string, DocumentIndex>;
beforeEach(async () => { generate.mockReset(); indexes = await phase5Indexes(); });
const variant = { device: "wasm", assets: [] } as AiModelVariant;

describe("grounded answers", () => {
  it("routes supported bilingual operations and keeps writes out of the read path", () => {
    for (const [q, route] of [["What is the deadline?", "field"], ["Ilang tao?", "calculation"], ["Ipakita ang pangalan", "table"], ["group by city", "dataset"], ["Ibuod ito", "summary"], ["burahin ang rows", "command"], ["export names", "export"], ["send this to my boss", "unsupported"]]) expect(routeQuestion(q)).toBe(route);
    expect(answerLanguage("Ano ang pangalan?")).toBe("fil");
    expect(answerLanguage("Ilang rows sa Malolos?")).toBe("taglish");
    expect(answerLanguage("What is the name?")).toBe("en");
  });

  it("preserves identifiers, leading zeros and dates and cites real pages", async () => {
    const answer = await answerGroundedQuestion("Ano ang contact number?", indexes.pdf, null);
    expect(answer.text).toContain("09171234567");
    expect(answer.text).toContain("Mula sa");
    expect(answer.citations).toEqual([expect.objectContaining({ page: 1, text: "Contact number: 09171234567" })]);
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not turn an extra unknown condition into a partial field answer", async () => {
    expect(await answerGroundedQuestion("What is the contact number of Ben?", indexes.notice, null)).toMatchObject({ kind: "unsupported", citations: [] });
  });

  it("calculates over every row and cites every contributor, including rows beyond retrieval limits", async () => {
    const index = indexes.csv;
    index.rows = Array.from({ length: 210 }, (_, i) => ({ ...index.rows[0], id: `many${i}`, position: i }));
    index.evidence = (await import("@/core/ai/document-evidence")).datasetEvidence(index.id, index.name, index.columns, index.rows);
    const answer = await answerGroundedQuestion("Total amount", index, null);
    expect(answer.rows).toEqual([[262500]]);
    expect(answer.citations).toHaveLength(210);
  });

  it("restricts spreadsheet calculations to the requested sheet", async () => {
    const answer = await answerGroundedQuestion('Total amount in sheet "Late entries"', indexes.xlsx, null);
    expect(answer.rows).toEqual([[300]]);
    expect(answer.citations.every((c) => c.sheet === "Late entries")).toBe(true);
    expect(await answerGroundedQuestion('Total amount in sheet "Missing"', indexes.xlsx, null)).toMatchObject({ kind: "unsupported" });
  });

  it("recomputes a scoped follow-up and refuses it without same-source context", async () => {
    expect(await answerGroundedQuestion("How many of those?", indexes.csv, null)).toMatchObject({ kind: "unsupported" });
    const answer = await answerGroundedQuestion("How many of those?", indexes.csv, null, {}, "Show rows in Malolos");
    expect(answer.text).toContain("2 rows");
  });

  it("blocks unresolved OCR and parser warnings before calculating", async () => {
    expect(await answerGroundedQuestion("What is the contact number?", indexes.scan, variant)).toMatchObject({ kind: "unsupported", warnings: ["unclear-characters"] });
    indexes.csv.warnings = ["Page 2 could not be read"];
    expect(await answerGroundedQuestion("How many rows?", indexes.csv, variant)).toMatchObject({ kind: "unsupported" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses Qwen only for choosing source excerpts and validates all claims before rendering", async () => {
    const source = indexes.pdf.evidence.find((e) => e.label === "Requirements")!;
    generate.mockResolvedValue(JSON.stringify({ quotes: [{ source: source.id, quote: source.value }] }));
    const answer = await answerGroundedQuestion("What should I bring?", indexes.pdf, variant);
    expect(answer).toMatchObject({ kind: "text", citations: [expect.objectContaining({ id: source.id, page: 2 })] });
    const messages = generate.mock.calls[0]?.[0] as unknown as { content: string }[];
    expect(JSON.stringify(messages)).toContain("Bring a valid ID");
    expect(JSON.stringify(messages)).not.toContain("09171234567");
  });

  it("rejects forged ids, altered numbers, extra prose, mixed valid and invalid quotes, and malformed output", () => {
    const source = indexes.pdf.evidence.find((e) => e.label === "Contact number")!;
    for (const response of [
      { quotes: [{ source: "invented", quote: source.text }] },
      { quotes: [{ source: source.id, quote: "Contact number: 09171234568" }] },
      { quotes: [{ source: source.id, quote: source.text }], explanation: "Ben owns it" },
      { quotes: [{ source: source.id, quote: source.text }, { source: "invented", quote: "42" }] },
    ]) expect(verifyQuotes(JSON.stringify(response), [source])).toBeNull();
    expect(verifyQuotes("{broken", [source])).toBeNull();
    expect(verifyQuotes(JSON.stringify({ quotes: [{ source: source.id, quote: source.text }] }), [source])).toHaveLength(1);
  });

  it("falls back to uncertainty when inference fails or invents a value", async () => {
    generate.mockRejectedValue(new Error("model unavailable"));
    expect(await answerGroundedQuestion("What should I bring?", indexes.pdf, variant)).toMatchObject({ kind: "unsupported" });
    generate.mockResolvedValue('{"quotes":[{"source":"made-up","quote":"Passport"}]}');
    expect(await answerGroundedQuestion("What should I bring?", indexes.pdf, variant)).toMatchObject({ kind: "unsupported" });
  });

  it("honors cancellation before reading or generating", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(answerGroundedQuestion("How many rows?", indexes.csv, variant, { signal: controller.signal })).rejects.toBeDefined();
    expect(generate).not.toHaveBeenCalled();
  });

  it("retains long paragraph tails and bounds prompt evidence without splitting source blocks", () => {
    const text = `${"alpha ".repeat(300)}Tail marker 00042`;
    const evidence = contentEvidence("long", "Long.txt", { pages: [{ number: 9, text }], tables: [], warnings: [] });
    const index = { ...indexes.notice, evidence };
    expect(retrieveEvidence(index, "Tail marker")[0].text).toContain("00042");
    const prompt = evidenceMessages("What is alpha?", Array.from({ length: 100 }, (_, i) => ({ ...evidence[0], id: String(i) })));
    expect(new TextEncoder().encode(prompt.messages.at(-1)!.content).length).toBeLessThan(5000);
    expect(prompt.evidence.every((e) => evidence[0].text === e.text)).toBe(true);
  });

  it("keeps OCR coordinates and removes stale OCR when a field was reviewed", () => {
    const box = { x: 10, y: 10, width: 120, height: 20 };
    const spec = { key: "phone", label: "Phone", type: "text" as const, required: false };
    const value = { ...makeValue(spec, { text: "O917", confidence: 40, mapping: 1, page: 1, box }), text: "0917", edited: true, flags: [] };
    const page = { position: 0, pdfPage: 3, result: { lines: [{ text: "Phone: O917", confidence: 40, words: [], box }] }, layout: null, error: null } as unknown as OcrPage;
    const evidence = scanEvidence("scan", "Scan.pdf", [page], { templateId: "generic", forms: [{ page: 1, fields: [{ ...spec, value }] }], tables: [], summaries: [], warnings: [], unsupported: null });
    expect(evidence).toEqual([expect.objectContaining({ text: "Phone: 0917", box, page: 3, warnings: [], confidence: null })]);
  });

  it("indexes OCR table headers, cell boxes and unresolved warnings", () => {
    const box = { x: 10, y: 20, width: 100, height: 20 };
    const page = { position: 0, pdfPage: null, result: null, error: null, layout: { issues: [], headings: [], tables: [{ headerRows: 1, columns: [{}], rows: [{ box, cells: [{ text: "Amount", box, confidence: 99, unclear: "" }] }, { box, cells: [{ text: "1O0", box, confidence: 45, unclear: "O" }] }] }] } } as unknown as OcrPage;
    expect(scanEvidence("scan", "Form", [page], null)).toEqual([expect.objectContaining({ kind: "row", page: 1, text: "Amount: 1O0", confidence: 45, warnings: ["Unresolved OCR table"], cells: { Amount: { value: "1O0", box } } })]);
  });
});
