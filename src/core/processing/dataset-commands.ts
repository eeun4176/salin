/**
 * Dataset Commands
 * The one engine behind every dataset operation, whether it comes from the
 * Transform tools or from a natural-language request turned into a command
 * by the local AI: filter, sort, rename a column, change a column's type,
 * summarize / group with counts and totals, normalize values, set values
 * where a condition holds, find duplicate records, delete rows, and keep
 * only some columns. A
 * command is a small JSON object, validated with zod and then against the
 * dataset (columns must exist, values must fit the column type) before it
 * runs. Running is pure: it returns a preview (what would change, with
 * before/after samples) or a result table; nothing is written here — the
 * caller confirms and saves through the dataset repository, which validates
 * again.
 */

import { z } from "zod";

import { convertValue, parseNumber } from "@/core/processing/dataset-inference";
import { cellIssue, MAX_COLUMN_NAME_LENGTH } from "@/core/processing/dataset-validator";
import { normalizeValue, NORMALIZE_RULES, rulesFor, type NormalizeRule } from "@/core/processing/value-normalizers";
import { labelSimilarity, normalizeLabel, parseFormBoolean, parseFormDate } from "@/core/ocr/templates/text-match";
import type { CellValue, ColumnType, DatasetColumn, DatasetRow } from "@/types/processing";

/* ------------------------------------------------------------------
   Schema
------------------------------------------------------------------- */

const columnRef = z.string().trim().min(1).max(MAX_COLUMN_NAME_LENGTH);
const scalar = z.union([z.string().max(500), z.number(), z.boolean()]);

export const OPERATORS = ["equals", "not_equals", "contains", "not_contains", "starts_with", "is_empty", "not_empty", "greater_than", "less_than", "at_least", "at_most"] as const;
export type Operator = (typeof OPERATORS)[number];

const conditionSchema = z.object({ column: columnRef, op: z.enum(OPERATORS), value: scalar.nullable().optional() });
const whereSchema = z.array(conditionSchema).min(1).max(10);
const ruleSchema = z.enum(Object.keys(NORMALIZE_RULES) as [NormalizeRule, ...NormalizeRule[]]);

export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("filter"), where: whereSchema, match: z.enum(["all", "any"]).default("all") }),
  z.object({ action: z.literal("sort"), by: z.array(z.object({ column: columnRef, direction: z.enum(["asc", "desc"]).default("asc") })).min(1).max(5) }),
  z.object({ action: z.literal("rename_column"), column: columnRef, to: z.string().trim().min(1).max(MAX_COLUMN_NAME_LENGTH) }),
  z.object({ action: z.literal("change_type"), column: columnRef, to: z.enum(["text", "number", "date", "boolean"]) }),
  z.object({
    action: z.literal("summarize"),
    group_by: z.array(columnRef).max(3).default([]),
    aggregate: z.enum(["count", "sum", "average", "min", "max"]).default("count"),
    column: columnRef.optional(),
    where: whereSchema.optional(),
  }),
  z.object({ action: z.literal("normalize"), column: columnRef, rule: ruleSchema }),
  z.object({ action: z.literal("set_value"), column: columnRef, value: scalar.nullable(), where: whereSchema }),
  z.object({ action: z.literal("find_duplicates"), columns: z.array(columnRef).max(10).default([]) }),
  z.object({ action: z.literal("delete_rows"), where: whereSchema }),
  z.object({ action: z.literal("keep_columns"), columns: z.array(columnRef).min(1).max(50) }),
]);

export type DatasetCommand = z.infer<typeof commandSchema>;
export type CommandAction = DatasetCommand["action"];
export type Condition = z.infer<typeof conditionSchema>;

/** Actions that rewrite many cells or remove rows: their preview asks for a clear confirmation. */
export const DESTRUCTIVE_ACTIONS = new Set<CommandAction>(["set_value", "normalize", "change_type", "delete_rows", "keep_columns"]);

/* ------------------------------------------------------------------
   Validation against a dataset
------------------------------------------------------------------- */

export type ResolveResult = { ok: true; command: DatasetCommand } | { ok: false; message: string };

const TYPE_WORD: Record<ColumnType, string> = { text: "text", number: "numbers", date: "dates", boolean: "yes/no values" };
export const COMPARISONS = new Set<Operator>(["greater_than", "less_than", "at_least", "at_most"]);

/** A column by id, exact name, or a close match of its name ("pet name" → "Pet's name"). */
export function findColumn(columns: DatasetColumn[], ref: string): DatasetColumn | null {
  const byId = columns.find((c) => c.id === ref);
  if (byId) return byId;
  // Plural- and apostrophe-insensitive: "pet name" finds "Pet's name", "owner" finds "Owners".
  const stem = (text: string) => normalizeLabel(text).split(" ").map((t) => t.replace(/s$/, "")).join(" ");
  const wanted = stem(ref);
  const exact = columns.find((c) => stem(c.name) === wanted);
  if (exact) return exact;
  let best: DatasetColumn | null = null;
  let score = 0;
  for (const column of columns) {
    const s = labelSimilarity(ref, column.name);
    if (s > score) [best, score] = [column, s];
  }
  return score >= 0.8 ? best : null;
}

class CommandError extends Error {}

const fail = (message: string): never => {
  throw new CommandError(message);
};

/** A condition value in the column's type, or a clear error. */
function typedValue(column: DatasetColumn, raw: string | number | boolean | null | undefined): CellValue {
  if (raw === null || raw === undefined || raw === "") return null;
  if (column.type === "number") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseNumber(raw) : null;
    return n ?? fail(`“${raw}” isn't a number, but ${column.name} holds numbers.`);
  }
  if (column.type === "date") {
    const iso = typeof raw === "string" ? parseFormDate(raw) : null;
    return iso ?? fail(`“${raw}” isn't a date ${column.name} understands — use YYYY-MM-DD.`);
  }
  if (column.type === "boolean") {
    const b = typeof raw === "boolean" ? raw : parseFormBoolean(String(raw));
    return b ?? fail(`${column.name} holds yes/no values — “${raw}” isn't one.`);
  }
  return typeof raw === "boolean" ? (raw ? "Yes" : "No") : String(raw).trim();
}

function columnOf(columns: DatasetColumn[], ref: string) {
  return findColumn(columns, ref) ?? fail(`There's no column called “${ref}”. Columns: ${columns.map((c) => c.name).join(", ")}.`);
}

function resolveConditions(columns: DatasetColumn[], where: Condition[]): Condition[] {
  return where.map((cond) => {
    const column = columnOf(columns, cond.column);
    if (COMPARISONS.has(cond.op) && column.type !== "number" && column.type !== "date") {
      fail(`${column.name} holds ${TYPE_WORD[column.type]}, so it can't be compared as larger or smaller.`);
    }
    if (cond.op === "is_empty" || cond.op === "not_empty") return { column: column.id, op: cond.op, value: null };
    if (cond.value === null || cond.value === undefined || cond.value === "") fail(`Say what ${column.name} should be compared with.`);
    const textOp = cond.op === "contains" || cond.op === "not_contains" || cond.op === "starts_with";
    const value = textOp ? String(cond.value) : typedValue(column, cond.value);
    return { column: column.id, op: cond.op, value: value as string | number | boolean };
  });
}

/**
 * Checks a command (from the Transform tools or the AI) against the dataset
 * and returns it with column references turned into column ids and values
 * converted to the column types — or a message explaining what's wrong.
 */
export function resolveCommand(input: unknown, columns: DatasetColumn[]): ResolveResult {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `That isn't a supported action (${issue.path.join(".") || "action"}: ${issue.message}).` };
  }
  const command = parsed.data;
  try {
    switch (command.action) {
      case "filter":
        return { ok: true, command: { ...command, where: resolveConditions(columns, command.where) } };
      case "delete_rows":
        return { ok: true, command: { ...command, where: resolveConditions(columns, command.where) } };
      case "sort":
        return { ok: true, command: { ...command, by: command.by.map((s) => ({ ...s, column: columnOf(columns, s.column).id })) } };
      case "rename_column": {
        const column = columnOf(columns, command.column);
        const to = command.to.replace(/\s+/g, " ").trim();
        if (columns.some((c) => c.id !== column.id && c.name.toLowerCase() === to.toLowerCase())) fail(`There's already a column named “${to}”.`);
        return { ok: true, command: { ...command, column: column.id, to } };
      }
      case "change_type":
        return { ok: true, command: { ...command, column: columnOf(columns, command.column).id } };
      case "summarize": {
        const groupBy = command.group_by.map((ref) => columnOf(columns, ref).id);
        let column: string | undefined;
        if (command.aggregate !== "count") {
          if (!command.column) fail(`Say which column to ${command.aggregate === "average" ? "average" : command.aggregate === "sum" ? "add up" : `find the ${command.aggregate} of`}.`);
          const target = columnOf(columns, command.column!);
          const numeric = target.type === "number" || ((command.aggregate === "min" || command.aggregate === "max") && target.type === "date");
          if (!numeric) fail(`${target.name} holds ${TYPE_WORD[target.type]}, so it can't be ${command.aggregate === "sum" ? "added up" : "averaged"}. Change its type to Number first.`);
          column = target.id;
        }
        return { ok: true, command: { ...command, group_by: groupBy, column, where: command.where ? resolveConditions(columns, command.where) : undefined } };
      }
      case "normalize": {
        const column = columnOf(columns, command.column);
        if (!rulesFor(column.type).includes(command.rule)) fail(`“${NORMALIZE_RULES[command.rule].label}” doesn't apply to ${column.name}, which holds ${TYPE_WORD[column.type]}.`);
        return { ok: true, command: { ...command, column: column.id } };
      }
      case "set_value": {
        const column = columnOf(columns, command.column);
        const value = typedValue(column, command.value);
        return { ok: true, command: { ...command, column: column.id, value: value as string | number | boolean | null, where: resolveConditions(columns, command.where) } };
      }
      case "find_duplicates":
        return { ok: true, command: { ...command, columns: command.columns.map((ref) => columnOf(columns, ref).id) } };
      case "keep_columns":
        return { ok: true, command: { ...command, columns: [...new Set(command.columns.map((ref) => columnOf(columns, ref).id))] } };
    }
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------------
   Running
------------------------------------------------------------------- */

export interface CommandTarget {
  columns: DatasetColumn[];
  rows: DatasetRow[];
}

export interface ChangeSample {
  /** 1-based row number in the dataset. */
  row: number;
  column: string;
  before: CellValue;
  /** `undefined` when the row is removed. */
  after?: CellValue;
}

export interface DuplicateGroup {
  key: string;
  rowIds: string[];
  /** 1-based row numbers. */
  rows: number[];
}

export type CommandOutcome =
  | { kind: "view"; rowIds: string[]; message: string }
  | {
      kind: "change";
      columns: DatasetColumn[];
      rows: DatasetRow[];
      /** True when columns or row order/count change (the whole dataset is rewritten). */
      structural: boolean;
      changedRowIds: string[];
      affectedRows: number;
      affectedColumns: string[];
      destructive: boolean;
      samples: ChangeSample[];
      message: string;
    }
  | { kind: "table"; title: string; headers: string[]; rows: CellValue[][]; message: string }
  | { kind: "duplicates"; groups: DuplicateGroup[]; message: string };

const MAX_SAMPLES = 8;

export function displayValue(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

const isEmpty = (value: CellValue | undefined) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/** A cell compared in its column's type ("Yes" in a text column still equals a yes/no `true`). */
function comparable(column: DatasetColumn, value: CellValue | undefined): CellValue {
  if (isEmpty(value)) return null;
  if (column.type === "number") return typeof value === "number" ? value : parseNumber(String(value));
  if (column.type === "date") return typeof value === "string" ? (parseFormDate(value) ?? value) : null;
  if (column.type === "boolean") return typeof value === "boolean" ? value : parseFormBoolean(String(value));
  return normalizeLabel(displayValue(value));
}

export function matchesCondition(cond: Condition, column: DatasetColumn, value: CellValue | undefined): boolean {
  const empty = isEmpty(value);
  switch (cond.op) {
    case "is_empty":
      return empty;
    case "not_empty":
      return !empty;
    case "contains":
    case "not_contains":
    case "starts_with": {
      const text = displayValue(value).toLowerCase();
      const needle = String(cond.value ?? "").toLowerCase();
      if (cond.op === "starts_with") return text.startsWith(needle);
      return cond.op === "contains" ? !empty && text.includes(needle) : !text.includes(needle);
    }
    default: {
      const cell = comparable(column, value);
      const target = typeof cond.value === "string" && column.type === "text" ? normalizeLabel(cond.value) : (cond.value ?? null);
      if (cond.op === "equals") return cell !== null && cell === target;
      if (cond.op === "not_equals") return cell === null || cell !== target;
      if (cell === null || target === null) return false;
      if (cond.op === "greater_than") return cell > target;
      if (cond.op === "less_than") return cell < target;
      if (cond.op === "at_least") return cell >= target;
      return cell <= target;
    }
  }
}

function rowMatches(where: Condition[], match: "all" | "any", columns: DatasetColumn[], row: DatasetRow) {
  const test = (cond: Condition) => {
    const column = columns.find((c) => c.id === cond.column);
    return column ? matchesCondition(cond, column, row.values[column.id]) : false;
  };
  return match === "all" ? where.every(test) : where.some(test);
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function compareCells(column: DatasetColumn, a: CellValue | undefined, b: CellValue | undefined) {
  // Empty cells always sort last.
  if (isEmpty(a)) return isEmpty(b) ? 0 : 1;
  if (isEmpty(b)) return -1;
  const x = comparable(column, a);
  const y = comparable(column, b);
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "boolean" && typeof y === "boolean") return Number(y) - Number(x);
  return displayValue(a).localeCompare(displayValue(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Rewrites cells; returns the outcome with before/after samples. */
function cellChanges(target: CommandTarget, columnId: string, next: (row: DatasetRow) => CellValue | undefined, destructive: boolean, describe: (n: number) => string): CommandOutcome {
  const column = target.columns.find((c) => c.id === columnId)!;
  const samples: ChangeSample[] = [];
  const changed: string[] = [];
  const rows = target.rows.map((row, index) => {
    const value = next(row);
    const before = row.values[columnId] ?? null;
    if (value === undefined || value === before) return row;
    changed.push(row.id);
    if (samples.length < MAX_SAMPLES) samples.push({ row: index + 1, column: column.name, before, after: value });
    return { ...row, values: { ...row.values, [columnId]: value } };
  });
  return { kind: "change", columns: target.columns, rows, structural: false, changedRowIds: changed, affectedRows: changed.length, affectedColumns: [column.name], destructive, samples, message: describe(changed.length) };
}

function overview(target: CommandTarget, rows: DatasetRow[]): CommandOutcome {
  const table = target.columns.map((column) => {
    const values = rows.map((r) => r.values[column.id]).filter((v) => !isEmpty(v)) as Exclude<CellValue, null>[];
    let detail: string;
    if (column.type === "number" && values.every((v) => typeof v === "number")) {
      const nums = values as number[];
      detail = nums.length ? `${Math.min(...nums)} – ${Math.max(...nums)} (average ${(nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1)})` : "";
    } else if (column.type === "date") {
      const dates = values.map(String).sort();
      detail = dates.length ? `${dates[0]} – ${dates.at(-1)}` : "";
    } else {
      const counts = new Map<string, number>();
      for (const v of values) counts.set(displayValue(v), (counts.get(displayValue(v)) ?? 0) + 1);
      detail = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${v} (${n})`).join(", ");
    }
    const distinct = new Set(values.map((v) => normalizeLabel(displayValue(v)))).size;
    return [column.name, values.length, rows.length - values.length, distinct, detail] as CellValue[];
  });
  return { kind: "table", title: "Summary", headers: ["Column", "Filled", "Empty", "Different values", "Values"], rows: table, message: `${plural(rows.length, "row")} and ${plural(target.columns.length, "column")}.` };
}

function aggregate(kind: "count" | "sum" | "average" | "min" | "max", values: CellValue[]): CellValue {
  if (kind === "count") return values.length;
  const present = values.filter((v) => !isEmpty(v));
  if (present.length === 0) return null;
  if (kind === "min" || kind === "max") {
    const sorted = [...present].sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))));
    return kind === "min" ? sorted[0] : sorted[sorted.length - 1];
  }
  const nums = present.filter((v): v is number => typeof v === "number");
  const sum = nums.reduce((s, n) => s + n, 0);
  return kind === "sum" ? sum : nums.length ? Math.round((sum / nums.length) * 100) / 100 : null;
}

const AGGREGATE_LABEL = { count: "Count", sum: "Total", average: "Average", min: "Lowest", max: "Highest" } as const;

/** Runs a command returned by `resolveCommand`. Pure: the dataset passed in is never modified. */
export function runCommand(command: DatasetCommand, target: CommandTarget): CommandOutcome {
  const { columns } = target;
  const col = (id: string) => columns.find((c) => c.id === id)!;

  switch (command.action) {
    case "filter": {
      const rowIds = target.rows.filter((row) => rowMatches(command.where, command.match, columns, row)).map((r) => r.id);
      return { kind: "view", rowIds, message: `${plural(rowIds.length, "row")} of ${target.rows.length.toLocaleString()} match.` };
    }

    case "sort": {
      const rows = target.rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
          for (const { column, direction } of command.by) {
            const diff = compareCells(col(column), a.row.values[column], b.row.values[column]);
            // Empty cells stay last in both directions.
            if (diff !== 0) return isEmpty(a.row.values[column]) || isEmpty(b.row.values[column]) ? diff : direction === "desc" ? -diff : diff;
          }
          return a.index - b.index;
        })
        .map(({ row }) => row);
      const moved = rows.filter((row, i) => row !== target.rows[i]).length;
      return { kind: "change", columns, rows, structural: true, changedRowIds: [], affectedRows: moved, affectedColumns: command.by.map((s) => col(s.column).name), destructive: false, samples: [], message: moved ? `${plural(moved, "row")} will move.` : "The rows are already in this order." };
    }

    case "rename_column": {
      const column = col(command.column);
      return {
        kind: "change",
        columns: columns.map((c) => (c.id === column.id ? { ...c, name: command.to } : c)),
        rows: target.rows,
        structural: true,
        changedRowIds: [],
        affectedRows: 0,
        affectedColumns: [column.name],
        destructive: false,
        samples: [],
        message: `“${column.name}” will be called “${command.to}”. The values don't change.`,
      };
    }

    case "change_type": {
      const column = col(command.column);
      const outcome = cellChanges(target, column.id, (row) => (column.id in row.values ? convertValue(row.values[column.id], command.to) : undefined), true, (n) => `${plural(n, "value")} will be converted.`);
      if (outcome.kind !== "change") return outcome;
      const changed = { ...column, type: command.to, required: false };
      const columnsAfter = columns.map((c) => (c.id === column.id ? { ...c, type: command.to } : c));
      const misfits = outcome.rows.filter((r) => cellIssue(changed, r.values[column.id]) !== null).length;
      return { ...outcome, columns: columnsAfter, structural: true, message: `${outcome.message}${misfits ? ` ${plural(misfits, "value")} don't fit and will be flagged for review.` : ""}` };
    }

    case "normalize": {
      const column = col(command.column);
      return cellChanges(target, column.id, (row) => (column.id in row.values ? normalizeValue(command.rule, row.values[column.id], column.type) : undefined), true, (n) =>
        n ? `${plural(n, "value")} will be standardized (${NORMALIZE_RULES[command.rule].label}). Values the rule doesn't recognise stay as they are.` : "Every value is already in this form.",
      );
    }

    case "set_value": {
      const column = col(command.column);
      return cellChanges(target, column.id, (row) => (rowMatches(command.where, "all", columns, row) ? (command.value ?? null) : undefined), true, (n) => `${plural(n, "row")} will get ${column.name} = “${displayValue(command.value ?? null) || "(empty)"}”.`);
    }

    case "delete_rows": {
      const removed = target.rows.map((row, index) => ({ row, index })).filter(({ row }) => rowMatches(command.where, "all", columns, row));
      return removeRows(target, new Set(removed.map(({ row }) => row.id)));
    }

    case "summarize": {
      const rows = command.where ? target.rows.filter((row) => rowMatches(command.where!, "all", columns, row)) : target.rows;
      if (command.group_by.length === 0 && command.aggregate === "count") return overview(target, rows);
      const valueColumn = command.column ? col(command.column) : null;
      const label = command.aggregate === "count" ? "Count" : `${AGGREGATE_LABEL[command.aggregate]} ${valueColumn!.name}`;
      const groups = new Map<string, { keys: CellValue[]; values: CellValue[] }>();
      for (const row of rows) {
        const keys = command.group_by.map((id) => (isEmpty(row.values[id]) ? "(blank)" : displayValue(row.values[id])));
        const key = keys.map((k) => normalizeLabel(String(k))).join("|");
        const group = groups.get(key) ?? { keys, values: [] };
        group.values.push(valueColumn ? (row.values[valueColumn.id] ?? null) : 1);
        groups.set(key, group);
      }
      const table = [...groups.values()]
        .map((g) => [...g.keys, aggregate(command.aggregate, g.values)])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
      const headers = [...command.group_by.map((id) => col(id).name), label];
      return { kind: "table", title: command.group_by.length ? `${label} by ${headers.slice(0, -1).join(" and ")}` : label, headers, rows: table, message: `From ${plural(rows.length, "row")}.` };
    }

    case "find_duplicates": {
      const keyColumns = command.columns.length ? command.columns.map(col) : columns;
      const groups = new Map<string, DuplicateGroup>();
      target.rows.forEach((row, index) => {
        const parts = keyColumns.map((c) => normalizeLabel(displayValue(row.values[c.id])));
        if (parts.every((p) => p === "")) return;
        const key = parts.join("|");
        const group = groups.get(key) ?? { key: keyColumns.map((c) => displayValue(row.values[c.id])).filter(Boolean).join(" · "), rowIds: [], rows: [] };
        group.rowIds.push(row.id);
        group.rows.push(index + 1);
        groups.set(key, group);
      });
      const found = [...groups.values()].filter((g) => g.rowIds.length > 1);
      const extra = found.reduce((n, g) => n + g.rowIds.length - 1, 0);
      return {
        kind: "duplicates",
        groups: found,
        message: found.length
          ? `${plural(found.length, "group")} of matching records (${plural(extra, "extra copy")}) by ${keyColumns.map((c) => c.name).join(", ")}. Nothing is removed unless you choose to.`
          : `No duplicates by ${keyColumns.map((c) => c.name).join(", ")}.`,
      };
    }

    case "keep_columns": {
      const kept = command.columns.map(col);
      const keep = new Set(command.columns);
      const removed = columns.filter((c) => !keep.has(c.id)).map((c) => c.name);
      const reordered = kept.some((c, i) => c !== columns[i]);
      const rows = target.rows.map((row) => ({ ...row, values: Object.fromEntries(Object.entries(row.values).filter(([id]) => keep.has(id))) }));
      return {
        kind: "change",
        columns: kept,
        rows,
        structural: true,
        changedRowIds: [],
        affectedRows: 0,
        affectedColumns: removed.length ? removed : reordered ? kept.map((c) => c.name) : [],
        destructive: removed.length > 0,
        samples: [],
        message: removed.length
          ? `${plural(removed.length, "column")} will be removed: ${removed.join(", ")}. You can undo it right after.`
          : reordered
            ? "The columns will be put in this order."
            : "The dataset already has only these columns.",
      };
    }
  }
}

/** Removes the given rows (used by delete_rows and by "remove extra copies" for duplicates). */
export function removeRows(target: CommandTarget, ids: Set<string>): CommandOutcome {
  const samples: ChangeSample[] = [];
  const first = target.columns[0];
  target.rows.forEach((row, index) => {
    if (ids.has(row.id) && samples.length < MAX_SAMPLES) samples.push({ row: index + 1, column: first?.name ?? "", before: row.values[first?.id] ?? null });
  });
  const rows = target.rows.filter((row) => !ids.has(row.id));
  const removed = target.rows.length - rows.length;
  return {
    kind: "change",
    columns: target.columns,
    rows,
    structural: true,
    changedRowIds: [],
    affectedRows: removed,
    affectedColumns: [],
    destructive: removed > 0,
    samples,
    message: removed ? `${plural(removed, "row")} will be deleted.` : "No rows match, so nothing will be deleted.",
  };
}

/* ------------------------------------------------------------------
   Plain-language descriptions
------------------------------------------------------------------- */

export const OP_TEXT: Record<Operator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  starts_with: "starts with",
  is_empty: "is empty",
  not_empty: "is filled in",
  greater_than: "is more than",
  less_than: "is less than",
  at_least: "is at least",
  at_most: "is at most",
};

function describeWhere(where: Condition[], columns: DatasetColumn[], match: "all" | "any" = "all") {
  return where
    .map((c) => `${findColumn(columns, c.column)?.name ?? c.column} ${OP_TEXT[c.op]}${c.op === "is_empty" || c.op === "not_empty" ? "" : ` “${displayValue(c.value ?? null)}”`}`)
    .join(match === "all" ? " and " : " or ");
}

/** What a command does, in one sentence ("Show rows where Species is “Dog”"). */
export function describeCommand(command: DatasetCommand, columns: DatasetColumn[]): string {
  const name = (ref: string) => findColumn(columns, ref)?.name ?? ref;
  switch (command.action) {
    case "filter":
      return `Show rows where ${describeWhere(command.where, columns, command.match)}`;
    case "sort":
      return `Sort by ${command.by.map((s) => `${name(s.column)} (${s.direction === "desc" ? "largest / latest / Z first" : "smallest / earliest / A first"})`).join(", then ")}`;
    case "rename_column":
      return `Rename “${name(command.column)}” to “${command.to}”`;
    case "change_type":
      return `Change ${name(command.column)} to ${command.to === "boolean" ? "yes/no" : command.to}`;
    case "summarize": {
      const what = command.aggregate === "count" ? (command.group_by.length ? "Count rows" : "Summarize the dataset") : `${AGGREGATE_LABEL[command.aggregate]} of ${name(command.column ?? "")}`;
      return `${what}${command.group_by.length ? ` by ${command.group_by.map(name).join(" and ")}` : ""}${command.where ? ` where ${describeWhere(command.where, columns)}` : ""}`;
    }
    case "normalize":
      return `Standardize ${name(command.column)}: ${NORMALIZE_RULES[command.rule].label}`;
    case "set_value":
      return `Set ${name(command.column)} to “${displayValue(command.value ?? null) || "(empty)"}” where ${describeWhere(command.where, columns)}`;
    case "find_duplicates":
      return `Find duplicate rows${command.columns.length ? ` by ${command.columns.map(name).join(", ")}` : ""}`;
    case "delete_rows":
      return `Delete rows where ${describeWhere(command.where, columns)}`;
    case "keep_columns":
      return `Keep only ${command.columns.map(name).join(", ")}`;
  }
}
