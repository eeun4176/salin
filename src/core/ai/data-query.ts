/**
 * Data Queries
 * The read-only questions Salin answers about a dataset, as plain data:
 * which rows (groups of conditions — every group must hold, and any one
 * condition within a group, so "Hector" can be a first or a last name), and
 * what to give back: those rows (chosen columns, sorted, the first N), how
 * many there are, a count or total per group, or one total, average,
 * lowest or highest value. Salin runs them over every row with the same
 * matching as the Transform tools; nothing in the dataset changes.
 */

import { displayValue, matchesCondition, OP_TEXT, runCommand, type Condition } from "@/core/processing/dataset-commands";
import type { CellValue, DatasetColumn, DatasetRow } from "@/types/processing";

export type Aggregate = "count" | "sum" | "average" | "min" | "max";

export interface DataQuery {
  where: Condition[][];
  give: "rows" | "count" | "groups" | "value";
  /** Rows: the columns to show (all when absent). */
  columns?: string[];
  /** Groups: the columns to group by. */
  groupBy?: string[];
  /** Groups and value: what to work out, and of which column (count needs none). */
  aggregate?: Aggregate;
  of?: string;
  /** Rows: by a column; groups: by a column or by the worked-out value. */
  sort?: { by: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface QueryResult {
  text: string;
  headers: string[];
  rows: CellValue[][];
  /** Rows matched (rows and count) or groups found (groups). */
  total: number;
}

/** Sorts a group table by its worked-out value. */
export const BY_VALUE = "value";
const SHOWN = 100;
const LABEL: Record<Aggregate, string> = { count: "Count", sum: "Total", average: "Average", min: "Lowest", max: "Highest" };
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function sourceText(row: DatasetRow) {
  const source = row.source;
  return source ? [source.sheet, source.page !== null ? `page ${source.page}` : null, source.row !== null ? `row ${source.row}` : null].filter(Boolean).join(" · ") || null : null;
}

/** Runs a query over every row of the dataset. */
export function runQuery(query: DataQuery, columns: DatasetColumn[], rows: DatasetRow[]): QueryResult {
  const col = (id: string) => columns.find((c) => c.id === id);
  const matched = rows.filter((row) => query.where.every((group) => group.some((c) => matchesCondition(c, col(c.column)!, row.values[c.column]))));
  const limit = Math.min(query.limit ?? SHOWN, SHOWN);

  if (query.give === "count") return { text: `${plural(matched.length, "row")} ${matched.length === 1 ? "matches" : "match"}.`, headers: [], rows: [], total: matched.length };

  if (query.give === "rows") {
    let list = matched;
    if (query.sort) {
      const sorted = runCommand({ action: "sort", by: [{ column: query.sort.by, direction: query.sort.direction }] }, { columns, rows: list });
      if (sorted.kind === "change") list = sorted.rows;
    }
    const shown = list.slice(0, limit);
    const out = query.columns?.length ? query.columns.map((id) => col(id)!) : columns;
    // Where each row came from, so the answer can be checked against the original file.
    const withSource = shown.some((row) => sourceText(row));
    return {
      text: `${plural(matched.length, "matching row")}.${matched.length > shown.length ? ` Showing ${shown.length.toLocaleString()}.` : ""}`,
      headers: [...out.map((c) => c.name), ...(withSource ? ["Source"] : [])],
      rows: shown.map((row) => [...out.map((c) => row.values[c.id] ?? null), ...(withSource ? [sourceText(row)] : [])]),
      total: matched.length,
    };
  }

  const aggregate = query.aggregate ?? "count";
  const summary = runCommand({ action: "summarize", group_by: query.give === "groups" ? (query.groupBy ?? []) : [], aggregate, column: query.of }, { columns, rows: matched });
  if (summary.kind !== "table") return { text: "No rows to work this out from.", headers: [], rows: [], total: 0 };
  if (query.give === "value") {
    const value = summary.rows[0]?.at(-1) ?? null;
    return { text: `${summary.headers.at(-1)}: ${displayValue(value) || "no values"} (from ${plural(matched.length, "row")}).`, headers: summary.headers, rows: summary.rows, total: matched.length };
  }
  let table = summary.rows;
  if (query.sort) {
    const index = query.sort.by === BY_VALUE ? summary.headers.length - 1 : (query.groupBy ?? []).indexOf(query.sort.by);
    const sign = query.sort.direction === "desc" ? -1 : 1;
    table = [...table].sort((a, b) => {
      const x = a[index];
      const y = b[index];
      return sign * (typeof x === "number" && typeof y === "number" ? x - y : displayValue(x).localeCompare(displayValue(y), undefined, { numeric: true }));
    });
  }
  const shown = table.slice(0, limit);
  return { text: `${summary.title}: ${plural(table.length, "group")}.${table.length > shown.length ? ` Showing ${shown.length.toLocaleString()}.` : ""}`, headers: summary.headers, rows: shown, total: table.length };
}

/** The query in one line, so people can check how their question was read ("Country is “Chile” · count the rows"). */
export function describeQuery(query: DataQuery, columns: DatasetColumn[]): string {
  const name = (id: string) => columns.find((c) => c.id === id)?.name ?? id;
  const condition = (c: Condition) => `${name(c.column)} ${OP_TEXT[c.op]}${c.op === "is_empty" || c.op === "not_empty" ? "" : ` “${displayValue(c.value ?? null)}”`}`;
  const where = query.where.map((group) => (group.length > 1 ? `(${group.map(condition).join(" or ")})` : condition(group[0]))).join(" and ");
  const order = query.sort ? `${query.sort.by === BY_VALUE ? LABEL[query.aggregate ?? "count"].toLowerCase() : name(query.sort.by)}, ${query.sort.direction === "desc" ? "highest / latest first" : "lowest / earliest first"}` : "";
  let give: string;
  if (query.give === "count") give = "count the rows";
  else if (query.give === "rows") give = `show ${query.columns?.length ? query.columns.map(name).join(", ") : "every column"}${order ? ` sorted by ${order}` : ""}${query.limit ? `, first ${query.limit}` : ""}`;
  else {
    const what = (query.aggregate ?? "count") === "count" ? "count" : `${LABEL[query.aggregate!].toLowerCase()} ${name(query.of ?? "")}`;
    give = query.give === "value" ? what : `${what} per ${(query.groupBy ?? []).map(name).join(" and ")}${order ? `, sorted by ${order}` : ""}${query.limit ? `, top ${query.limit}` : ""}`;
  }
  return `${where ? `${where} · ` : ""}${give}`;
}
