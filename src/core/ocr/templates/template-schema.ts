/**
 * Template Schema
 * The definition of a reusable document template, validated with zod: its
 * expected fields (label, other wordings, data type, required, choices,
 * optional page region), repeated-record table sections with their
 * columns, and summary/count fields (e.g. "Total dogs" checked against the
 * records read). Built-in and user-saved templates share this shape.
 */

import { z } from "zod";

import { NORMALIZE_RULES, type NormalizeRule } from "@/core/processing/value-normalizers";

const key = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9_]+$/, "Keys use lowercase letters, digits and _.");
const text = z.string().trim().min(1).max(120);
const unit = z.number().min(0).max(1);

export const regionSchema = z.object({ x: unit, y: unit, width: unit, height: unit });

export const fieldTypeSchema = z.enum(["text", "number", "date", "boolean", "choice"]);

export const templateFieldSchema = z.object({
  key,
  label: text,
  /** Other wordings of the label on real forms ("Name of owner", "Pangalan"). */
  aliases: z.array(text).max(30).default([]),
  type: fieldTypeSchema,
  required: z.boolean().default(false),
  /** Choices for `choice` fields (ticked checkboxes or a written word). */
  options: z.array(text).max(20).optional(),
  /** Where the value sits on the page (0–1), learned from a corrected scan. */
  region: regionSchema.optional(),
  /** A standard form to suggest for read values ("M" → "Male"); suggested, never applied silently. */
  normalize: z.enum(Object.keys(NORMALIZE_RULES) as [NormalizeRule, ...NormalizeRule[]]).optional(),
});

export const templateColumnSchema = templateFieldSchema.omit({ region: true });

export const templateTableSchema = z.object({
  key,
  label: text,
  columns: z.array(templateColumnSchema).min(1).max(60),
  /** How many columns must match a detected table's headings for it to count as this table. */
  minMatched: z.number().int().min(1).default(2),
});

export const summaryFieldSchema = templateFieldSchema.extend({
  /** A total that can be checked against the records read (never filled in from them). */
  countOf: z.object({ table: key, column: key.optional(), equals: z.string().optional() }).optional(),
});

export const templateSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: text,
    description: z.string().max(400).default(""),
    /** form = one record per page; table = repeated records (rows) per page. */
    kind: z.enum(["form", "table"]),
    version: z.number().int().positive().default(1),
    builtIn: z.boolean().default(false),
    experimental: z.boolean().default(false),
    /** The template a saved one was adapted from. */
    basedOn: z.string().max(100).optional(),
    fields: z.array(templateFieldSchema).max(100).default([]),
    tables: z.array(templateTableSchema).max(10).default([]),
    summaries: z.array(summaryFieldSchema).max(30).default([]),
  })
  .superRefine((t, ctx) => {
    const keys = [...t.fields, ...t.summaries].map((f) => f.key);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Field keys must be unique." });
    const tableKeys = t.tables.map((x) => x.key);
    if (new Set(tableKeys).size !== tableKeys.length) ctx.addIssue({ code: "custom", message: "Table keys must be unique." });
    for (const table of t.tables) {
      const columnKeys = table.columns.map((c) => c.key);
      if (new Set(columnKeys).size !== columnKeys.length) ctx.addIssue({ code: "custom", message: `Column keys in “${table.label}” must be unique.` });
    }
    for (const s of t.summaries) {
      if (s.countOf && !tableKeys.includes(s.countOf.table)) ctx.addIssue({ code: "custom", message: `“${s.label}” counts a table that isn't defined.` });
    }
    for (const f of [...t.fields, ...t.summaries]) {
      if (f.type === "choice" && !f.options?.length) ctx.addIssue({ code: "custom", message: `“${f.label}” needs choices.` });
    }
    if (t.kind === "form" && t.fields.length === 0) ctx.addIssue({ code: "custom", message: "A form template needs at least one field." });
    if (t.kind === "table" && t.tables.length === 0) ctx.addIssue({ code: "custom", message: "A table template needs at least one table." });
  });

export type DocumentTemplateDef = z.infer<typeof templateSchema>;
export type TemplateField = z.infer<typeof templateFieldSchema>;
export type TemplateColumn = z.infer<typeof templateColumnSchema>;
export type TemplateTable = z.infer<typeof templateTableSchema>;
export type SummaryField = z.infer<typeof summaryFieldSchema>;
export type TemplateInput = z.input<typeof templateSchema>;

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/** Validates a template definition; throws a TemplateError with the first problem. */
export function parseTemplate(input: unknown): DocumentTemplateDef {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new TemplateError(`This template isn't valid: ${issue.message}${issue.path.length ? ` (${issue.path.join(".")})` : ""}`);
  }
  return parsed.data;
}

/** Turns a label into a field key: "Owner's name" → "owners_name". */
export function keyFromLabel(label: string) {
  const slug = label
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return slug || "field";
}
