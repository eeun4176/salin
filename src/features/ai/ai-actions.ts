/**
 * AI Actions
 * What the review and dataset screens ask the on-device AI to do, each
 * returning suggestions (never applied directly) as an `apply` function the
 * screen runs on its latest extraction — so edits made while the model was
 * working aren't lost: read handwriting in the
 * regions the template mapping located, suggest fixes for recognition slips,
 * find requested or missing fields in a page's text (grounded in the words
 * read), name unnamed table columns, and turn a plain-language request into
 * a validated dataset command. Models run in the AI worker; when they're
 * missing or the device can't run them, a clear error says what to do.
 */

import { aiRuntime, type AiCallOptions } from "@/core/ai/ai-runtime";
import type { AiModelVariant } from "@/core/ai/ai-models";
import { columnNameMessages, commandMessages, correctionMessages, fieldMessages, mappingMessages, parseColumnNameReply, parseCommandReply, parseCorrectionReply, parseFieldReply, parseMappingReply, type CommandReply } from "@/core/ai/llm-tasks";
import { correctionSuggestions, fieldSuggestion, mergeSuggestions, withHandwritingReadings, type HandwritingReading } from "@/core/ai/suggestions";
import { refKey, reviewItems } from "@/core/ocr/review/review-state";
import { makeValue } from "@/core/ocr/templates/field-mapping";
import { keyFromLabel } from "@/core/ocr/templates/template-schema";
import { cropLines } from "@/features/ai/line-crops";
import { ensureProcessed } from "@/features/ocr/ocr-runner";
import type { Extraction, ExtractedField, FieldSpec, OcrPage, Suggestion, ValueRef } from "@/types/ocr";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

/* ------------------------------------------------------------------
   Handwriting
------------------------------------------------------------------- */

const READABLE_TYPES = new Set<FieldSpec["type"]>(["text", "number", "date"]);
const HARD_FLAGS = new Set(["possibly-handwritten", "low-confidence", "unclear-characters", "type-mismatch"]);

/** Values worth reading as handwriting: hard-to-read or empty boxes (template fields and table cells) not yet checked by the reviewer. */
export function handwritingTargets(extraction: Extraction) {
  return reviewItems(extraction).filter(
    ({ value, spec }) => value.box && value.page && READABLE_TYPES.has(spec.type) && !value.edited && !value.confirmed && (!value.text.trim() || value.flags.some((f) => HARD_FLAGS.has(f))),
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
    const blob = page ? await ensureProcessed(page) : null;
    if (!blob) continue;
    const crops = await cropLines(blob, items.map((i) => i.value.box!));
    const results = await aiRuntime.readLines(crops, {
      ...options,
      onProgress: (p) => options.onProgress?.({ ...p, fraction: (done + (p.fraction ?? 0) * items.length) / targets.length }),
    });
    done += items.length;
    results.forEach((r, i) => !r.empty && readings.push({ ref: items[i].ref, text: r.text, confidence: r.confidence }));
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
  return parseCommandReply(reply, columns, request);
}

/** Suggested names for columns with placeholder names ("Column 3"), from a few of their values. */
export async function suggestColumnNames(columns: { index: number; samples: string[] }[], variant: AiModelVariant, options: AiCallOptions = {}) {
  if (columns.length === 0) return new Map<number, string>();
  const reply = await aiRuntime.generate(columnNameMessages(columns), variant, { ...options, maxNewTokens: 120 });
  return parseColumnNameReply(reply, columns.map((c) => c.index));
}
