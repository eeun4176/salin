/**
 * Language-Model Tasks
 * The prompts Salin gives the local language model and the strict checks on
 * what comes back. The model only ever returns small JSON objects: a
 * dataset command for a plain-language request, values for requested
 * fields, corrections of OCR slips, or label-to-field mappings. Every reply is parsed with zod; anything malformed, unsupported or
 * not matching the dataset/document is rejected with an explanation —
 * nothing the model says is applied without validation and the user's OK.
 */

import { z } from "zod";

import { displayValue, resolveCommand, type DatasetCommand } from "@/core/processing/dataset-commands";
import { normalizeValue, NORMALIZE_RULES } from "@/core/processing/value-normalizers";
import { parseNumber } from "@/core/processing/dataset-inference";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The first complete JSON object or array in a reply (models sometimes add prose or ``` fences). */
export function extractJson(reply: string): unknown {
  const start = reply.search(/[{[]/);
  if (start < 0) throw new SyntaxError("No JSON in the reply.");
  const open = reply[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(reply.slice(start, i + 1));
  }
  throw new SyntaxError("The JSON in the reply is incomplete.");
}

/* ------------------------------------------------------------------
   Natural language → dataset command
------------------------------------------------------------------- */

const TYPE_NAME = { text: "text", number: "number", date: "date YYYY-MM-DD", boolean: "yes/no true/false" } as const;

/** "Species (text: Dog, Cat)" — a column with a few of its values, so names like “Muzon” can be placed. */
function describeColumn(column: DatasetColumn, rows: DatasetRow[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = displayValue(row.values[column.id] ?? null).trim();
    if (value && value.length <= 60) seen.add(value);
    if (seen.size > 12) break;
  }
  const values = seen.size <= 12 ? [...seen] : [...seen].slice(0, 3);
  return `${column.name} (${TYPE_NAME[column.type]}${values.length && column.type !== "boolean" ? `; ${seen.size <= 12 ? "values" : "examples"}: ${values.join(", ")}` : ""})`;
}

const COMMAND_RULES = `Reply with ONE JSON object and nothing else. Use these actions (C = a column name, V = a value):
{"action":"filter","where":[{"column":C,"op":OP,"value":V}],"match":"all"}
{"action":"sort","by":[{"column":C,"direction":"asc" or "desc"}]}
{"action":"rename_column","column":C,"to":"new name"}
{"action":"change_type","column":C,"to":"text" or "number" or "date" or "boolean"}
{"action":"summarize","group_by":[C],"aggregate":"count" or "sum" or "average" or "min" or "max","column":C}
{"action":"normalize","column":C,"rule":RULE}
{"action":"set_value","column":C,"value":V,"where":[{"column":C,"op":OP,"value":V}]}
{"action":"find_duplicates","columns":[C]}
{"action":"delete_rows","where":[{"column":C,"op":OP,"value":V}]}
{"action":"keep_columns","columns":[C]}
{"action":"unsupported","reason":"why"}
OP is one of: equals, not_equals, contains, starts_with, is_empty, not_empty, greater_than, less_than, at_least, at_most.
RULE is one of: ${Object.keys(NORMALIZE_RULES).join(", ")}.
Yes/no values are true or false. Dates are YYYY-MM-DD. "summarize" with an empty group_by gives an overview.
Use only the columns listed. If the request needs anything else (sending, printing, charts, other files), reply with "unsupported".`;

/** One example per action, on a made-up table (so the model learns the shapes, not these columns). */
const EXAMPLE_COLUMNS = "Columns: Name (text: Ana Cruz, Ben Ramos), Town (text: Malolos, Baliwag), Gender (text: M, F), Paid (yes/no true/false), Amount (number), Due (date YYYY-MM-DD), Phone (text)";
const COMMAND_EXAMPLES: [string, string][] = [
  ["show unpaid people in Baliwag", '{"action":"filter","where":[{"column":"Town","op":"equals","value":"Baliwag"},{"column":"Paid","op":"equals","value":false}],"match":"all"}'],
  ["who has no phone number", '{"action":"filter","where":[{"column":"Phone","op":"is_empty"}],"match":"all"}'],
  ["amounts over 500 due after March 2026", '{"action":"filter","where":[{"column":"Amount","op":"greater_than","value":500},{"column":"Due","op":"greater_than","value":"2026-03-31"}],"match":"all"}'],
  ["biggest amounts first", '{"action":"sort","by":[{"column":"Amount","direction":"desc"}]}'],
  ["ilan ang tao sa bawat town?", '{"action":"summarize","group_by":["Town"],"aggregate":"count"}'],
  ["total amount per town", '{"action":"summarize","group_by":["Town"],"aggregate":"sum","column":"Amount"}'],
  ["give me an overview", '{"action":"summarize","group_by":[],"aggregate":"count"}'],
  ["clean up the gender values", '{"action":"normalize","column":"Gender","rule":"sex"}'],
  ["make the names proper case", '{"action":"normalize","column":"Name","rule":"title_case"}'],
  ["call the Phone column Mobile", '{"action":"rename_column","column":"Phone","to":"Mobile"}'],
  ["mark Ben Ramos as paid", '{"action":"set_value","column":"Paid","value":true,"where":[{"column":"Name","op":"equals","value":"Ben Ramos"}]}'],
  ["remove rows without a name", '{"action":"delete_rows","where":[{"column":"Name","op":"is_empty"}]}'],
  ["any duplicate people?", '{"action":"find_duplicates","columns":["Name"]}'],
  ["keep only the name and amount columns", '{"action":"keep_columns","columns":["Name","Amount"]}'],
  ["email this to my boss", '{"action":"unsupported","reason":"Salin can only change or summarize the table on this device."}'],
];

export function commandMessages(request: string, columns: DatasetColumn[], rows: DatasetRow[]): ChatMessage[] {
  const header = `Columns: ${columns.map((c) => describeColumn(c, rows)).join(", ")}`;
  return [
    { role: "system", content: `You turn a request about a data table into a JSON command.\n${COMMAND_RULES}\n\nIn the examples the table is:\n${EXAMPLE_COLUMNS}` },
    ...COMMAND_EXAMPLES.flatMap(([user, assistant]): ChatMessage[] => [
      { role: "user", content: `Request: ${user}` },
      { role: "assistant", content: assistant },
    ]),
    { role: "user", content: `Now the real table. Use only these columns and only the conditions the request asks for.\n${header}\nRequest: ${request.trim().slice(0, 500)}` },
  ];
}

/* ------------------------------------------------------------------
   Questions about the data (read-only plans; Salin computes the answer)
------------------------------------------------------------------- */

/** A constrained query plan. The model describes intent; app code executes it. */
export type DataQuestionPlan =
  | { action: "count"; where?: { column: string; op: string; value?: string | number | boolean | null }[] }
  | { action: "table"; where?: { column: string; op: string; value?: string | number | boolean | null }[]; match?: "all" | "any"; columns?: string[]; limit?: number }
  | { action: "group"; where?: { column: string; op: string; value?: string | number | boolean | null }[]; group_by: string[]; aggregate: "count" | "sum" | "average" | "min" | "max"; column?: string }
  | { action: "overview" }
  | { action: "unsupported"; reason?: string };

const DATA_QUESTION_RULES = `Turn the latest question into ONE read-only query JSON object and nothing else. The app runs it over every row; never calculate or guess results.
{"action":"count","where":[{"column":C,"op":OP,"value":V}]}
{"action":"table","where":[{"column":C,"op":OP,"value":V}],"match":"all","columns":[C]}
{"action":"group","group_by":[C],"aggregate":"count" or "sum" or "average" or "min" or "max","column":C,"where":[]}
{"action":"overview"}
{"action":"unsupported","reason":"why"}
OP is one of: equals, not_equals, contains, starts_with, is_empty, not_empty, greater_than, less_than, at_least, at_most.
- count: "how many", "ilan". table: show, list, extract, look up a field. group: totals, averages, highest, lowest, per category.
- "where" holds ONLY the conditions the question states, with values copied from the question. Never copy example values from the column list. Omit "where" when the question has no condition.
- "columns" lists the fields the question asks to see or extract; they never go in "where". Omit "columns" to show whole rows.
- match "any" only when the question asks for alternatives ("or").
- For a follow-up, "those"/"sila" means the previous result: keep its conditions.
- Anything else (sending, printing, charts, other files) is unsupported.`;

/** One example per shape, on a made-up table (so the model learns the shapes, not these columns). */
const DATA_QUESTION_EXAMPLES: [string, string][] = [
  ["How many people are in Baliwag?", '{"action":"count","where":[{"column":"Town","op":"equals","value":"Baliwag"}]}'],
  ["ilan ang hindi pa bayad?", '{"action":"count","where":[{"column":"Paid","op":"equals","value":false}]}'],
  ["What is the phone of Ben Ramos?", '{"action":"table","where":[{"column":"Name","op":"equals","value":"Ben Ramos"}],"columns":["Phone"]}'],
  ["Extract only the names and amounts", '{"action":"table","columns":["Name","Amount"]}'],
  ["Extract the names of the people from Malolos only", '{"action":"table","where":[{"column":"Town","op":"equals","value":"Malolos"}],"columns":["Name"]}'],
  ["Who owes more than 500?", '{"action":"table","where":[{"column":"Amount","op":"greater_than","value":500}]}'],
  ["Total amount per town", '{"action":"group","group_by":["Town"],"aggregate":"sum","column":"Amount"}'],
  ["What is the biggest amount?", '{"action":"group","group_by":[],"aggregate":"max","column":"Amount"}'],
  ["Give me an overview", '{"action":"overview"}'],
  ["Make a chart of this", '{"action":"unsupported","reason":"I can answer questions about the data but cannot make charts."}'],
];

/** Includes a short recent conversation, while keeping the current dataset schema explicit. */
export function dataQuestionMessages(request: string, columns: DatasetColumn[], rows: DatasetRow[], history: ChatMessage[] = []): ChatMessage[] {
  const header = `Columns: ${columns.map((c) => describeColumn(c, rows)).join(", ")}`;
  return [
    { role: "system", content: `You plan exact read-only queries over a data table.\n${DATA_QUESTION_RULES}\n\nIn the examples the table is:\n${EXAMPLE_COLUMNS}` },
    ...DATA_QUESTION_EXAMPLES.flatMap(([user, assistant]): ChatMessage[] => [
      { role: "user", content: `Question: ${user}` },
      { role: "assistant", content: assistant },
    ]),
    ...history.slice(-6),
    { role: "user", content: `Now the real table. Use only these columns and only the conditions the question states.\n${header}\nQuestion: ${request.trim().slice(0, 500)}` },
  ];
}

/** Parses the model's plan. With the question, a list the model made for "how many…" becomes the count that was asked for. */
export function parseDataQuestionPlan(reply: string, request?: string): DataQuestionPlan {
  const json = extractJson(reply);
  const scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
  const condition = z.object({ column: z.string().min(1).max(120), op: z.enum(["equals", "not_equals", "contains", "not_contains", "starts_with", "is_empty", "not_empty", "greater_than", "less_than", "at_least", "at_most"]), value: scalar.optional() });
  // Small models repeat or leave blank output columns; each named column is kept once.
  const names = z.array(z.string().max(120)).max(30).transform((list) => [...new Set(list.filter((name) => name.trim()))]);
  const schema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("count"), where: z.array(condition).max(10).optional() }),
    z.object({ action: z.literal("table"), where: z.array(condition).max(10).optional(), match: z.enum(["all", "any"]).optional(), columns: names.optional(), limit: z.number().int().min(1).max(100).optional() }),
    z.object({ action: z.literal("group"), where: z.array(condition).max(10).optional(), group_by: z.array(z.string().min(1).max(120)).max(3), aggregate: z.enum(["count", "sum", "average", "min", "max"]), column: z.string().min(1).max(120).optional() }),
    z.object({ action: z.literal("overview") }),
    z.object({ action: z.literal("unsupported"), reason: z.string().max(300).optional() }),
  ]);
  const plan = schema.parse(json) as DataQuestionPlan;
  if (plan.action === "table" && request && /\b(how many|ilan)\b/i.test(request)) return { action: "count", where: plan.where };
  return plan;
}

export type CommandReply = { ok: true; command: DatasetCommand; dropped?: number } | { ok: false; message: string; unsupported?: boolean };

const RULES_FOR_WORDS = ["sex", "species", "yes_no"] as const;

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean);

/** True when the request names the column, loosely ("pet names" → Pet name, "contact numbers" → Contact no., "unvaccinated" → Vaccinated). */
export function mentionsColumn(column: DatasetColumn, request: string) {
  const words = wordsOf(request);
  return column.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((part) => part.length > 2 && words.some((w) => w.startsWith(part.slice(0, 5)) || w.includes(part.slice(0, 6))));
}

/**
 * Small models add conditions nobody asked for ("only cats" → also "Sex is
 * Female"). A condition is kept only when the request mentions its column or
 * its value — directly, as a number or year, or as a known synonym
 * ("aso" → Dog, "unvaccinated" → Vaccinated). A text value must itself be
 * in the request.
 */
function groundedCondition(condition: { column: string; op: string; value?: unknown }, request: string, columns: DatasetColumn[]) {
  const text = request.toLowerCase();
  const words = wordsOf(request);
  const column = columns.find((c) => c.id === condition.column);
  const stem = (w: string) => w.replace(/(es|s)$/, "");
  const mentions = (needle: string) => {
    const n = needle.toLowerCase().trim();
    return n !== "" && (text.includes(n) || words.some((w) => stem(w) === stem(n)));
  };
  const value = condition.value;
  if (typeof value === "number") return (request.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).some((number) => parseNumber(number) === value);
  // Naming the column ("email of Hector") doesn't vouch for a text value copied from the column's examples.
  const needsValue = column?.type === "text" && typeof value === "string" && value.trim() !== "";
  if (!needsValue && column && mentionsColumn(column, request)) return true;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    if (mentions(value)) return true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return text.includes(value.slice(0, 4));
    return RULES_FOR_WORDS.some((rule) => {
      const expected = String(normalizeValue(rule, value)).toLowerCase();
      return words.some((w) => String(normalizeValue(rule, w)).toLowerCase() === expected);
    });
  }
  return false;
}

/** Operator spellings models use for the ones Salin knows ("greater_than_or_equal" → at_least). */
const OPERATOR_ALIASES: Record<string, string> = {
  greater_than_or_equal: "at_least",
  greater_than_or_equal_to: "at_least",
  gte: "at_least",
  less_than_or_equal: "at_most",
  less_than_or_equal_to: "at_most",
  lte: "at_most",
  gt: "greater_than",
  lt: "less_than",
  eq: "equals",
  not_equal: "not_equals",
  ne: "not_equals",
};

function withOperatorAliases(json: unknown): unknown {
  if (!json || typeof json !== "object" || !Array.isArray((json as { where?: unknown }).where)) return json;
  const where = (json as { where: unknown[] }).where.map((c) =>
    c && typeof c === "object" && typeof (c as { op?: unknown }).op === "string" ? { ...c, op: OPERATOR_ALIASES[(c as { op: string }).op] ?? (c as { op: string }).op } : c,
  );
  return { ...json, where };
}

/** Parses and validates the model's reply against the dataset (and, for its conditions, against the request). */
export function parseCommandReply(reply: string, columns: DatasetColumn[], request?: string): CommandReply {
  let json: unknown;
  try {
    json = extractJson(reply);
  } catch {
    return { ok: false, message: "The assistant's answer wasn't a command e-Vet can run. Try rewording, or use the Transform tools." };
  }
  const unsupported = z.object({ action: z.literal("unsupported"), reason: z.string().max(300).optional() }).safeParse(json);
  if (unsupported.success) {
    return { ok: false, unsupported: true, message: `That isn't something e-Vet can do with this table${unsupported.data.reason ? `: ${unsupported.data.reason}` : "."}` };
  }
  const resolved = resolveCommand(withOperatorAliases(json), columns);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const command = resolved.command;
  if (!request || !("where" in command) || !command.where) return resolved;
  const kept = command.where.filter((c) => groundedCondition(c, request, columns));
  if (kept.length === command.where.length) return resolved;
  if (kept.length === 0) return { ok: false, message: "The assistant's answer didn't match what you asked. Try rewording, or use Transform." };
  return { ok: true, command: { ...command, where: kept }, dropped: command.where.length - kept.length };
}

/* ------------------------------------------------------------------
   Requested fields from a page's text
------------------------------------------------------------------- */

export interface RequestedField {
  key: string;
  label: string;
}

export function fieldMessages(lines: string[], fields: RequestedField[]): ChatMessage[] {
  const keys = fields.map((f) => `"${f.key}": ${f.label}`).join("\n");
  return [
    {
      role: "system",
      content:
        "You copy values from the text of a scanned form. Reply with ONE JSON object whose keys are the field keys. Copy each value exactly as it is written in the text. If a field's value is not in the text, use null — never guess or make up a value. The text may mix English and Filipino.",
    },
    { role: "user", content: `Fields:\n${keys}\n\nText:\n${lines.join("\n").slice(0, 3500)}` },
  ];
}

/** Values the model returned for the requested keys (`null` = not in the text). Other keys are ignored. */
export function parseFieldReply(reply: string, fields: RequestedField[]): Record<string, string | null> {
  const json = z.record(z.string(), z.union([z.string(), z.number(), z.null()])).parse(extractJson(reply));
  return Object.fromEntries(
    fields.map((f) => {
      const raw = json[f.key];
      const text = raw === null || raw === undefined ? "" : String(raw).trim();
      return [f.key, text && !/^(null|n\/a|none|unknown)$/i.test(text) ? text.slice(0, 300) : null];
    }),
  );
}

/* ------------------------------------------------------------------
   OCR corrections
------------------------------------------------------------------- */

export interface CorrectionInput {
  id: string;
  label: string;
  type: string;
  text: string;
}

export function correctionMessages(items: CorrectionInput[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        'You fix text-recognition slips in values read from scanned Philippine documents (names, places, dates, numbers). Common slips: 0/O, 1/l/I, 5/S, 8/B, rn/m, cl/d. Reply with ONE JSON object mapping an id to the corrected value, only for values that clearly contain a slip. Keep the meaning, spelling of names, and leading zeros. Do not translate, complete, or guess missing words. Reply {} if nothing needs fixing.',
    },
    { role: "user", content: items.map((i) => `${i.id} | ${i.label} (${i.type}) | ${i.text}`).join("\n") },
  ];
}

export function parseCorrectionReply(reply: string, items: CorrectionInput[]): Record<string, string> {
  const json = z.record(z.string(), z.union([z.string(), z.number()])).parse(extractJson(reply));
  const out: Record<string, string> = {};
  for (const item of items) {
    const value = json[item.id];
    if (value === undefined) continue;
    const text = String(value).trim().slice(0, 300);
    if (text && text !== item.text) out[item.id] = text;
  }
  return out;
}

/* ------------------------------------------------------------------
   Label → template field mapping
------------------------------------------------------------------- */

export function mappingMessages(labels: string[], fields: RequestedField[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You match the printed labels of a form (English or Filipino) to the fields of a template. Reply with ONE JSON object mapping a label number to a field key, only where the label clearly asks for that field. Leave out labels that match no field.",
    },
    { role: "user", content: `Fields:\n${fields.map((f) => `${f.key}: ${f.label}`).join("\n")}\n\nLabels:\n${labels.map((l, i) => `${i + 1}: ${l}`).join("\n")}` },
  ];
}

/** label index (0-based) → field key, only for known keys and labels; each field used once. */
export function parseMappingReply(reply: string, labels: string[], fields: RequestedField[]): Map<number, string> {
  const json = z.record(z.string(), z.string()).parse(extractJson(reply));
  const keys = new Set(fields.map((f) => f.key));
  const used = new Set<string>();
  const out = new Map<number, string>();
  for (const [index, key] of Object.entries(json)) {
    const i = Number(index) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= labels.length || !keys.has(key) || used.has(key)) continue;
    used.add(key);
    out.set(i, key);
  }
  return out;
}
