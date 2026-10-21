/**
 * Language-Model Evaluation (opt-in)
 * Benchmarks candidate local language models on Salin's real prompts:
 * plain-language requests (English and Filipino) about a veterinary
 * dataset, scored by whether the reply becomes the right validated command,
 * questions asked in AI Studio ("how many…", "extract only the…"), scored
 * by whether the read-only query plan is right and grounded in the question,
 * plus requested-field extraction from a form's text, scored by exact
 * values and by "null instead of guessing" for fields that aren't there.
 * Runs in Node with the same model weights the app downloads. Skipped
 * unless SALIN_LLM_EVAL is set, e.g.:
 *   SALIN_LLM_EVAL=onnx-community/Qwen2.5-0.5B-Instruct:q8 npx vitest run src/core/ai/llm-eval.test.ts
 * Results are written to docs/benchmarks/llm-eval-*.json.
 */

import { mkdir, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { commandMessages, dataQuestionMessages, fieldMessages, parseCommandReply, parseDataQuestionPlan, parseFieldReply, type ChatMessage, type DataQuestionPlan } from "@/core/ai/llm-tasks";
import { findColumn, type DatasetCommand } from "@/core/processing/dataset-commands";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

const SPEC = process.env.SALIN_LLM_EVAL;

const col = (name: string, type: DatasetColumn["type"] = "text"): DatasetColumn => ({ id: name.toLowerCase().replace(/\W+/g, "_"), name, type, required: false, sourceHeader: name });
const COLUMNS = [col("Owner"), col("Barangay"), col("Pet name"), col("Species"), col("Sex"), col("Age", "number"), col("Vaccinated", "boolean"), col("Date registered", "date"), col("Contact no.")];
const SAMPLE: [string, string, string, string, string, number, boolean, string, string][] = [
  ["Juan Dela Cruz", "Muzon", "Bantay", "Dog", "Male", 2, true, "2026-03-14", "09171234567"],
  ["Maria Santos", "Tungkong Mangga", "Mingming", "Cat", "Female", 1, false, "2026-07-02", "09281234567"],
  ["Pedro Reyes", "Gaya-gaya", "Brownie", "Dog", "Female", 5, false, "2026-08-21", ""],
];
const ROWS: DatasetRow[] = SAMPLE.map((values, i) => ({ id: `r${i}`, datasetId: "d", position: i, source: null, values: Object.fromEntries(COLUMNS.map((c, j) => [c.id, values[j]])) }));

const id = (name: string) => findColumn(COLUMNS, name)!.id;
type Check = (c: DatasetCommand) => boolean;
const where = (c: DatasetCommand) => ("where" in c && c.where ? c.where : []);
/** Exactly this many conditions: extra, invented conditions count as wrong. */
const n = (c: DatasetCommand, count: number) => where(c).length === count;
const has = (c: DatasetCommand, column: string, op: string | string[], value?: unknown) =>
  where(c).some((w) => w.column === id(column) && (Array.isArray(op) ? op.includes(w.op) : w.op === op) && (value === undefined || String(w.value).toLowerCase() === String(value).toLowerCase()));

const CASES: { request: string; check: Check | "unsupported" }[] = [
  { request: "Show only dogs", check: (c) => c.action === "filter" && n(c, 1) && has(c, "Species", "equals", "dog") },
  { request: "Show unvaccinated dogs in Barangay Muzon", check: (c) => c.action === "filter" && n(c, 3) && has(c, "Species", "equals", "dog") && has(c, "Vaccinated", "equals", false) && has(c, "Barangay", ["equals", "contains"], "muzon") },
  { request: "sort by owner name", check: (c) => c.action === "sort" && c.by[0].column === id("Owner") && c.by[0].direction === "asc" },
  { request: "oldest pets first", check: (c) => c.action === "sort" && c.by[0].column === id("Age") && c.by[0].direction === "desc" },
  { request: "rename Pet name to Name of pet", check: (c) => c.action === "rename_column" && c.column === id("Pet name") && c.to.toLowerCase() === "name of pet" },
  { request: "make Age a number column", check: (c) => c.action === "change_type" && c.column === id("Age") && c.to === "number" },
  { request: "how many pets per barangay", check: (c) => c.action === "summarize" && c.group_by[0] === id("Barangay") && c.aggregate === "count" },
  { request: "count dogs and cats", check: (c) => c.action === "summarize" && c.group_by[0] === id("Species") && c.aggregate === "count" },
  { request: "average age by species", check: (c) => c.action === "summarize" && c.group_by[0] === id("Species") && c.aggregate === "average" && c.column === id("Age") },
  { request: "standardize the sex column", check: (c) => c.action === "normalize" && c.column === id("Sex") && c.rule === "sex" },
  { request: "capitalize the owner names properly", check: (c) => c.action === "normalize" && c.column === id("Owner") && c.rule === "title_case" },
  { request: "find duplicate pets", check: (c) => c.action === "find_duplicates" && (c.columns.length === 0 || c.columns.includes(id("Pet name"))) },
  { request: "mark all cats in Tungkong Mangga as vaccinated", check: (c) => c.action === "set_value" && n(c, 2) && c.column === id("Vaccinated") && c.value === true && has(c, "Species", "equals", "cat") && has(c, "Barangay", ["equals", "contains"], "tungkong mangga") },
  { request: "delete rows with no owner", check: (c) => c.action === "delete_rows" && n(c, 1) && has(c, "Owner", "is_empty") },
  { request: "show pets registered after June 30, 2026", check: (c) => c.action === "filter" && n(c, 1) && (has(c, "Date registered", "greater_than", "2026-06-30") || has(c, "Date registered", "at_least", "2026-07-01")) },
  { request: "Ipakita ang mga aso sa Muzon", check: (c) => c.action === "filter" && n(c, 2) && has(c, "Species", "equals", "dog") && has(c, "Barangay", ["equals", "contains"], "muzon") },
  { request: "Ilan ang alagang hayop bawat barangay?", check: (c) => c.action === "summarize" && c.group_by[0] === id("Barangay") },
  { request: "show pets without a contact number", check: (c) => c.action === "filter" && n(c, 1) && has(c, "Contact no.", "is_empty") },
  { request: "show female dogs older than 3", check: (c) => c.action === "filter" && n(c, 3) && has(c, "Sex", "equals", "female") && has(c, "Species", "equals", "dog") && (has(c, "Age", "greater_than", 3) || has(c, "Age", "at_least", 4)) },
  { request: "summarize this dataset", check: (c) => c.action === "summarize" && c.group_by.length === 0 },
  { request: "send this list to my email", check: "unsupported" },
  { request: "print a bar chart of the species", check: "unsupported" },
  { request: "Pagsunod-sunurin ayon sa edad", check: (c) => c.action === "sort" && c.by[0].column === id("Age") },
  { request: "change Bantay's species to Cat", check: (c) => c.action === "set_value" && n(c, 1) && c.column === id("Species") && String(c.value).toLowerCase() === "cat" && has(c, "Pet name", ["equals", "contains"], "bantay") },
];

/** Different wordings, never used while writing the prompt: the honest accuracy figure. */
const HELD_OUT: { request: string; check: Check | "unsupported" }[] = [
  { request: "only cats please", check: (c) => c.action === "filter" && n(c, 1) && has(c, "Species", "equals", "cat") },
  { request: "list pets from Gaya-gaya that are not vaccinated", check: (c) => c.action === "filter" && n(c, 2) && has(c, "Barangay", ["equals", "contains"], "gaya-gaya") && has(c, "Vaccinated", "equals", false) },
  { request: "youngest first", check: (c) => c.action === "sort" && c.by[0].column === id("Age") && c.by[0].direction === "asc" },
  { request: "how many are vaccinated?", check: (c) => (c.action === "summarize" && c.group_by[0] === id("Vaccinated")) || (c.action === "filter" && n(c, 1) && has(c, "Vaccinated", "equals", true)) },
  { request: "total number of pets per species", check: (c) => c.action === "summarize" && c.group_by[0] === id("Species") && c.aggregate === "count" },
  { request: "rename Contact no. to Phone", check: (c) => c.action === "rename_column" && c.column === id("Contact no.") && c.to.toLowerCase() === "phone" },
  { request: "fix the species values", check: (c) => c.action === "normalize" && c.column === id("Species") && c.rule === "species" },
  { request: "remove pets older than 10", check: (c) => c.action === "delete_rows" && n(c, 1) && (has(c, "Age", "greater_than", 10) || has(c, "Age", "at_least", 11)) },
  { request: "set Barangay to Muzon for Juan Dela Cruz", check: (c) => c.action === "set_value" && n(c, 1) && c.column === id("Barangay") && String(c.value).toLowerCase() === "muzon" && has(c, "Owner", ["equals", "contains"], "juan dela cruz") },
  { request: "Ilan ang aso at pusa?", check: (c) => c.action === "summarize" && c.group_by[0] === id("Species") },
  { request: "show dogs registered in 2026", check: (c) => c.action === "filter" && has(c, "Species", "equals", "dog") && (has(c, "Date registered", "at_least", "2026-01-01") || has(c, "Date registered", "greater_than", "2025-12-31")) },
  { request: "translate this table to Japanese", check: "unsupported" },
];

type PlanCheck = (p: DataQuestionPlan, where: DatasetCommand | null) => boolean;
const cols = (p: DataQuestionPlan, ...names: string[]) => p.action === "table" && (p.columns ?? []).length === names.length && names.every((name) => (p.columns ?? []).some((c) => findColumn(COLUMNS, c)?.id === id(name)));
const none = (w: DatasetCommand | null) => w === null || n(w, 0);

/** AI Studio questions: the model plans a read-only query; its filter must be the one asked for (checked like the app does). */
const QUESTIONS: { request: string; set: "dev" | "held-out"; check: PlanCheck | "unsupported" }[] = [
  { set: "dev", request: "How many dogs are there?", check: (p, w) => p.action === "count" && !!w && n(w, 1) && has(w, "Species", "equals", "dog") },
  { set: "dev", request: "Ilan ang babae?", check: (p, w) => p.action === "count" && !!w && n(w, 1) && has(w, "Sex", "equals", "female") },
  { set: "dev", request: "What is the contact number of Juan Dela Cruz?", check: (p, w) => !!w && n(w, 1) && has(w, "Owner", ["equals", "contains"], "juan dela cruz") && cols(p, "Contact no.") },
  { set: "dev", request: "Extract only the owners and barangays", check: (p, w) => none(w) && cols(p, "Owner", "Barangay") },
  { set: "dev", request: "Extract the pet names of the dogs only", check: (p, w) => !!w && n(w, 1) && has(w, "Species", "equals", "dog") && cols(p, "Pet name") },
  { set: "dev", request: "Show the owners from Muzon", check: (p, w) => p.action === "table" && !!w && n(w, 1) && has(w, "Barangay", ["equals", "contains"], "muzon") },
  { set: "dev", request: "List the unvaccinated pets", check: (p, w) => p.action === "table" && !!w && n(w, 1) && has(w, "Vaccinated", "equals", false) },
  { set: "dev", request: "Which pets are older than 3?", check: (p, w) => p.action === "table" && !!w && n(w, 1) && (has(w, "Age", "greater_than", 3) || has(w, "Age", "at_least", 4)) },
  { set: "dev", request: "How many pets in each barangay?", check: (p, w) => p.action === "group" && p.group_by.length === 1 && findColumn(COLUMNS, p.group_by[0])?.id === id("Barangay") && p.aggregate === "count" && none(w) },
  { set: "dev", request: "What is the average age per species?", check: (p) => p.action === "group" && findColumn(COLUMNS, p.group_by[0] ?? "")?.id === id("Species") && p.aggregate === "average" && findColumn(COLUMNS, p.column ?? "")?.id === id("Age") },
  { set: "dev", request: "Give me an overview", check: (p) => p.action === "overview" || (p.action === "group" && p.group_by.length === 0) },
  { set: "dev", request: "Send this to my boss", check: "unsupported" },
  { set: "held-out", request: "Extract the contact numbers only", check: (p, w) => none(w) && cols(p, "Contact no.") },
  { set: "held-out", request: "Who owns Bantay?", check: (p, w) => !!w && n(w, 1) && has(w, "Pet name", ["equals", "contains"], "bantay") && cols(p, "Owner") },
  { set: "held-out", request: "Get only the female cats", check: (p, w) => p.action === "table" && !!w && n(w, 2) && has(w, "Sex", "equals", "female") && has(w, "Species", "equals", "cat") },
  { set: "held-out", request: "Ano ang pangalan ng alaga ni Maria Santos?", check: (p, w) => !!w && n(w, 1) && has(w, "Owner", ["equals", "contains"], "maria santos") && cols(p, "Pet name") },
  { set: "held-out", request: "how many were registered after June 2026?", check: (p, w) => p.action === "count" && !!w && n(w, 1) && (has(w, "Date registered", "greater_than", "2026-06-30") || has(w, "Date registered", "at_least", "2026-07-01")) },
  { set: "held-out", request: "What is the highest age?", check: (p) => p.action === "group" && p.aggregate === "max" && findColumn(COLUMNS, p.column ?? "")?.id === id("Age") },
  { set: "held-out", request: "pull out the barangay and contact no. of the cats", check: (p, w) => !!w && n(w, 1) && has(w, "Species", "equals", "cat") && cols(p, "Barangay", "Contact no.") },
  { set: "held-out", request: "Make me a pie chart", check: "unsupported" },
];

const FORM_TEXT = [
  "CITY VETERINARY OFFICE",
  "DOG REGISTRATION DATA BASE FORM",
  "DATE REGISTERED: 10/18/2026        CONTACT NUMBER: 0917 555 0142",
  "PET OWNER'S FULL NAME: Juan Dela Cruz",
  "Buong Pangalan ng May-ari",
  "COMPLETE ADDRESS: Purok 2, Brgy. Muzon",
  "DOG'S NAME: Bantay         COLOR/MARKINGS: Brown and white",
  "SEX: [x] MALE [ ] FEMALE",
  "REMARKS:",
];
const FIELDS = [
  { key: "owner_name", label: "Owner's name" },
  { key: "address", label: "Address" },
  { key: "contact", label: "Contact number" },
  { key: "pet_name", label: "Pet's name" },
  { key: "color", label: "Color" },
  { key: "breed", label: "Breed" },
  { key: "email", label: "Email" },
];
const EXPECTED: Record<string, string | null> = { owner_name: "Juan Dela Cruz", address: "Purok 2, Brgy. Muzon", contact: "0917 555 0142", pet_name: "Bantay", color: "Brown and white", breed: null, email: null };

describe.skipIf(!SPEC)("local language model evaluation", () => {
  it("turns requests into the right commands and copies fields without guessing", { timeout: 6 * 3_600_000 }, async () => {
    const [model, dtype = "q8"] = SPEC!.split(":");
    const { AutoModelForCausalLM, AutoTokenizer, env } = await import("@huggingface/transformers");
    env.cacheDir = process.env.SALIN_HF_CACHE ?? "./node_modules/.cache/hf";
    const fetched = new Set<string>();
    const fetchImpl = env.fetch;
    env.fetch = (url: string | URL, init?: unknown) => {
      fetched.add(String(url));
      return fetchImpl(url, init);
    };
    const started = performance.now();
    const tokenizer = await AutoTokenizer.from_pretrained(model);
    const lm = await AutoModelForCausalLM.from_pretrained(model, { dtype: dtype as "q8" });
    const loadMs = performance.now() - started;

    let asked = 0;
    async function ask(messages: ChatMessage[], maxNewTokens = 160) {
      const options = { add_generation_prompt: true, return_dict: true, enable_thinking: false } as { add_generation_prompt: boolean; return_dict: true };
      const inputs = tokenizer.apply_chat_template(messages, options) as unknown as Record<string, unknown>;
      const t0 = performance.now();
      const output = (await lm.generate({ ...inputs, max_new_tokens: maxNewTokens, do_sample: false })) as { slice: (...a: unknown[]) => unknown };
      const promptLength = (inputs.input_ids as { dims: number[] }).dims.at(-1)!;
      const text = tokenizer.batch_decode(output.slice(null, [promptLength, null]) as never, { skip_special_tokens: true })[0];
      console.log(`· ${++asked} ${Math.round((performance.now() - t0) / 1000)} s`);
      return { text, ms: performance.now() - t0 };
    }

    const commands = [];
    for (const c of [...CASES.map((x) => ({ ...x, set: "dev" })), ...HELD_OUT.map((x) => ({ ...x, set: "held-out" }))]) {
      const { text, ms } = await ask(commandMessages(c.request, COLUMNS, ROWS));
      const parsed = parseCommandReply(text, COLUMNS, c.request);
      const correct = c.check === "unsupported" ? !parsed.ok && parsed.unsupported === true : parsed.ok && c.check(parsed.command);
      commands.push({ set: c.set, request: c.request, reply: text.trim(), valid: parsed.ok || parsed.unsupported === true, correct, ms: Math.round(ms) });
    }

    const questions = [];
    for (const q of QUESTIONS) {
      const { text, ms } = await ask(dataQuestionMessages(q.request, COLUMNS, ROWS), 240);
      let correct = false;
      let valid = false;
      try {
        const plan = parseDataQuestionPlan(text, q.request);
        valid = true;
        if (q.check === "unsupported") correct = plan.action === "unsupported";
        else if (plan.action !== "unsupported") {
          const conditions = "where" in plan ? plan.where : undefined;
          // Same check the app applies before running a plan: conditions the question doesn't state are dropped.
          const checked = conditions?.length ? parseCommandReply(JSON.stringify({ action: "filter", where: conditions }), COLUMNS, q.request) : null;
          correct = (!checked || checked.ok) && q.check(plan, checked?.ok ? checked.command : null);
        }
      } catch {
        // an unparseable plan stays invalid and wrong
      }
      questions.push({ set: q.set, request: q.request, reply: text.trim(), valid, correct, ms: Math.round(ms) });
    }

    const { text: fieldText, ms: fieldMs } = await ask(fieldMessages(FORM_TEXT, FIELDS));
    let fields: Record<string, string | null> = {};
    try {
      fields = parseFieldReply(fieldText, FIELDS);
    } catch {
      fields = {};
    }
    const fieldScores = Object.entries(EXPECTED).map(([key, want]) => ({ key, want, got: fields[key] ?? null, correct: (fields[key] ?? null)?.toLowerCase() === want?.toLowerCase() }));

    const summary = {
      model,
      dtype,
      loadMs: Math.round(loadMs),
      commandAccuracy: commands.filter((c) => c.set === "dev" && c.correct).length / CASES.length,
      heldOutAccuracy: commands.filter((c) => c.set === "held-out" && c.correct).length / HELD_OUT.length,
      validReplies: commands.filter((c) => c.valid).length / commands.length,
      questionAccuracy: questions.filter((q) => q.set === "dev" && q.correct).length / questions.filter((q) => q.set === "dev").length,
      heldOutQuestionAccuracy: questions.filter((q) => q.set === "held-out" && q.correct).length / questions.filter((q) => q.set === "held-out").length,
      meanQuestionMs: Math.round(questions.reduce((s, q) => s + q.ms, 0) / questions.length),
      meanCommandMs: Math.round(commands.reduce((s, c) => s + c.ms, 0) / commands.length),
      fieldAccuracy: fieldScores.filter((f) => f.correct).length / fieldScores.length,
      inventedFields: fieldScores.filter((f) => f.want === null && f.got !== null).map((f) => f.key),
      fieldMs: Math.round(fieldMs),
      files: [...fetched],
    };
    console.log(JSON.stringify({ ...summary, files: undefined }, null, 1));
    console.table([...commands, ...questions].map((c) => ({ ok: c.correct ? "✓" : "✗", request: c.request.slice(0, 40), reply: c.reply.slice(0, 90) })));
    await mkdir("docs/benchmarks", { recursive: true });
    await writeFile(`docs/benchmarks/llm-eval-${model.replace(/\W+/g, "_")}-${dtype}.json`, JSON.stringify({ summary, commands, questions, fieldScores, fieldReply: fieldText }, null, 2));
    expect(commands.length).toBe(CASES.length + HELD_OUT.length);
  });
});
