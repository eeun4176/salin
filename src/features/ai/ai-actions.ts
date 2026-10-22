/**
 * AI Actions
 * What the review and dataset screens ask the on-device AI to do, each
 * returning suggestions (never applied directly) as an `apply` function the
 * screen runs on its latest extraction — so edits made while the model was
 * working aren't lost: read handwriting in the
 * regions the template mapping located, suggest fixes for recognition slips,
 * find requested or missing fields in a page's text (grounded in the words
 * read), and turn a plain-language request into
 * a validated dataset command. Models run in the AI worker; when they're
 * missing or the device can't run them, a clear error says what to do.
 */

import { aiRuntime, type AiCallOptions } from "@/core/ai/ai-runtime";
import { CENSUS_LETTER_FIELDS, CENSUS_TEMPLATE_ID, censusLetterRows, joinLetterRows, tidyCensusReading } from "@/core/census/census-extraction";
import { runQuery } from "@/core/ai/data-query";
import { parseQuestion, type ParsedQuestion } from "@/core/ai/question-parser";
import type { AiModelVariant } from "@/core/ai/ai-models";
import { commandMessages, correctionMessages, dataQuestionMessages, fieldMessages, mappingMessages, mentionsColumn, parseCommandReply, parseCorrectionReply, parseDataQuestionPlan, parseFieldReply, parseMappingReply, type ChatMessage, type CommandReply, type DataQuestionPlan } from "@/core/ai/llm-tasks";
import { findColumn, resolveCommand, runCommand, type CommandOutcome } from "@/core/processing/dataset-commands";
import { normalizeLabel } from "@/core/ocr/templates/text-match";
import { normalizeValue, ruleForLabel } from "@/core/processing/value-normalizers";
import { correctionSuggestions, fieldSuggestion, mergeSuggestions, withHandwritingReadings, type HandwritingReading } from "@/core/ai/suggestions";
import { refKey, reviewItems } from "@/core/ocr/review/review-state";
import { makeValue } from "@/core/ocr/templates/field-mapping";
import { keyFromLabel } from "@/core/ocr/templates/template-schema";
import { readOnCityVetServer, type ServerRow } from "@/core/census/city-vet-reader";
import { cropImages, cropLines } from "@/features/ai/line-crops";
import { ensureProcessed } from "@/features/ocr/ocr-runner";
import type { Extraction, ExtractedField, FieldSpec, OcrPage, Suggestion, ValueRef } from "@/types/ocr";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

export type DataQuestionAnswer =
  | { kind: "text"; text: string; understood?: string }
  | { kind: "unsupported"; text: string; fallbackToCommand?: boolean }
  | { kind: "table"; text: string; headers: string[]; rows: (string | number | boolean | null)[][]; totalRows: number; understood?: string };

/** Question words that also turn up inside cell values ("Boyd and Sons"), so they never count as naming one. */
const QUESTION_WORDS = new Set(["and", "the", "for", "with", "who", "how", "are", "what", "many", "only", "there", "from", "all", "get", "show", "list", "extract", "give", "ang", "mga", "ilan", "sino", "ano"]);

/** True when the question names a value from the data: a word of any cell, plural or not ("dogs" → Dog, "Pedro" → Pedro Reyes). */
function questionNamesDataValue(request: string, columns: DatasetColumn[], rows: DatasetRow[]) {
  const stem = (word: string) => word.replace(/(es|s)$/, "");
  const columnWords = new Set(columns.flatMap((column) => normalizeLabel(column.name).split(" ")).map(stem));
  const asked = new Set(normalizeLabel(request).split(" ").filter((w) => w.length > 2 && !QUESTION_WORDS.has(w)).map(stem).filter((w) => !columnWords.has(w)));
  if (!asked.size) return false;
  for (const column of columns) {
    const rule = ruleForLabel(column.name);
    for (const row of rows) {
      const value = row.values[column.id];
      if (value === null || value === undefined || value === "") continue;
      const labels = [String(value)];
      if (rule) labels.push(String(normalizeValue(rule, value, column.type)));
      if (labels.some((label) => normalizeLabel(label).split(" ").some((w) => w.length > 2 && asked.has(stem(w))))) return true;
    }
  }
  return false;
}

function queryRows(where: Extract<DataQuestionPlan, { action: "count" | "table" | "group" }>["where"], request: string, history: ChatMessage[], columns: DatasetColumn[], rows: DatasetRow[], match: "all" | "any" = "all") {
  if (!where?.length) return rows;
  const groundingText = [...history.map((m) => m.content), request].join("\n");
  const checked = parseCommandReply(JSON.stringify({ action: "filter", where, match }), columns, groundingText);
  // Conditions the question doesn't state are dropped (small models copy example values in); if none is left, it asks for a rewording.
  if (!checked.ok) {
    // Unless the question names no value from the data at all: then it asked about every row ("extract only the names and emails").
    const valid = parseCommandReply(JSON.stringify({ action: "filter", where, match }), columns);
    if (valid.ok && !questionNamesDataValue(request, columns, rows)) return rows;
    throw new Error(checked.message);
  }
  const conditions = checked.command.action === "filter" ? checked.command.where : [];
  const normalizedRows = rows.map((row) => {
    const values = { ...row.values };
    for (const condition of conditions) {
      const column = columns.find((candidate) => candidate.id === condition.column);
      const rule = column ? ruleForLabel(column.name) : null;
      const value = values[condition.column];
      if (column && rule && typeof value === "string") values[condition.column] = normalizeValue(rule, value, column.type);
    }
    return { ...row, values };
  });
  const outcome = runCommand(checked.command, { columns, rows: normalizedRows });
  if (outcome.kind !== "view") throw new Error("The assistant couldn't make a valid data filter. Try rewording the question.");
  const selected = new Set(outcome.rowIds);
  return rows.filter((row) => selected.has(row.id));
}

const LOOKUP_COLUMN_ALIASES: Record<string, string[]> = {
  email: ["email", "e mail", "email address", "e mail address"],
  phone: ["phone", "telephone", "mobile", "mobile number", "phone number", "contact number"],
  address: ["address", "home address", "location"],
  name: ["name", "full name", "person name"],
};

function includesPhrase(text: string, phrase: string) {
  return ` ${normalizeLabel(text)} `.includes(` ${normalizeLabel(phrase)} `);
}

function outputColumnWasRequested(request: string, column: DatasetColumn) {
  if (mentionsColumn(column, request)) return true;
  return Object.entries(LOOKUP_COLUMN_ALIASES).some(([alias, synonyms]) => synonyms.includes(normalizeLabel(column.name)) && includesPhrase(request, alias));
}

function tableAnswer(title: string, headers: string[], values: (string | number | boolean | null)[][], totalRows: number): DataQuestionAnswer {
  const shown = values.slice(0, 100);
  const suffix = totalRows > shown.length ? ` Showing the first ${shown.length.toLocaleString()}.` : "";
  return { kind: "table", text: `${title} ${totalRows.toLocaleString()} ${totalRows === 1 ? "row" : "rows"}.${suffix}`, headers, rows: shown, totalRows };
}

/** The answer to a question as the reader understood it, worked out over every row. */
function readAnswer(parsed: ParsedQuestion, columns: DatasetColumn[], rows: DatasetRow[]): DataQuestionAnswer {
  const result = runQuery(parsed.query, columns, rows);
  // Words it couldn't place are said, so a partial reading is never passed off as the whole question.
  const unread = parsed.confident ? "" : ` ${parsed.note ?? `I didn't use: “${parsed.unknown.join("”, “")}”.`}`;
  if (parsed.query.give === "count") return { kind: "text", text: `${result.text}${unread}`, understood: parsed.understood };
  return { kind: "table", text: `${result.text}${unread}`, headers: result.headers, rows: result.rows as (string | number | boolean | null)[][], totalRows: result.total, understood: parsed.understood };
}

/**
 * Answers a read-only question about a dataset. The rule-based reader goes first: when it understands every word, that's the answer — at once,
 * with no model. Names that aren't in the data are said to be missing. Otherwise the local model plans the query; when it can't (or isn't set
 * up), the reader's partial reading is given, with the words it didn't use.
 */
export async function answerDataQuestion(
  request: string,
  columns: DatasetColumn[],
  rows: DatasetRow[],
  variant: AiModelVariant | null,
  history: ChatMessage[] = [],
  options: AiCallOptions = {},
): Promise<DataQuestionAnswer> {
  const parsed = parseQuestion(request, columns, rows);
  if (parsed?.notFound.length) {
    const names = parsed.notFound.map((name) => `“${name}”`).join(", ");
    return { kind: "text", text: `I couldn't find ${names} in this dataset, so no rows match. Check the spelling, or ask about a value that's in the data.`, understood: parsed.understood };
  }
  if (parsed?.confident) return readAnswer(parsed, columns, rows);
  if (!variant) return parsed ? readAnswer(parsed, columns, rows) : { kind: "unsupported", text: "I couldn't tell what to look up. Name a column or a value from the data, or set up the on-device assistant in AI settings for freer questions." };
  try {
    return await answerWithModel(request, columns, rows, variant, history, options);
  } catch (error) {
    if (parsed && !options.signal?.aborted) return readAnswer(parsed, columns, rows);
    throw error;
  }
}

/** Plans a read-only data question with the local model, then computes it over the complete dataset in Salin. */
async function answerWithModel(request: string, columns: DatasetColumn[], rows: DatasetRow[], variant: AiModelVariant, history: ChatMessage[], options: AiCallOptions): Promise<DataQuestionAnswer> {
  const reply = await aiRuntime.generate(dataQuestionMessages(request, columns, rows, history), variant, { ...options, maxNewTokens: 240 });
  let plan = parseDataQuestionPlan(reply, request);
  // "How many … in each country?": small models plan one count; the question asks for a count per group.
  const per = /\b(?:each|per|every|bawat)\s+([^?.!]+)/i.exec(request)?.[1];
  const perColumn = per ? columns.find((column) => mentionsColumn(column, per)) : undefined;
  if (plan.action === "count" && perColumn) plan = { action: "group", group_by: [perColumn.name], aggregate: "count", where: plan.where?.filter((w) => findColumn(columns, w.column)?.id !== perColumn.id) };

  if (plan.action === "unsupported") return { kind: "unsupported", text: plan.reason ?? "I couldn't tell which data operation you want. Could you rephrase the question?" };
  if (plan.action === "count") {
    if (!plan.where?.length && questionNamesDataValue(request, columns, rows)) return { kind: "unsupported", fallbackToCommand: false, text: "I noticed a value from the dataset in your question, but couldn't tell which column to count. Please name the column or rephrase the filter." };
    const matches = queryRows(plan.where, request, history, columns, rows);
    return { kind: "text", text: `${matches.length.toLocaleString()} ${matches.length === 1 ? "row" : "rows"} match${matches.length === 1 ? "es" : ""} in this dataset.` };
  }
  if (plan.action === "table") {
    if (!plan.where?.length && questionNamesDataValue(request, columns, rows)) return { kind: "unsupported", fallbackToCommand: false, text: "I noticed a value from the dataset in your question, but couldn't tell which column to show. Please name the column or rephrase the filter." };
    const matches = queryRows(plan.where, request, history, columns, rows, plan.match ?? "all");
    const selectedColumns = plan.columns?.map((name) => findColumn(columns, name));
    if (selectedColumns?.some((column) => !column)) throw new Error("The requested table includes a column that isn't in this dataset.");
    // The rows are already checked against the question; if the model picked columns nobody named, show whole rows rather than its guess.
    const requested = selectedColumns?.length && selectedColumns.every((column) => column && outputColumnWasRequested(request, column));
    const outputColumns: DatasetColumn[] = requested ? selectedColumns.filter((column): column is DatasetColumn => column !== null) : columns;
    const limit = Math.min(plan.limit ?? 50, 100);
    const outputRows = matches.slice(0, limit).map((row) => outputColumns.map((column) => row.values[column.id] ?? null));
    const answer = tableAnswer(`${matches.length.toLocaleString()} matching`, outputColumns.map((column) => column.name), outputRows, matches.length);
    return { ...answer, text: `${matches.length.toLocaleString()} matching ${matches.length === 1 ? "row" : "rows"}.${matches.length > outputRows.length ? ` Showing ${outputRows.length.toLocaleString()}.` : ""}` };
  }

  const resolved = resolveCommand(
    plan.action === "overview"
      ? { action: "summarize", group_by: [], aggregate: "count" }
      : { action: "summarize", group_by: plan.group_by, aggregate: plan.aggregate, column: plan.column },
    columns,
  );
  if (!resolved.ok) throw new Error(resolved.message);
  const filteredRows = plan.action === "group" ? queryRows(plan.where, request, history, columns, rows) : rows;
  const command = resolved.command.action === "summarize" ? { ...resolved.command, where: undefined } : resolved.command;
  const outcome: CommandOutcome = runCommand(command, { columns, rows: filteredRows });
  if (outcome.kind !== "table") throw new Error("The assistant couldn't create that summary. Try rewording the question.");
  return tableAnswer(outcome.title, outcome.headers, outcome.rows as (string | number | boolean | null)[][], outcome.rows.length);
}

/* ------------------------------------------------------------------
   Handwriting
------------------------------------------------------------------- */

const READABLE_TYPES = new Set<FieldSpec["type"]>(["text", "number", "date"]);
const HARD_FLAGS = new Set(["possibly-handwritten", "low-confidence", "unclear-characters", "type-mismatch"]);

/** Values worth reading as handwriting: hard-to-read or empty boxes (template fields and table cells) not yet checked by the reviewer. */
export function handwritingTargets(extraction: Extraction) {
  // On census sheets every letter-box value is handwriting: printed-text OCR can be confidently wrong there.
  const census = extraction.templateId === CENSUS_TEMPLATE_ID;
  return reviewItems(extraction).filter(
    ({ value, spec }) =>
      value.box &&
      value.page &&
      READABLE_TYPES.has(spec.type) &&
      !value.edited &&
      !value.confirmed &&
      (census ? CENSUS_LETTER_FIELDS.has(spec.key) : !value.text.trim() || value.flags.some((f) => HARD_FLAGS.has(f))),
  );
}

export interface AiResult {
  /** Adds the suggestions (and flags) to an extraction. */
  apply: (extraction: Extraction) => Extraction;
  /** How many suggestions were offered. */
  offered: number;
}

/** Reads handwriting in the target regions; suggestions for confident readings, "illegible" flags for the rest. */
export async function readHandwriting(extraction: Extraction, pages: OcrPage[], options: AiCallOptions = {}): Promise<AiResult & { read: number }> {
  const targets = handwritingTargets(extraction);
  const readings: HandwritingReading[] = [];
  const byPage = new Map<number, typeof targets>();
  for (const t of targets) byPage.set(t.value.page!, [...(byPage.get(t.value.page!) ?? []), t]);
  let done = 0;
  for (const [pageNumber, items] of byPage) {
    const page = pages[pageNumber - 1];
    // Census sheets keep a copy without box lines, which the reader would take for 1s and Is.
    const blob = page ? (page.handwriting ?? (await ensureProcessed(page))) : null;
    if (!blob) continue;
    // Census letter boxes are read row by row, one character per written box; other values as one line.
    const plans = items.map((item) => censusLetterRows(extraction, pages, item.ref) ?? [{ box: item.value.box!, slots: undefined, allowed: undefined }]);
    const rows = plans.flat();
    const crops = await cropLines(blob, rows.map((r) => r.box), rows.map((r) => r.slots), rows.map((r) => r.allowed), rows.map((r) => ("gaps" in r ? r.gaps : undefined)));
    const results = await aiRuntime.readLines(crops, {
      ...options,
      onProgress: (p) => options.onProgress?.({ ...p, fraction: (done + (p.fraction ?? 0) * items.length) / targets.length }),
    });
    done += items.length;
    let at = 0;
    plans.forEach((plan, i) => {
      const parts = results.slice(at, (at += plan.length));
      if (parts.every((r) => r.empty)) return;
      const read = parts.filter((r) => !r.empty);
      const text = plan[0].slots ? joinLetterRows(extraction, pages, items[i].ref, read.map((r) => r.text)) : tidyCensusReading(extraction, pages, items[i].ref, read[0].text);
      readings.push({ ref: items[i].ref, text, confidence: Math.min(...read.map((r) => r.confidence)) });
    });
  }
  const offered = (withHandwritingReadings(extraction, readings).suggestions ?? []).filter((s) => s.source === "handwriting" && s.status === "pending").length;
  return { apply: (current) => withHandwritingReadings(current, readings), read: readings.length, offered };
}

/**
 * Census sheets, online: sends only the written letter-box rows to the City
 * Vet server's reader (see city-vet-reader.ts). Readings that fit their boxes
 * come back as suggestions, like the on-device reader's.
 */
export async function readOnCityVet(extraction: Extraction, pages: OcrPage[], options: AiCallOptions = {}): Promise<AiResult & { read: number }> {
  const rows: ServerRow[] = [];
  const plans = new Map<string, { ref: ValueRef; slots: { spaceBefore: boolean }[][] }>();
  for (const item of handwritingTargets(extraction)) {
    const plan = censusLetterRows(extraction, pages, item.ref);
    const page = pages[item.value.page! - 1];
    const blob = page ? (page.handwriting ?? (await ensureProcessed(page))) : null;
    if (!plan?.length || !blob) continue;
    const images = await cropImages(blob, plan.map((r) => r.box));
    const key = refKey(item.ref);
    // Letter boxes: the reading must have one character per written box. Open lines: any length (boxes 0).
    plan.forEach((row, k) => rows.push({ id: `${key}#${k}`, image: images[k], boxes: row.slots.length, allowed: row.allowed }));
    plans.set(key, { ref: item.ref, slots: plan.map((r) => r.slots) });
  }
  const results = new Map((await readOnCityVetServer(rows, { signal: options.signal })).map((r) => [r.id, r]));
  const readings: HandwritingReading[] = [];
  for (const [key, { ref, slots }] of plans) {
    const parts = slots.map((_, k) => results.get(`${key}#${k}`));
    if (parts.some((p) => !p)) continue;
    // Spaces where the sheet has empty boxes, whatever spacing the server used.
    const texts = parts.map((p, k) => {
      if (!slots[k].length) return p!.text.replace(/\s+/g, " ").trim();
      const chars = [...p!.text.replace(/\s+/g, "")];
      return slots[k].map((slot, i) => (slot.spaceBefore ? " " : "") + chars[i]).join("");
    });
    readings.push({ ref, text: joinLetterRows(extraction, pages, ref, texts), confidence: Math.min(...parts.map((p) => p!.confidence)) });
  }
  const offered = (withHandwritingReadings(extraction, readings).suggestions ?? []).filter((s) => s.source === "handwriting" && s.status === "pending").length;
  return { apply: (current) => withHandwritingReadings(current, readings), read: readings.length, offered };
}

/* ------------------------------------------------------------------
   Language-model suggestions on a scan
------------------------------------------------------------------- */

const CORRECTION_FLAGS = new Set(["low-confidence", "unclear-characters", "type-mismatch"]);

/** Asks the assistant to fix recognition slips in values that look doubtful. */
export async function suggestCorrections(extraction: Extraction, variant: AiModelVariant, options: AiCallOptions = {}): Promise<AiResult> {
  const items = reviewItems(extraction)
    .filter(({ value }) => value.text.trim() && !value.edited && !value.confirmed && value.flags.some((f) => CORRECTION_FLAGS.has(f)))
    .slice(0, 25);
  if (items.length === 0) return { apply: (x) => x, offered: 0 };
  const inputs = items.map((item, i) => ({ id: String(i + 1), label: item.spec.label, type: item.spec.type, text: item.value.text }));
  const reply = await aiRuntime.generate(correctionMessages(inputs), variant, { ...options, maxNewTokens: 400 });
  const fixes = parseCorrectionReply(reply, inputs);
  const byRef = new Map(Object.entries(fixes).map(([id, text]) => [refKey(items[Number(id) - 1].ref), text]));
  return { apply: (current) => ({ ...current, suggestions: mergeSuggestions(current.suggestions, correctionSuggestions(current, byRef), "ai") }), offered: correctionSuggestions(extraction, byRef).length };
}

function addField(extraction: Extraction, group: number, spec: FieldSpec): Extraction {
  return { ...extraction, forms: extraction.forms.map((form, g) => (g !== group || form.fields.some((f) => f.key === spec.key) ? form : { ...form, fields: [...form.fields, { ...spec, value: makeValue(spec, null) } satisfies ExtractedField] })) };
}

/**
 * Finds requested fields (generic forms) or a template's missing fields in
 * each form page's text. Every value must be found among the words read,
 * which also gives its page region; anything else is flagged "Not found on
 * page". Fields the assistant says aren't there stay empty.
 */
export async function findFields(extraction: Extraction, pages: OcrPage[], labels: string[] | null, variant: AiModelVariant, options: AiCallOptions = {}): Promise<AiResult & { notFound: string[] }> {
  let next = extraction;
  const added: { group: number; spec: FieldSpec }[] = [];
  const fresh: Suggestion[] = [];
  const notFound = new Set<string>();
  const formPages = extraction.forms.length ? extraction.forms.map((f, g) => ({ group: g, page: f.page })) : [];
  for (const { group, page: pageNumber } of formPages) {
    const page = pages[pageNumber - 1];
    if (!page?.result?.lines.length) continue;
    const wanted: FieldSpec[] = labels
      ? labels.map((label) => ({ key: keyFromLabel(label), label, type: "text", required: false }))
      : next.forms[group].fields.filter((f) => !f.value.text.trim() && !f.value.edited && (f.type === "text" || f.type === "number" || f.type === "date"));
    if (wanted.length === 0) continue;
    for (const spec of wanted) {
      next = addField(next, group, spec);
      added.push({ group, spec });
    }
    const reply = await aiRuntime.generate(fieldMessages(page.result.lines.map((l) => l.text), wanted), variant, { ...options, maxNewTokens: 300 });
    const values = parseFieldReply(reply, wanted);
    const words = page.result.lines.flatMap((l) => l.words);
    for (const spec of wanted) {
      const value = values[spec.key];
      if (value === null) {
        notFound.add(spec.label);
        continue;
      }
      const ref: ValueRef = { kind: "form", group, id: spec.key };
      const current = next.forms[group].fields.find((f) => f.key === spec.key)?.value.text ?? "";
      if (current.trim() === value.trim()) continue;
      fresh.push(fieldSuggestion(ref, current, value, pageNumber, words));
    }
  }
  return {
    apply: (current) => {
      const withFields = added.reduce((x, { group, spec }) => addField(x, group, spec), current);
      return { ...withFields, suggestions: mergeSuggestions(withFields.suggestions, fresh, "ai") };
    },
    offered: fresh.length,
    notFound: [...notFound],
  };
}

/**
 * For template forms: asks the assistant which printed labels (English or
 * Filipino) the template's missing fields go with, and suggests the value
 * printed next to that label. Grounded by construction — the value is read
 * from the page beside a real label.
 */
export async function suggestMappings(extraction: Extraction, pages: OcrPage[], variant: AiModelVariant, options: AiCallOptions = {}): Promise<AiResult> {
  const fresh: Suggestion[] = [];
  for (const [group, form] of extraction.forms.entries()) {
    const layout = pages[form.page - 1]?.layout;
    const missing = form.fields.filter((f) => !f.value.text.trim() && !f.value.edited);
    const used = new Set(form.fields.map((f) => f.value.ocrText?.trim()).filter(Boolean));
    const candidates = (layout?.keyValues ?? []).filter((kv) => kv.value.trim() && !used.has(kv.value.trim()));
    if (!missing.length || !candidates.length) continue;
    const reply = await aiRuntime.generate(mappingMessages(candidates.map((kv) => kv.label), missing), variant, { ...options, maxNewTokens: 200 });
    for (const [index, key] of parseMappingReply(reply, candidates.map((kv) => kv.label), missing)) {
      const kv = candidates[index];
      const field = missing.find((f) => f.key === key)!;
      fresh.push({
        id: crypto.randomUUID(),
        ref: { kind: "form", group, id: key },
        kind: "fill",
        source: "ai",
        before: "",
        after: kv.value.trim(),
        reason: `The label “${kv.label}” looks like ${field.label} (matched by the on-device assistant).`,
        grounded: true,
        confidence: kv.confidence === null ? null : kv.confidence / 100,
        page: form.page,
        box: kv.valueBox,
        status: "pending",
      });
    }
  }
  return { apply: (current) => ({ ...current, suggestions: mergeSuggestions(current.suggestions, fresh, "ai") }), offered: fresh.length };
}

/* ------------------------------------------------------------------
   Datasets
------------------------------------------------------------------- */

/** Asks the assistant to turn a request into a command, validated against the dataset. */
export async function commandFromRequest(request: string, columns: DatasetColumn[], rows: DatasetRow[], variant: AiModelVariant, options: AiCallOptions = {}): Promise<CommandReply> {
  const reply = await aiRuntime.generate(commandMessages(request, columns, rows), variant, { ...options, maxNewTokens: 200 });
  const checked = parseCommandReply(reply, columns, request);
  // Removing one condition can broaden a destructive operation, even if the remaining condition is valid.
  return checked.ok && checked.dropped ? { ok: false, message: "The assistant added conditions that weren't in your request. Rephrase it, or use Transform to preview the exact change." } : checked;
}
