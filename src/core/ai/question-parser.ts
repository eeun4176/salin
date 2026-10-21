/**
 * Question Reader
 * Reads a plain-language question about a dataset — English, Filipino or
 * Taglish — into a read-only query, without a language model: the values
 * and columns it mentions become filters, outputs and groups; words like
 * "how many", "each", "average", "top 5", "more than 3", "in 2025", "last
 * month" and "without an email" set what to work out. It also says which
 * words it didn't understand and which names aren't in the data, so the
 * app knows when to ask the language model (or the person) instead.
 */

import { BY_VALUE, describeQuery, type Aggregate, type DataQuery } from "@/core/ai/data-query";
import { FUNCTION_WORDS, isFieldWord, linkQuestion, relatesToHeader, stem, type ColumnLink } from "@/core/ai/question-linking";
import type { Condition, Operator } from "@/core/processing/dataset-commands";
import { normalizeLabel } from "@/core/ocr/templates/text-match";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

export interface ParsedQuestion {
  query: DataQuery;
  /** The query in words, to show how the question was read. */
  understood: string;
  /** Every word was understood. */
  confident: boolean;
  /** Words it couldn't place. */
  unknown: string[];
  /** Names typed with a capital that aren't in the data ("Chile"). */
  notFound: string[];
  /** Something it needs said differently ("Say which column to average"). */
  note?: string;
}

const phrases = (list: string) => list.split("|").map((p) => p.split(" "));
const COUNT = phrases("how many|number of|count|counts|ilan|ilang|bilang|gaano karami|total number of");
const GROUP = phrases("each|per|every|by|bawat|kada|ayon sa|group by|grouped by|broken down by|breakdown by");
const AGGREGATES: [Aggregate | "latest" | "earliest" | "oldest" | "youngest", string[][]][] = [
  ["average", phrases("average|avg|mean|karaniwan|average na|katamtaman")],
  ["sum", phrases("total|sum|kabuuan|kabuuang|overall|in total|lahat lahat")],
  ["max", phrases("highest|maximum|max|largest|biggest|greatest|most|most expensive|pinakamataas|pinakamalaki|pinakamarami|pinakamahal")],
  ["min", phrases("lowest|minimum|min|smallest|least|fewest|cheapest|pinakamababa|pinakamaliit|pinakakaunti|pinakamura")],
  ["latest", phrases("latest|newest|most recent|recent|pinakabago|pinakahuli")],
  ["earliest", phrases("earliest|first registered|pinakauna|pinakaluma")],
  ["oldest", phrases("oldest|pinakamatanda")],
  ["youngest", phrases("youngest|pinakabata")],
];
const ROWS = phrases("show|list|display|extract|give|get|find|pull|pull out|fetch|see|view|look up|lookup|search|ipakita|pakita|ilista|ibigay|hanapin|kunin|tingnan|who|which|sino|alin|anong|ano|what|details|detail|information|info|records of|all");
const EMPTY = phrases("out of|without|no|missing|lacking|walang|wala|empty|blank|don't have|dont have|do not have|doesn't have|has no|have no|with no|with missing");
const FILLED = phrases("with|has|have|having|may|mayroon|meron|with a|with an|that have|who have");
const NEGATION = new Set(["not", "non", "hindi", "di", "never"]);
const COMPARE: [Operator | "between", string[][]][] = [
  ["between", phrases("between|from|mula|sa pagitan ng")],
  ["at_least", phrases("at least|minimum of|no less than|not less than|hindi bababa sa|since|starting|simula")],
  ["at_most", phrases("at most|maximum of|no more than|not more than|up to|hindi hihigit sa|until|hanggang")],
  ["greater_than", phrases("over|above|more than|greater than|higher than|older than|bigger than|larger than|exceeding|exceeds|after|later than|mahigit sa|mahigit|higit sa|lampas sa|lampas|mas mataas sa|mas malaki sa|mas matanda sa|pagkatapos ng")],
  ["less_than", phrases("under|below|less than|lower than|younger than|smaller than|fewer than|cheaper than|before|earlier than|kulang sa|mas mababa sa|mas maliit sa|mas bata sa|bago ang|bago")],
];
const AFTER_NUMBER: [Operator, string[][]][] = [
  ["at_least", phrases("or more|and above|and up|or higher|or older|pataas|o higit pa")],
  ["at_most", phrases("or less|and below|or fewer|or lower|or younger|pababa|o mas mababa")],
];
const TOP = phrases("top|first|bottom|una");
const WHERE = phrases("where|saan|nakatira|located|location of|lives");
const WHEN = phrases("when|kailan");
const HOW_MUCH = phrases("how much|magkano");
const DISTINCT = phrases("unique|distinct|different|iba't ibang|ibat ibang|kinds of|types of");
/** Words that fit any dataset: people and things in general, and verbs that only connect a value ("who works at Rich-Santos"). */
const GENERIC = new Set(
  (
    "people person persons customer client user member employee staff student record entry row item product order transaction thing data dataset table file one everyone everybody anyone someone list column field value values result " +
    "work worked working live lived living stay located belong registered joined bought buy ordered purchased own owned named called is are was were be have has had do does did get got go come tao nakatira nagtatrabaho bumili rehistrado " +
    "tell know want need please pakisabi gusto paki can you there here only just also too lang then now this year month day week " +
    "sales revenue benta kita earn earns earning earned make makes receive receives pay spend spent sold sell sells selling low high address"
  ).split(" "),
);
/** The people or things a dataset is about, as a question's subject ("most expensive item" asks for the item, not the price). */
const ENTITIES = new Set("people person customer client user member employee staff student item product order record entry household family pamilya tao".split(" "));
/** Words for the "no" of a yes/no column named for the "yes" ("failed" → Passed is No). */
const OPPOSITES: Record<string, string> = { failed: "pass", fail: "pass", failing: "pass", bagsak: "pass", bumagsak: "pass", absent: "present", inactive: "active", closed: "open", lost: "won", rejected: "approved", incomplete: "complete" };
/** A year on its own is a date only after words like these ("in 2025", "after 2020" — not "over 2000"). */
const DATE_PREP = new Set("in noong nung during sa after before since until till from between and of year taong mula hanggang simula bago".split(" "));
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FILIPINO_MONTHS = ["enero", "pebrero", "marso", "abril", "mayo", "hunyo", "hulyo", "agosto", "setyembre", "oktubre", "nobyembre", "disyembre"];
const monthOf = (word: string) => {
  const ph = FILIPINO_MONTHS.indexOf(word);
  if (ph >= 0) return ph + 1;
  const en = MONTHS.indexOf(word.slice(0, 3));
  return en >= 0 && (word.length === 3 || "january february march april may june july august september october november december sept".split(" ").includes(word)) ? en + 1 : 0;
};
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Finds each phrase in the words (not over words already taken), longest first. */
function locate(words: string[], list: string[][], used: Set<number>) {
  const found: { start: number; end: number; text: string }[] = [];
  for (const phrase of [...list].sort((a, b) => b.length - a.length)) {
    for (let i = 0; i + phrase.length <= words.length; i++) {
      const span = Array.from({ length: phrase.length }, (_, k) => i + k);
      if (span.some((k) => used.has(k)) || !phrase.every((w, k) => words[i + k] === w)) continue;
      found.push({ start: i, end: i + phrase.length, text: phrase.join(" ") });
      span.forEach((k) => used.add(k));
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

interface DateRange {
  from?: string;
  to?: string;
  start: number;
  end: number;
}

/** Dates in the question, as ranges: "2025", "March 2026", "Mar 5, 2026", "10/18/2026", "last month", "past 30 days", "ngayong taon". */
function findDates(words: string[], used: Set<number>, today: Date): DateRange[] {
  const out: DateRange[] = [];
  const y0 = today.getUTCFullYear();
  const m0 = today.getUTCMonth() + 1;
  const d0 = today.getUTCDate();
  const num = (i: number) => (i < words.length && /^\d+$/.test(words[i]) ? Number(words[i]) : NaN);
  const take = (start: number, end: number, from: string, to: string) => {
    for (let k = start; k < end; k++) used.add(k);
    out.push({ start, end, from, to });
  };
  const daysAgo = (n: number) => new Date(Date.UTC(y0, m0 - 1, d0 - n)).toISOString().slice(0, 10);
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    const w = words[i];
    const [a, b, c] = [num(i), num(i + 1), num(i + 2)];
    if (a >= 1900 && a <= 2100 && b >= 1 && b <= 12 && c >= 1 && c <= 31) take(i, i + 3, iso(a, b, c), iso(a, b, c));
    else if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && c >= 1900 && c <= 2100) take(i, i + 3, iso(c, a, b), iso(c, a, b));
    else if (monthOf(w) && num(i + 1) >= 1 && num(i + 1) <= 31 && num(i + 2) >= 1900) take(i, i + 3, iso(num(i + 2), monthOf(w), num(i + 1)), iso(num(i + 2), monthOf(w), num(i + 1)));
    else if (a >= 1 && a <= 31 && monthOf(words[i + 1] ?? "") && num(i + 2) >= 1900) take(i, i + 3, iso(c, monthOf(words[i + 1]), a), iso(c, monthOf(words[i + 1]), a));
    else if (monthOf(w) && num(i + 1) >= 1900 && num(i + 1) <= 2100) take(i, i + 2, iso(num(i + 1), monthOf(w), 1), iso(num(i + 1), monthOf(w), lastDay(num(i + 1), monthOf(w))));
    else if (a >= 1900 && a <= 2100 && words[i].length === 4 && DATE_PREP.has(words[i - 1] ?? "")) take(i, i + 1, iso(a, 1, 1), iso(a, 12, 31));
    else if (w === "today" || w === "ngayon") take(i, i + 1, daysAgo(0), daysAgo(0));
    else if (w === "yesterday" || w === "kahapon") take(i, i + 1, daysAgo(1), daysAgo(1));
    else if ((w === "this" || w === "ngayong") && ["year", "taon", "month", "buwan", "week", "linggo"].includes(words[i + 1] ?? "")) {
      const unit = words[i + 1];
      if (unit === "year" || unit === "taon") take(i, i + 2, iso(y0, 1, 1), iso(y0, 12, 31));
      else if (unit === "month" || unit === "buwan") take(i, i + 2, iso(y0, m0, 1), iso(y0, m0, lastDay(y0, m0)));
      else take(i, i + 2, daysAgo((today.getUTCDay() + 6) % 7), daysAgo(0));
    } else if ((w === "last" || w === "nakaraang" || w === "past") && ["year", "taon", "month", "buwan", "week", "linggo"].includes(words[i + 1] ?? "")) {
      const unit = words[i + 1];
      if (unit === "year" || unit === "taon") take(i, i + 2, iso(y0 - 1, 1, 1), iso(y0 - 1, 12, 31));
      else if (unit === "month" || unit === "buwan") {
        const [y, m] = m0 === 1 ? [y0 - 1, 12] : [y0, m0 - 1];
        take(i, i + 2, iso(y, m, 1), iso(y, m, lastDay(y, m)));
      } else take(i, i + 2, daysAgo(7), daysAgo(0));
    } else if ((w === "last" || w === "past" || w === "nakaraang") && !Number.isNaN(b) && ["day", "days", "week", "weeks", "month", "months", "araw", "linggo", "buwan"].includes(words[i + 2] ?? "")) {
      const unit = words[i + 2];
      const days = /^(day|days|araw)$/.test(unit) ? b : /^(week|weeks|linggo)$/.test(unit) ? b * 7 : b * 30;
      take(i, i + 3, daysAgo(days), daysAgo(0));
    }
  }
  return out;
}

const spanOf = (s: { start: number; end: number }) => Array.from({ length: s.end - s.start }, (_, k) => s.start + k);
const near = (a: { start: number; end: number }, b: { start: number; end: number }, gap = 3) => b.start >= a.end && b.start - a.end <= gap;

/** Reads a question into a query over `columns`, or `null` when nothing in it relates to the data. */
export function parseQuestion(question: string, columns: DatasetColumn[], rows: DatasetRow[], today = new Date()): ParsedQuestion | null {
  const links = linkQuestion(question, columns, rows);
  const { words } = links;
  const used = new Set<number>();
  const mark = (s: { start: number; end: number }) => spanOf(s).forEach((k) => used.add(k));
  const columnLinks = [...links.columns];
  links.values.forEach(mark);
  const columnWords = new Set(columnLinks.flatMap(spanOf));

  // Intent words (never over a value the question names, nor a column — except words like "total" or "average" that a header can share).
  // One-word phrases only: "first registered" doesn't make "first" (as in First Name) an operation.
  const aggregateWords = new Set(AGGREGATES.flatMap(([, list]) => list.filter((phrase) => phrase.length === 1).map(([word]) => word)));
  const blocked = new Set([...used, ...[...columnWords].filter((k) => !aggregateWords.has(words[k]))]);
  // "phone number of Marcus" names a field; it isn't "how many".
  const count = locate(words, COUNT, blocked).filter((hit) => !(words[hit.start] === "number" && columnLinks.some((l) => l.end === hit.start)) || (hit.end > hit.start + 1 && (spanOf(hit).slice(1).forEach((k) => blocked.delete(k)), used.add(hit.start), false)));
  const group = locate(words, GROUP, blocked);
  const aggregates = AGGREGATES.flatMap(([kind, list]) => locate(words, list, blocked).map((hit) => ({ ...hit, kind })));
  const compares = COMPARE.flatMap(([op, list]) => locate(words, list, blocked).map((hit) => ({ ...hit, op })));
  const afterNumber = AFTER_NUMBER.flatMap(([op, list]) => locate(words, list, blocked).map((hit) => ({ ...hit, op })));
  const top = locate(words, TOP, blocked);
  const empties = locate(words, EMPTY, blocked);
  const where = locate(words, WHERE, blocked);
  const when = locate(words, WHEN, blocked);
  const howMuch = locate(words, HOW_MUCH, blocked);
  const distinct = locate(words, DISTINCT, blocked);
  const dates = findDates(words, blocked, today);
  const filled = locate(words, FILLED, blocked);
  const rowsWords = locate(words, ROWS, blocked);
  [count, group, aggregates, compares, afterNumber, top, empties, where, when, howMuch, distinct, dates, filled, rowsWords].flat().forEach(mark);
  // "Total sales per region" with a Total column: the word is the operation, and its column is what it works out.
  const aggOverlap = columnLinks.filter((l) => aggregates.some((a) => l.start < a.end && a.start < l.end));
  const aggColumn = aggOverlap.find((l) => l.column.type === "number")?.column;
  for (const link of aggOverlap) columnLinks.splice(columnLinks.indexOf(link), 1);

  const conditions: Condition[][] = [];
  const roleOf = new Map<ColumnLink, string>();
  const columnAfter = (s: { start: number; end: number }, test: (c: DatasetColumn) => boolean = () => true, gap = 3) => columnLinks.find((l) => !roleOf.has(l) && near(s, l, gap) && test(l.column));
  const isNumber = (c: DatasetColumn) => c.type === "number";
  const isDate = (c: DatasetColumn) => c.type === "date";
  const dateColumns = columns.filter(isDate);
  let note: string | undefined;

  // Comparisons: "more than 3", "between 10 and 20", "5 or more", "after 2025", "before March 2026".
  const numbers = links.numbers.filter((n) => !dates.some((d) => n.start >= d.start && n.start < d.end) && !columnWords.has(n.start));
  const numberTarget = (at: { start: number; end: number }, wantDate: boolean) => {
    const test = wantDate ? isDate : isNumber;
    const candidates = columnLinks.filter((l) => test(l.column) && roleOf.get(l) !== "group");
    const closest = candidates.sort((a, b) => Math.abs(a.start - at.start) - Math.abs(b.start - at.start))[0];
    if (closest) {
      roleOf.set(closest, "filter");
      return closest.column;
    }
    const all = columns.filter(test);
    return all.length === 1 ? all[0] : null;
  };
  const usedNumbers = new Set<number>();
  const usedDates = new Set<DateRange>();
  for (const hit of compares) {
    const date = dates.find((d) => near(hit, d, 1));
    const n1 = numbers.find((n) => near(hit, n, 2) && !usedNumbers.has(n.start));
    if (hit.op === "between") {
      const secondDate = date && dates.find((d) => d !== date && near(date, d, 2));
      const second = !date && n1 ? numbers.find((n) => n.start > n1.start && near(n1, n, 2)) : undefined;
      if (date && secondDate) {
        const column = numberTarget(hit, true);
        if (column) conditions.push([{ column: column.id, op: "at_least", value: date.from! }], [{ column: column.id, op: "at_most", value: secondDate.to! }]);
        usedDates.add(date).add(secondDate);
      } else if (n1 && second) {
        const column = numberTarget(hit, false);
        if (column) conditions.push([{ column: column.id, op: "at_least", value: n1.value }], [{ column: column.id, op: "at_most", value: second.value }]);
        usedNumbers.add(n1.start).add(second.start);
        mark(n1);
        mark(second);
      }
      continue;
    }
    if (date) {
      const column = numberTarget(hit, true);
      if (column) conditions.push([{ column: column.id, op: hit.op, value: hit.op === "greater_than" || hit.op === "at_most" ? date.to! : date.from! }]);
      usedDates.add(date);
    } else if (n1) {
      const column = numberTarget(hit, false);
      if (column) conditions.push([{ column: column.id, op: hit.op, value: n1.value }]);
      else note = `Say which number column to compare with ${n1.value}.`;
      usedNumbers.add(n1.start);
      mark(n1);
    }
  }
  for (const hit of afterNumber) {
    const n = numbers.find((x) => x.end === hit.start || x.end === hit.start - 1);
    const column = n && numberTarget(n, false);
    if (n && column) {
      conditions.push([{ column: column.id, op: hit.op, value: n.value }]);
      usedNumbers.add(n.start);
      mark(n);
    }
  }
  // A date on its own ("in 2025", "registered last month") is a range of the date column.
  for (const date of dates.filter((d) => !usedDates.has(d))) {
    const column = numberTarget(date, true);
    if (column) conditions.push([{ column: column.id, op: "at_least", value: date.from! }], [{ column: column.id, op: "at_most", value: date.to! }]);
    else note = "This dataset has no date column to check that date against.";
  }

  // "without an email" → empty ("out of stock" → 0 or empty; "without electricity" → No); "with an email" → filled in.
  for (const hit of empties) {
    const link = columnAfter(hit);
    if (!link) continue;
    const c = link.column;
    conditions.push(c.type === "boolean" ? [{ column: c.id, op: "equals", value: false }] : c.type === "number" ? [{ column: c.id, op: "is_empty" }, { column: c.id, op: "equals", value: 0 }] : [{ column: c.id, op: "is_empty" }]);
    roleOf.set(link, "filter");
  }
  for (const hit of filled) {
    const link = columnAfter(hit, () => true, 2);
    if (!link || links.values.some((v) => near(link, v, 1))) continue;
    conditions.push([link.column.type === "boolean" ? { column: link.column.id, op: "equals", value: true } : { column: link.column.id, op: "not_empty" }]);
    roleOf.set(link, "filter");
  }
  // "Not …" on a checkbox column (only ticks, no "No"): a blank box is a no too.
  const notTicked = (column: DatasetColumn): Condition =>
    rows.some((row) => row.values[column.id] === false) ? { column: column.id, op: "equals", value: false } : { column: column.id, op: "not_equals", value: true };
  // Yes/no columns named on their own: "vaccinated", "unvaccinated", "not paid", "hindi bakunado"; "failed" for Passed.
  for (const link of columnLinks.filter((l) => l.column.type === "boolean" && !roleOf.has(l))) {
    const word = words[link.start];
    const before = NEGATION.has(words[link.start - 1] ?? "");
    const negated = before || (/^(un|non|di|in)/.test(word) && !normalizeLabel(link.column.name).startsWith(word.slice(0, 2)));
    if (before) used.add(link.start - 1);
    conditions.push([negated ? notTicked(link.column) : { column: link.column.id, op: "equals", value: true }]);
    roleOf.set(link, "filter");
  }
  for (const column of columns.filter((c) => c.type === "boolean")) {
    const i = words.findIndex((w, k) => !used.has(k) && OPPOSITES[w] && relatesToHeader(OPPOSITES[w], column));
    if (i < 0) continue;
    conditions.push([notTicked(column)]);
    used.add(i);
  }

  // Grouping: "per barangay", "each country", "by month".
  const groupBy: string[] = [];
  for (const hit of group) {
    const link = columnAfter(hit, (c) => c.type !== "number");
    if (link) {
      groupBy.push(link.column.id);
      roleOf.set(link, "group");
    } else if (words[hit.start] !== "by") note ??= "Say which column to group by.";
  }

  // Values become filters: one group per set of columns ("dogs and cats" → Species is Dog or Cat; "dogs in Muzon" → two groups).
  const byColumns = new Map<string, Condition[]>();
  for (const value of links.values) {
    // A column named right before the value narrows it ("first name Hector").
    const named = columnLinks.find((l) => (l.end === value.start || l.end === value.start - 1) && !["of", "ni", "kay"].includes(words[l.end]) && value.matches.some((m) => m.column.id === l.column.id));
    const matches = named ? value.matches.filter((m) => m.column.id === named.column.id) : value.matches;
    if (named) roleOf.set(named, "filter");
    const group = matches.flatMap((m): Condition[] =>
      m.values.length > 30 ? [{ column: m.column.id, op: "contains", value: value.phrase }] : m.values.map((v) => ({ column: m.column.id, op: "equals", value: v })),
    );
    const key = matches.map((m) => m.column.id).sort().join("|");
    byColumns.set(key, [...(byColumns.get(key) ?? []), ...group]);
  }
  conditions.push(...byColumns.values());
  // Columns used only to say where a value is ("customers whose country is Chile") are part of that filter.
  for (const link of columnLinks) if (!roleOf.has(link) && !["of", "ni", "kay"].includes(words[link.end]) && links.values.some((v) => near(link, v, 2) && v.matches.some((m) => m.column.id === link.column.id))) roleOf.set(link, "filter");

  // What to work out.
  const query: DataQuery = { where: conditions, give: "rows" };
  const free = () => columnLinks.filter((l) => !roleOf.has(l));
  const agg = aggregates[0];
  const asksWho = rowsWords.some((r) => ["who", "which", "sino", "alin", "anong"].includes(r.text)) || top.length > 0;
  const topN = top.length ? (numbers.find((n) => near(top[0], n, 1) && !usedNumbers.has(n.start)) ?? null) : agg ? (numbers.find((n) => near(n, agg, 1) && !usedNumbers.has(n.start)) ?? null) : null;
  if (topN) {
    usedNumbers.add(topN.start);
    mark(topN);
  }

  if (agg) {
    const ageColumn = columns.find((c) => isNumber(c) && /\b(age|edad)\b/i.test(c.name));
    let kind: Aggregate = agg.kind === "latest" || agg.kind === "oldest" ? "max" : agg.kind === "earliest" || agg.kind === "youngest" ? "min" : agg.kind;
    let target = free().find((l) => isNumber(l.column) || ((kind === "max" || kind === "min") && isDate(l.column)))?.column;
    if (!target && (agg.kind === "oldest" || agg.kind === "youngest")) target = ageColumn ?? dateColumns[0];
    if (agg.kind === "oldest" && target && isDate(target)) kind = "min";
    if (agg.kind === "youngest" && target && isDate(target)) kind = "max";
    if (!target && (agg.kind === "latest" || agg.kind === "earliest")) target = dateColumns.length === 1 ? dateColumns[0] : undefined;
    // "Most expensive" / "pinakamura" are about a price; "total" of a Total column is that column.
    if (!target && /expensive|cheap|mahal|mura/.test(agg.text)) target = columns.find((c) => isNumber(c) && /price|cost|amount|presyo|halaga|total/i.test(c.name));
    target ??= aggColumn;
    // Or a column a word of the question is a form of ("most recent hire" → Hire Date).
    target ??= columns.find((c) => (isNumber(c) || ((kind === "max" || kind === "min") && isDate(c))) && words.some((w, k) => !columnWords.has(k) && relatesToHeader(w, c)));
    const link = columnLinks.find((l) => l.column === target);
    if (link) roleOf.set(link, "value");
    const category = free().find((l) => !isNumber(l.column) && !isDate(l.column));
    if (!target && (kind === "max" || kind === "min") && (category || groupBy.length)) {
      // "Which country has the most customers?" → count per country, most first.
      const by = groupBy.length ? groupBy : [category!.column.id];
      if (category) roleOf.set(category, "group");
      Object.assign(query, { give: "groups", groupBy: by, aggregate: "count", sort: { by: BY_VALUE, direction: kind === "max" ? "desc" : "asc" }, limit: topN?.value ?? 1 });
    } else if (!target && kind === "sum" && count.length) {
      query.give = "count";
    } else if (!target) {
      const numeric = columns.filter(isNumber);
      if (numeric.length === 1 && kind !== "count") target = numeric[0];
      else note ??= `Say which column to ${kind === "average" ? "average" : kind === "sum" ? "add up" : `find the ${kind === "max" ? "highest" : "lowest"} of`}.`;
    }
    // A superlative about the things in the data ("most expensive item", "highest paid employee") asks for that row.
    const things = free().filter((l) => !isNumber(l.column) && !isDate(l.column));
    // A date superlative is about a row too ("newest subscriber", "latest order").
    const aboutThings = (kind === "max" || kind === "min") && !groupBy.length && (things.length > 0 || words.some((w) => ENTITIES.has(stem(w))) || (!!target && isDate(target)));
    if (target && query.give === "rows" && aboutThings && !asksWho) things.forEach((l) => roleOf.set(l, "entity"));
    if (target && query.give === "rows") {
      if (asksWho || aboutThings || (topN && !groupBy.length)) Object.assign(query, { sort: { by: target.id, direction: kind === "min" ? "asc" : "desc" }, limit: topN?.value ?? 1 });
      else if (groupBy.length) Object.assign(query, { give: "groups", groupBy, aggregate: kind, of: target.id, ...(topN ? { sort: { by: BY_VALUE, direction: kind === "min" ? "asc" : "desc" }, limit: topN.value } : {}) });
      else Object.assign(query, { give: "value", aggregate: kind, of: target.id });
    }
  } else if (count.length) {
    const distinctColumn = !groupBy.length ? free().find((l) => !isNumber(l.column) && !conditions.some((g) => g.some((c) => c.column === l.column.id))) : undefined;
    if (groupBy.length) Object.assign(query, { give: "groups", groupBy, aggregate: "count" });
    else if (distinctColumn && !links.values.length) {
      // "How many countries are there?" → each country with its count.
      roleOf.set(distinctColumn, "group");
      Object.assign(query, { give: "groups", groupBy: [distinctColumn.column.id], aggregate: "count" });
    } else query.give = "count";
  } else if (groupBy.length) {
    Object.assign(query, { give: "groups", groupBy, aggregate: "count" });
  } else if (top.length) {
    // "top 2 students", "who was hired first", "bottom 3": sort by the number or date the question means, then the first N.
    const link = free().find((l) => isNumber(l.column) || isDate(l.column));
    const target = link?.column ?? columns.find((c) => (isNumber(c) || isDate(c)) && words.some((w, k) => !columnWords.has(k) && relatesToHeader(w, c))) ?? (columns.filter(isNumber).length === 1 ? columns.find(isNumber) : undefined);
    if (link) roleOf.set(link, "value");
    const word = top[0].text;
    if (target) Object.assign(query, { sort: { by: target.id, direction: word === "bottom" || ((word === "first" || word === "una") && isDate(target)) ? "asc" : "desc" } });
    query.limit = topN?.value ?? 1;
    free().filter((l) => !isNumber(l.column) && !isDate(l.column)).forEach((l) => roleOf.set(l, "entity"));
  }

  // Rows: the columns asked for ("email of Hector", "first names and emails"); "where"/"when" ask for places and dates.
  if (query.give === "rows") {
    let asked = free();
    // "employees in Makati", "items from Linis Corp": a plural header naming the things themselves means their whole rows.
    if (asked.length === 1 && conditions.length && !isFieldWord(words[asked[0].start]) && words[asked[0].start] !== stem(words[asked[0].start])) {
      roleOf.set(asked[0], "entity");
      asked = [];
    }
    asked.forEach((l) => roleOf.set(l, "output"));
    let output = asked.map((l) => l.column.id);
    if (!output.length && where.length) output = columns.filter((c) => /\b(address|city|country|town|barangay|province|region|location|street|tirahan|bansa|lungsod)\b/i.test(c.name)).map((c) => c.id);
    if (!output.length && when.length) output = dateColumns.map((c) => c.id);
    if (!output.length && howMuch.length) output = columns.filter((c) => isNumber(c) && /price|cost|amount|total|presyo|halaga|fee|rate/i.test(c.name)).map((c) => c.id);
    const plain = asked.length === 1 && !conditions.length && !query.sort && !query.limit && (distinct.length || words[asked[0].start] !== stem(words[asked[0].start]));
    if (plain) {
      // "List the countries" / "unique cities" → each value once, with how many rows have it.
      Object.assign(query, { give: "groups", groupBy: output, aggregate: "count" });
    } else if (output.length) query.columns = [...new Set(output)];
  }

  // What wasn't understood.
  const raw = question.normalize("NFD").replace(/\p{M}/gu, "").match(/\d+(?:[.,]\d+)*|[\p{L}\p{N}]+/gu) ?? [];
  columnLinks.forEach((l) => (roleOf.has(l) ? mark(l) : undefined));
  let leftover = words
    .map((w, i) => ({ w, i }))
    .filter(({ w, i }) => !used.has(i) && !FUNCTION_WORDS.has(w) && !GENERIC.has(w) && !GENERIC.has(stem(w)) && w.length > 1 && !usedNumbers.has(i) && !columns.some((c) => relatesToHeader(w, c)));
  // The dataset's own subject noun before the first value or column ("households in Poblacion", "ilan ang pamilya sa San Isidro").
  const firstLinked = Math.min(...links.values.map((v) => v.start), ...columnLinks.filter((l) => roleOf.has(l)).map((l) => l.start), words.length);
  const subject = leftover.find(({ i, w }) => i < firstLinked && w.length > 3 && !/^\p{Lu}/u.test(raw[i] ?? ""));
  if (subject && (conditions.length || query.give !== "rows")) leftover = leftover.filter((l) => l !== subject);
  const notFound = leftover.filter(({ i }) => i > 0 && /^\p{Lu}/u.test(raw[i] ?? "")).map(({ w, i }) => raw[i] ?? w);
  const unknown = leftover.map(({ w }) => w);
  const understoodAnything = conditions.length > 0 || query.give !== "rows" || !!query.columns?.length || !!query.sort || !!query.limit;
  if (!understoodAnything && !rowsWords.length && !note && !links.values.length && !columnLinks.length) return null;
  return { query, understood: describeQuery(query, columns), confident: unknown.length === 0 && !note, unknown, notFound, note };
}
