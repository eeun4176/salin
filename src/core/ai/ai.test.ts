/**
 * On-device AI Tests
 * The parts of Phase 5 that decide what reaches the reviewer: grounding
 * (values must be on the page; corrections stay close to what was read),
 * suggestions (rules first; accepting keeps what OCR read and records the
 * source; rejecting is remembered; nothing is invented for empty values;
 * leading zeros are kept), model replies parsed and validated with zod
 * (malformed, unsupported and hallucinated output is rejected), English and
 * Filipino labels, handwriting decoding, mode recommendations, approved
 * download sources, template suggestions, column naming, keeping different
 * page layouts apart, and the AI runtime's queue, cancel and errors.
 */

import { statSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_MODELS, isApprovedModelUrl, recommendAiMode, variantFor, variantSource } from "@/core/ai/ai-models";
import { AiError, createAiRuntime } from "@/core/ai/ai-runtime";
import { findOnPage, isCloseCorrection } from "@/core/ai/grounding";
import { cleanReading, decodeLine, HANDWRITING_CHARACTERS, lineTensor } from "@/core/ai/handwriting";
import { commandMessages, extractJson, parseCommandReply, parseCorrectionReply, parseFieldReply, parseMappingReply } from "@/core/ai/llm-tasks";
import { acceptSuggestion, correctionSuggestions, fieldSuggestion, pendingSuggestions, rejectSuggestion, ruleSuggestions, templateRules, withHandwritingReadings } from "@/core/ai/suggestions";
import type { DeviceCapabilities } from "@/core/ocr/models/capabilities";
import { analyzeLayout } from "@/core/ocr/layout/layout-analysis";
import { refKey, reviewItems } from "@/core/ocr/review/review-state";
import { extractionToDatasets } from "@/core/ocr/review/to-dataset";
import { builtinTemplate, BUILTIN_TEMPLATES } from "@/core/ocr/templates/builtin-templates";
import { extractDocument, makeValue, type MappingPage } from "@/core/ocr/templates/field-mapping";
import { suggestTemplates } from "@/core/ocr/templates/template-suggest";
import { nameColumns, suggestColumnName } from "@/core/processing/column-naming";
import { emptyMarks, line, pageResult, words } from "@/test/ocr-fixtures";
import type { Extraction, ExtractedField, FieldSpec, OcrLine } from "@/types/ocr";
import type { DatasetColumn } from "@/types/processing";

function page(n: number, lines: OcrLine[]): MappingPage {
  return { page: n, width: 1000, height: 1400, result: pageResult(lines), layout: analyzeLayout({ width: 1000, height: 1400, lines, marks: emptyMarks() }) };
}

const box = { x: 100, y: 100, width: 200, height: 20 };
function form(fields: [string, FieldSpec["type"], string, number?][]): Extraction {
  const out: ExtractedField[] = fields.map(([label, type, text, confidence = 90]) => {
    const spec: FieldSpec = { key: label.toLowerCase().replace(/\W+/g, "_"), label, type, required: false, options: type === "choice" ? ["Male", "Female"] : undefined };
    return { ...spec, value: makeValue(spec, text || text === "" ? { text, confidence: text ? confidence : null, mapping: 0.95, page: 1, box } : null) };
  });
  return { id: "x", templateId: "generic", forms: [{ page: 1, fields: out }], tables: [], summaries: [], unsupported: null, warnings: [] };
}
const valueOf = (x: Extraction, key: string) => x.forms[0].fields.find((f) => f.key === key)!.value;

describe("grounding", () => {
  const pageWords = [...words(100, 200, "Owner's Name: Juan Dela Cruz"), ...words(100, 250, "Address: Purok 2, Muzon")];

  it("finds a value among the words read and returns its region", () => {
    const found = findOnPage("Juan Dela Cruz", pageWords);
    expect(found?.text).toBe("Juan Dela Cruz");
    expect(found?.box).toMatchObject({ y: 200 });
    expect(findOnPage("Purok 2 Muzon", pageWords)?.score).toBeGreaterThan(0.85);
    expect(findOnPage("Pedro Penduko", pageWords)).toBeNull();
  });

  it("accepts small OCR fixes but not different values", () => {
    expect(isCloseCorrection("Juan Dela Crvz", "Juan Dela Cruz")).toBe(true);
    expect(isCloseCorrection("1O/18/2O26", "10/18/2026")).toBe(true);
    expect(isCloseCorrection("Juan Dela Cruz", "Maria Santos")).toBe(false);
    expect(isCloseCorrection("", "Juan")).toBe(false);
  });
});

describe("rule suggestions", () => {
  it("suggests standard forms and OCR slip fixes, never values for empty fields, and keeps leading zeros", () => {
    const x = form([
      ["Sex", "text", "lalaki"],
      ["Species", "text", "aso"],
      ["Visits", "number", "1O"],
      ["Date", "date", "Oct. 18, 2026"],
      ["Contact no.", "text", "09171234567"],
      ["Barangay", "text", ""],
    ]);
    const s = ruleSuggestions(x);
    expect(s.map((v) => [v.ref.id, v.after, v.kind, v.grounded])).toEqual([
      ["sex", "Male", "standardize", true],
      ["species", "Dog", "standardize", true],
      ["visits", "10", "correction", true],
      ["date", "2026-10-18", "standardize", true],
    ]);
    // Values the reviewer typed or checked get no suggestions.
    const checked = { ...x, forms: [{ ...x.forms[0], fields: x.forms[0].fields.map((f) => ({ ...f, value: { ...f.value, confirmed: true } })) }] };
    expect(ruleSuggestions(checked)).toEqual([]);
  });

  it("uses the template's standard forms (English and Filipino labels map to the same fields)", () => {
    const template = builtinTemplate("vet-registration")!;
    const extraction = extractDocument(template, [
      page(1, [line(200, [[100, "Buong Pangalan ng May-ari: juan dela cruz"]]), line(250, [[100, "Kasarian: M"]]), line(300, [[100, "Kulay/Palatandaan: Brown"]])]),
    ]);
    expect(valueOf(extraction, "owner_name").text).toBe("juan dela cruz");
    expect(valueOf(extraction, "color").text).toBe("Brown");
    const s = ruleSuggestions(extraction, templateRules(template, extraction));
    expect(s.find((x) => x.ref.id === "owner_name")?.after).toBe("Juan Dela Cruz");
    expect(s.find((x) => x.ref.id === "sex")?.after).toBe("Male");
  });

  it("suggests moving a value that landed in the wrong column", () => {
    const columns: FieldSpec[] = [
      { key: "name", label: "Pet name", type: "text", required: false },
      { key: "age", label: "Age", type: "number", required: false },
      { key: "sex", label: "Sex", type: "choice", required: false, options: ["Male", "Female"] },
    ];
    const cells = { name: makeValue(columns[0], { text: "Bantay", confidence: 90, mapping: 1, page: 1, box }), age: makeValue(columns[1], { text: "", confidence: null, mapping: 1, page: 1, box }), sex: makeValue(columns[2], { text: "3", confidence: 90, mapping: 1, page: 1, box }) };
    const x: Extraction = { id: "t", templateId: "vet-census", forms: [], tables: [{ key: "animals", label: "Animals", columns, rows: [{ id: "r1", page: 1, box, cells }] }], summaries: [], unsupported: null, warnings: [] };
    const [move] = ruleSuggestions(x).filter((s) => s.kind === "move");
    expect(move).toMatchObject({ ref: { id: "r1:sex" }, to: { id: "r1:age" }, after: "3" });
    const applied = acceptSuggestion({ ...x, suggestions: [move] }, move.id);
    expect(applied.tables[0].rows[0].cells.age.text).toBe("3");
    expect(applied.tables[0].rows[0].cells.sex.text).toBe("");
  });
});

describe("accepting and rejecting", () => {
  it("applies an accepted suggestion as an edit that keeps what OCR read, and records the source", () => {
    let x = form([["Sex", "text", "M"]]);
    x = { ...x, suggestions: ruleSuggestions(x) };
    const [s] = pendingSuggestions(x);
    x = acceptSuggestion(x, s.id);
    expect(valueOf(x, "sex")).toMatchObject({ text: "Male", ocrText: "M", edited: true, confirmed: true, suggestedBy: "rule" });
    expect(x.suggestions?.[0].status).toBe("accepted");
    expect(pendingSuggestions(x)).toEqual([]);
    // Dataset rows keep the original and where the value came from.
    const [draft] = extractionToDatasets(x, "doc", "Scan", [{ page: 1, fileId: "f", pdfPage: null, width: 1000, height: 1400 }]);
    const column = draft.content.columns[0].id;
    expect(draft.content.rows[0].source?.ocr).toMatchObject({ original: { [column]: "M" }, suggested: { [column]: "rule" } });
  });

  it("treats an edited suggestion as the reviewer's own value, and remembers rejections", () => {
    let x = form([["Sex", "text", "M"], ["Species", "text", "aso"]]);
    x = { ...x, suggestions: ruleSuggestions(x) };
    const [sex, species] = pendingSuggestions(x);
    x = acceptSuggestion(x, sex.id, "Female");
    expect(valueOf(x, "sex").suggestedBy).toBeUndefined();
    x = rejectSuggestion(x, species.id);
    expect(valueOf(x, "species").text).toBe("aso");
    expect(x.suggestions?.find((s) => s.id === species.id)?.status).toBe("rejected");
  });

  it("hides suggestions once the value changed since they were made", () => {
    let x = form([["Sex", "text", "M"]]);
    x = { ...x, suggestions: ruleSuggestions(x) };
    x = { ...x, forms: [{ ...x.forms[0], fields: [{ ...x.forms[0].fields[0], value: { ...x.forms[0].fields[0].value, text: "F" } }] }] };
    expect(pendingSuggestions(x)).toEqual([]);
  });
});

describe("handwriting and assistant suggestions", () => {
  it("offers confident handwriting readings, and flags unsure ones for typing instead of guessing", () => {
    const x = form([["Owner's name", "text", "Jvan Dla Cnz", 30], ["Pet's name", "text", "", 0], ["Color", "text", "Brwn", 40]]);
    const items = reviewItems(x);
    const next = withHandwritingReadings(x, [
      { ref: items[0].ref, text: "Juan Dela Cruz", confidence: 0.93 },
      { ref: items[1].ref, text: "Bantay", confidence: 0.9 },
      { ref: items[2].ref, text: "Brown", confidence: 0.41 },
    ]);
    expect(pendingSuggestions(next).map((s) => [s.ref.id, s.kind, s.after, s.source])).toEqual([
      ["owner_s_name", "correction", "Juan Dela Cruz", "handwriting"],
      ["pet_s_name", "fill", "Bantay", "handwriting"],
    ]);
    expect(valueOf(next, "color").flags).toContain("illegible");
    expect(reviewItems(next).find((i) => i.ref.id === "color")?.state).toBe("unreadable");
  });

  it("marks assistant corrections that change too much, and requested fields not on the page, as ungrounded", () => {
    const x = form([["Owner's name", "text", "Juan Dela Crvz", 60], ["Barangay", "text", "Muzon", 60]]);
    const items = reviewItems(x);
    const fixes = correctionSuggestions(x, new Map([[refKey(items[0].ref), "Juan Dela Cruz"], [refKey(items[1].ref), "Tungkong Mangga"]]));
    expect(fixes.map((s) => [s.after, s.grounded])).toEqual([["Juan Dela Cruz", true], ["Tungkong Mangga", false]]);
    expect(fixes[1].reason).toMatch(/^Not found on page/);

    const pageWords = words(100, 300, "Pet's Name: Bantay");
    expect(fieldSuggestion(items[1].ref, "", "Bantay", 1, pageWords)).toMatchObject({ grounded: true, after: "Bantay", page: 1 });
    expect(fieldSuggestion(items[1].ref, "", "Max", 1, pageWords)).toMatchObject({ grounded: false, box: null });
  });
});

describe("model replies are validated, never trusted", () => {
  const col = (name: string, type: DatasetColumn["type"] = "text"): DatasetColumn => ({ id: name.toLowerCase(), name, type, required: false, sourceHeader: name });
  const columns = [col("Owner"), col("Species"), col("Age", "number"), col("Vaccinated", "boolean")];

  it("pulls JSON out of chatty or fenced replies", () => {
    expect(extractJson('Sure! ```json\n{"a": "b}"}\n```')).toEqual({ a: "b}" });
    expect(() => extractJson("I can't do that")).toThrow();
    expect(() => extractJson('{"action": "filter"')).toThrow(/incomplete/);
  });

  it("turns a valid reply into a resolved command and rejects malformed, unsupported or invented ones", () => {
    const ok = parseCommandReply('{"action":"filter","where":[{"column":"species","op":"equals","value":"Dog"},{"column":"Vaccinated","op":"equals","value":false}]}', columns);
    expect(ok).toMatchObject({ ok: true, command: { action: "filter", where: [{ column: "species", value: "Dog" }, { column: "vaccinated", value: false }] } });
    expect(parseCommandReply("Here you go: show dogs", columns)).toMatchObject({ ok: false });
    expect(parseCommandReply('{"action":"unsupported","reason":"Salin cannot send email."}', columns)).toMatchObject({ ok: false, unsupported: true, message: /send email/ });
    expect(parseCommandReply('{"action":"drop_database"}', columns)).toMatchObject({ ok: false });
    expect(parseCommandReply('{"action":"filter","where":[{"column":"Barangay","op":"equals","value":"Muzon"}]}', columns)).toMatchObject({ ok: false, message: /no column called “Barangay”/ });
    expect(parseCommandReply('{"action":"filter","where":[{"column":"Age","op":"greater_than","value":"old"}]}', columns)).toMatchObject({ ok: false, message: /isn't a number/ });
  });

  it("drops filter conditions the request never mentioned (English or Filipino)", () => {
    const reply = '{"action":"filter","where":[{"column":"Species","op":"equals","value":"Cat"},{"column":"Owner","op":"equals","value":"Ana"}]}';
    expect(parseCommandReply(reply, columns, "only cats please")).toMatchObject({ ok: true, dropped: 1, command: { where: [{ column: "species", value: "Cat" }] } });
    const filipino = '{"action":"filter","where":[{"column":"Species","op":"equals","value":"Dog"},{"column":"Vaccinated","op":"equals","value":false}]}';
    expect(parseCommandReply(filipino, columns, "ipakita ang mga aso na hindi bakunado sa vaccinated list")).toMatchObject({ ok: true, command: { where: [{ value: "Dog" }, { value: false }] } });
    expect(parseCommandReply('{"action":"filter","where":[{"column":"Owner","op":"equals","value":"Ana"}]}', columns, "show the dogs")).toMatchObject({ ok: false });
    // Naming the column doesn't ground a value the model copied from its examples ("owner of Hector" → Owner = Ana).
    expect(parseCommandReply('{"action":"filter","where":[{"column":"Owner","op":"equals","value":"Ana"}]}', columns, "who is the owner of Hector?")).toMatchObject({ ok: false });
    expect(parseCommandReply('{"action":"filter","where":[{"column":"Age","op":"greater_than","value":3}]}', columns, "older than 3")).toMatchObject({ ok: true });
    expect(parseCommandReply('{"action":"delete_rows","where":[{"column":"Age","op":"greater_than","value":99}]}', columns, "delete rows with age greater than 3")).toMatchObject({ ok: false });
    expect(parseCommandReply('{"action":"filter","where":[{"column":"Age","op":"greater_than_or_equal","value":3}]}', columns, "age 3 and up")).toMatchObject({ ok: true, command: { where: [{ op: "at_least" }] } });
  });

  it("keeps only requested fields and treats null / n/a as not on the page", () => {
    const fields = [{ key: "owner", label: "Owner" }, { key: "breed", label: "Breed" }, { key: "email", label: "Email" }];
    expect(parseFieldReply('{"owner":"Juan Dela Cruz","breed":null,"email":"N/A","invented":"x"}', fields)).toEqual({ owner: "Juan Dela Cruz", breed: null, email: null });
    expect(() => parseFieldReply('["Juan"]', fields)).toThrow();
  });

  it("validates corrections and label mappings against what was asked", () => {
    const items = [{ id: "1", label: "Owner", type: "text", text: "Juan Dela Crvz" }];
    expect(parseCorrectionReply('{"1":"Juan Dela Cruz","9":"Nobody"}', items)).toEqual({ "1": "Juan Dela Cruz" });
    const fields = [{ key: "owner_name", label: "Owner's name" }, { key: "pet_name", label: "Pet's name" }];
    expect([...parseMappingReply('{"1":"owner_name","2":"owner_name","3":"nope","7":"pet_name"}', ["Pangalan ng May-ari", "Buong pangalan", "Lahi"], fields)]).toEqual([[0, "owner_name"]]);  });

  it("puts the real columns and a few values in the prompt, after examples on another table", () => {
    const messages = commandMessages("ipakita ang mga aso", columns, [{ id: "r", datasetId: "d", position: 0, source: null, values: { owner: "Ana", species: "Dog", age: 2, vaccinated: true } }]);
    const last = messages.at(-1)!.content;
    expect(last).toContain("Species (text; values: Dog)");
    expect(last).toContain("Vaccinated (yes/no true/false)");
    expect(last).toContain("Request: ipakita ang mga aso");
    expect(messages[0].content).toContain("unsupported");
  });
});

describe("handwriting decoding", () => {
  it("collapses repeats and blanks, scores confidence, and trims border fragments", () => {
    const classes = HANDWRITING_CHARACTERS.length;
    const index = (ch: string) => HANDWRITING_CHARACTERS.indexOf(ch);
    const steps = ["J", "J", "", "u", "a", "", "a", "n"].map((ch) => ch);
    const probs = new Float32Array(steps.length * classes);
    steps.forEach((ch, s) => (probs[s * classes + (ch ? index(ch) : 0)] = ch === "a" ? 0.6 : 0.9));
    const reading = decodeLine(probs, steps.length, classes);
    expect(reading.text).toBe("Juaan");
    expect(reading.confidence).toBeCloseTo((0.9 + 0.9 + 0.6 + 0.6 + 0.9) / 5);
    expect(cleanReading("|Juan Cruz_ ")).toBe("Juan Cruz");
    expect(HANDWRITING_CHARACTERS).toContain("ñ");
  });

  it("treats a crop without ink as empty", () => {
    const width = 20;
    const white = new Uint8ClampedArray(48 * width * 4).fill(255);
    expect(lineTensor(white, width)).toBeNull();
    const ink = white.slice();
    for (let i = 0; i < 48 * 4; i++) ink.set([0, 0, 0, 255], i * 4 * 2);
    expect(lineTensor(ink, width)?.length).toBe(3 * 48 * width);
  });
});

describe("models, modes and sources", () => {
  const caps = (patch: Partial<DeviceCapabilities> = {}): DeviceCapabilities => ({
    webAssembly: true,
    wasmSimd: true,
    wasmRelaxedSimd: false,
    wasmThreads: false,
    webGpu: "available",
    webGpuF16: true,
    workers: true,
    offscreenCanvas: true,
    deviceMemoryGb: 8,
    cpuCores: 8,
    cacheStorage: true,
    camera: true,
    secureContext: true,
    mobile: true,
    userAgent: "test",
    ...patch,
  });

  it("recommends a mode from the device and, when measured, the assistant's speed", () => {
    expect(recommendAiMode(caps()).mode).toBe("advanced");
    expect(recommendAiMode(caps({ webGpu: "unsupported" })).mode).toBe("lite");
    expect(recommendAiMode(caps({ deviceMemoryGb: 3 })).mode).toBe("lite");
    expect(recommendAiMode(caps({ deviceMemoryGb: 1 })).mode).toBe("standard");
    expect(recommendAiMode(caps({ workers: false })).mode).toBe("standard");
    expect(recommendAiMode(caps({ webGpu: "unsupported" }), 6).mode).toBe("advanced");
    expect(recommendAiMode(caps(), 40).mode).toBe("lite");
  });

  it("downloads the GPU build only when WebGPU can run it, and only from approved hosts", () => {
    expect(variantFor(AI_MODELS.assistant, caps()).dtype).toBe("q4f16");
    expect(variantFor(AI_MODELS.assistant, caps({ webGpuF16: false })).device).toBe("wasm");
    // Phones keep the small build; WebGPU laptops with 8 GB get the larger one; without WebGPU or the memory figure, the regular build.
    expect(variantFor(AI_MODELS.assistant, caps()).laptop).toBeUndefined();
    expect(variantFor(AI_MODELS.assistant, caps({ mobile: false }))).toMatchObject({ laptop: true, device: "webgpu", webllm: "Qwen3-1.7B-q4f16_1-MLC" });
    expect(variantFor(AI_MODELS.assistant, caps({ mobile: false, deviceMemoryGb: 4 })).laptop).toBeUndefined();
    expect(variantFor(AI_MODELS.assistant, caps({ mobile: false, deviceMemoryGb: null })).laptop).toBeUndefined();
    expect(variantFor(AI_MODELS.assistant, caps({ mobile: false, webGpu: "unsupported" })).device).toBe("wasm");
    vi.stubGlobal("location", { href: "http://localhost:4173/settings" });
    expect(isApprovedModelUrl("https://huggingface.co/x/resolve/abc/model.onnx")).toBe(true);
    expect(isApprovedModelUrl("/assets/ort.wasm")).toBe(true);
    expect(isApprovedModelUrl("https://cdn.example.com/model.onnx")).toBe(false);
    vi.unstubAllGlobals();
    for (const variant of AI_MODELS.assistant.variants) {
      const { repo, revision } = variantSource(AI_MODELS.assistant, variant);
      // Engines (ONNX Runtime, WebLLM's compiled model code) are served by Salin; model files come from the pinned revision.
      for (const asset of variant.assets) if (asset.id !== "ai-runtime" && !/:(lib|engine)$/.test(asset.id)) expect(asset.url).toContain(`/${repo}/resolve/${revision}/`);
    }
    // WebLLM's files go where WebLLM looks for them, so it never downloads anything itself; its engine module stays in Salin's cache.
    const laptop = AI_MODELS.assistant.variants.find((v) => v.webllm)!;
    expect(new Set(laptop.assets.map((a) => a.cache))).toEqual(new Set([undefined, "webllm/wasm", "webllm/config", "webllm/model"]));
    expect(laptop.assets.filter((a) => /params_shard_\d+\.bin$/.test(a.url)).reduce((sum, a) => sum + a.bytes, 0)).toBe(968_001_536);
    // Files Salin serves itself: the recorded sizes must be the shipped files' (a WebLLM upgrade must update them).
    const shipped = { "assistant-laptop:engine": "node_modules/@mlc-ai/web-llm/lib/index.js", "assistant-laptop:lib": "src/core/ai/webllm/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm" };
    for (const [id, file] of Object.entries(shipped)) expect(laptop.assets.find((a) => a.id === id)!.bytes).toBe(statSync(file).size);
  });
});

describe("templates and structure", () => {
  it("suggests the template whose labels appear on the page (English or Filipino)", () => {
    const pages = [page(1, [line(200, [[100, "Buong Pangalan ng May-ari: Juan Dela Cruz"]]), line(250, [[100, "Kumpletong Lokasyon ng Tirahan: Purok 2"]]), line(300, [[100, "Pangalan ng Aso: Bantay"]]), line(350, [[100, "Kulay/Palatandaan: Brown"]]), line(400, [[100, "Kasarian: Lalaki"]]), line(450, [[100, "Lahi: Aspin"]])])];
    const [best] = suggestTemplates(BUILTIN_TEMPLATES, pages);
    expect(best.template.id).toBe("vet-registration");
    expect(best.found).toBeGreaterThanOrEqual(5);
    expect(suggestTemplates(BUILTIN_TEMPLATES, [page(1, [line(200, [[100, "Grocery list: eggs, rice"]])])])).toEqual([]);
  });

  it("maps several documents of the same layout with a saved template", () => {
    const template = builtinTemplate("vet-registration")!;
    const people = [["Juan Dela Cruz", "Bantay"], ["Maria Santos", "Mingming"], ["Pedro Reyes", "Brownie"]];
    for (const [owner, pet] of people) {
      const x = extractDocument(template, [page(1, [line(200, [[100, `Owner's Name: ${owner}`]]), line(250, [[100, "Address: Purok 2, Muzon"]]), line(300, [[100, `Pet's Name: ${pet}`]])])]);
      expect([valueOf(x, "owner_name").text, valueOf(x, "pet_name").text]).toEqual([owner, pet]);
    }
  });

  it("names unnamed columns from their values, conservatively", () => {
    expect(suggestColumnName(["M", "F", "Lalaki", "F"])).toBe("Sex");
    expect(suggestColumnName(["Dog", "aso", "Cat"])).toBe("Species");
    expect(suggestColumnName(["10/18/2026", "2026-01-02"])).toBe("Date");
    expect(suggestColumnName(["0917 123 4567", "09281234567"])).toBe("Contact no.");
    expect(suggestColumnName(["Juan", "Maria"])).toBeNull();
    expect(suggestColumnName(["Dog"])).toBeNull();
    const col = (id: string, name: string) => ({ id, name, type: "text" as const, required: false, sourceHeader: null });
    const rows = [{ values: { a: "M", b: "F", c: "Juan", d: "Dog" } }, { values: { a: "F", b: "M", c: "Ana", d: "Cat" } }];
    // Given names win; a suggestion is used once; nothing fits → the placeholder stays.
    expect(nameColumns({ columns: [col("a", "Column 1"), col("b", "Column 2"), col("c", "Column 3"), col("d", "Kind")], rows }, { 2: " Owner " }).map((c) => c.name)).toEqual(["Sex", "Column 2", "Owner", "Kind"]);
  });

  it("splits repeated record blocks on one page into separate records", () => {
    const x = extractDocument(null, [page(1, [line(200, [[100, "Owner: Juan"]]), line(250, [[100, "Pet: Bantay"]]), line(300, [[100, "Owner: Maria"]]), line(350, [[100, "Pet: Ming"]])])]);
    expect(x.forms.map((f) => f.fields.map((v) => v.value.text))).toEqual([
      ["Juan", "Bantay"],
      ["Maria", "Ming"],
    ]);
    const [draft] = extractionToDatasets(x, "doc", "Scan", [{ page: 1, fileId: "f", pdfPage: null, width: 1000, height: 1400 }]);
    expect(draft.content.rows).toHaveLength(2);
  });

  it("keeps pages with different layouts in separate datasets instead of merging them", () => {
    const x = extractDocument(null, [
      page(1, [line(200, [[100, "Owner: Juan"]]), line(250, [[100, "Pet: Bantay"]])]),
      page(2, [line(200, [[100, "Owner: Maria"]]), line(250, [[100, "Pet: Ming"]])]),
      page(3, [line(200, [[100, "Invoice No: 42"]]), line(250, [[100, "Amount: 500"]]), line(300, [[100, "Paid: Yes"]])]),
    ]);
    const refs = [1, 2, 3].map((p) => ({ page: p, fileId: "f", pdfPage: null, width: 1000, height: 1400 }));
    const drafts = extractionToDatasets(x, "doc", "Scan", refs);
    expect(drafts.map((d) => [d.name, d.content.rows.length])).toEqual([
      ["Scan – Forms 1", 2],
      ["Scan – Forms 2", 1],
    ]);
  });
});

describe("AI runtime", () => {
  beforeEach(() => vi.stubGlobal("location", { href: "http://localhost/" }));
  afterEach(() => vi.unstubAllGlobals());

  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    sent: { id: number; type: string }[] = [];
    reply: (request: { id: number; type: string }) => unknown;
    constructor(reply: (request: { id: number; type: string }) => unknown) {
      this.reply = reply;
    }
    postMessage(request: { id: number; type: string }) {
      this.sent.push(request);
      const result = this.reply(request);
      if (result === "hang") return;
      setTimeout(() => this.onmessage?.({ data: result } as MessageEvent));
    }
    terminate() {
      this.terminated = true;
    }
  }

  it("runs requests one at a time and reports missing model files clearly", async () => {
    const workers: FakeWorker[] = [];
    const runtime = createAiRuntime(() => {
      const w = new FakeWorker((r) => (r.type === "read-lines" ? { id: r.id, type: "result", result: [{ text: "Bantay", confidence: 0.9, empty: false }] } : { id: r.id, type: "error", code: "missing-files", message: "x" }));
      workers.push(w);
      return w as never;
    }, async () => undefined);
    const [a, b] = await Promise.all([runtime.readLines([]), runtime.readLines([])]);
    expect(a[0].text).toBe("Bantay");
    expect(b).toHaveLength(1);
    expect(workers).toHaveLength(1);
    const error = await runtime.generate([], variantFor(AI_MODELS.assistant, null)).catch((e) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe("missing-files");
    expect(error.message).toMatch(/Settings → On-device AI/);
  });

  it("stops the worker on cancel, freeing its memory, and starts a fresh one next time", async () => {
    const workers: FakeWorker[] = [];
    let hang = true;
    const runtime = createAiRuntime(() => {
      const w = new FakeWorker((r) => (hang ? "hang" : { id: r.id, type: "result", result: "ok" }));
      workers.push(w);
      return w as never;
    }, async () => undefined);
    const controller = new AbortController();
    const pending = runtime.generate([], variantFor(AI_MODELS.assistant, null), { signal: controller.signal });
    await new Promise((r) => setTimeout(r));
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(workers[0].terminated).toBe(true);
    hang = false;
    expect(await runtime.generate([], variantFor(AI_MODELS.assistant, null))).toBe("ok");
    expect(workers).toHaveLength(2);
  });
});
