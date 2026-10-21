/**
 * Question Linking
 * Finds what a plain-language question refers to in a dataset, so questions
 * about any table can be read without a language model: the columns it
 * names (by header, header words or a common synonym, in English or
 * Filipino), the cell values it mentions (a whole value or part of one, in
 * any letter case, without accents, plural, or with a small typo), and the
 * numbers in it. Every word of the question gets a span, so the reader can
 * tell which words it understood and which it didn't.
 */

import { parseNumber } from "@/core/processing/dataset-inference";
import { normalizeValue, ruleForLabel } from "@/core/processing/value-normalizers";
import { displayValue } from "@/core/processing/dataset-commands";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

/** The question's words as typed (accents removed), in the same order as `wordsOf`. */
export const rawWordsOf = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").match(/\d+(?:[.,]\d+)*|[\p{L}\p{N}]+/gu) ?? [];

/** Lower case, accents removed, split into words and numbers ("José's 1,200.50" → "jose", "s", "1,200.50"); Filipino "pinakabagong" → "pinakabago". */
export function wordsOf(text: string): string[] {
  return rawWordsOf(text).map((w) => w.toLowerCase().replace(/^(pinaka\p{L}+[aeiou])ng$/u, "$1"));
}

/** "customers" → "customer", "addresses" → "address", "cities" → "city". */
export const stem = (word: string) => (word.length > 4 && word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.length > 4 && /(ss|sh|ch|x|z)es$/.test(word) ? word.slice(0, -2) : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);

/** Words that mean the same in a header ("Contact no." is asked for as "contact numbers", "Bansa" as "country"). */
const SYNONYMS = [
  ["number", "no", "num", "numero"],
  ["phone", "mobile", "cellphone", "cell", "telephone", "tel", "telepono", "cp", "contact"],
  ["email", "mail"],
  ["name", "pangalan"],
  ["address", "tirahan"],
  ["country", "bansa"],
  ["city", "lungsod", "siyudad"],
  ["age", "edad"],
  ["sex", "gender", "kasarian"],
  ["date", "petsa"],
  ["price", "presyo", "cost", "halaga"],
  ["quantity", "qty", "dami"],
  ["company", "kumpanya", "employer"],
  ["salary", "sahod", "sweldo", "wage"],
  ["grade", "score", "marka", "mark"],
  ["job", "position", "occupation", "trabaho"],
  ["birthday", "birthdate", "kaarawan"],
  ["electricity", "kuryente"],
  ["water", "tubig"],
  ["house", "bahay"],
  ["income", "kita"],
  ["invoice", "bill", "resibo"],
  ["due", "deadline", "takda"],
  ["bring", "dalhin"],
  ["total", "kabuuan", "kabuuang"],
];
/**
 * Everyday words that also mean the same as a cell value ("aso" is Dog, "babae" is Female) or an abbreviated sub-heading ("Sex F").
 * Kept apart from the header words above: "no" may be a header's "number", never a cell's "No".
 */
const VALUE_SYNONYMS = [
  ["male", "m", "lalaki", "lalake", "boy", "man", "men"],
  ["female", "f", "babae", "girl", "woman", "women"],
  ["dog", "aso"],
  ["cat", "pusa"],
];
const SYNONYM_OF = new Map([...SYNONYMS, ...VALUE_SYNONYMS].flatMap((group) => group.map((word) => [word, group[0]] as const)));
const VALUE_OF = new Map(VALUE_SYNONYMS.flatMap((group) => group.map((word) => [word, group[0]] as const)));
const valueMeaning = (word: string) => VALUE_OF.get(word) ?? VALUE_OF.get(stem(word));
export const canonical = (word: string) => SYNONYM_OF.get(word) ?? SYNONYM_OF.get(stem(word)) ?? stem(word);

/**
 * Field nouns: a longer header is also named by its field noun alone ("names" → First Name and Last Name,
 * "date" → Subscription Date) — never by words like "first", "last" or "customer" ("last month", "how many customers").
 */
const FIELD_NOUNS = new Set(
  "name email phone address country city age sex date price quantity company salary grade job birthday status type amount total balance category brand color size department course subject year level barangay town province region street zip species breed owner title description remarks notes".split(" "),
);

export interface Span {
  start: number;
  /** Exclusive. */
  end: number;
}

export interface ColumnLink extends Span {
  column: DatasetColumn;
  /** All of the header's words are in the question (not just its main word). */
  whole: boolean;
}

export interface ValueLink extends Span {
  /** Every column the phrase appears in, with the matching cell values (several when the phrase is part of longer values). */
  matches: { column: DatasetColumn; values: string[]; whole: boolean }[];
  /** The question's words, as typed. */
  phrase: string;
  /** Spelled differently from the data (a typo or variant). */
  fuzzy: boolean;
}

export interface NumberMention extends Span {
  value: number;
}

export interface QuestionLinks {
  words: string[];
  columns: ColumnLink[];
  values: ValueLink[];
  numbers: NumberMention[];
}

/** Words that never name a value on their own, even when a cell contains them ("The Home Depot", "Boyd and Sons"). */
export const FUNCTION_WORDS = new Set([
  ..."a an the of for to in on at is are was were be been do does did and or but if than then also just only all any some as about into with by from that this these those there here it its me my i you your we us our they them their he she his her him".split(" "),
  ..."what which who whom whose where when how why please can could would will should".split(" "),
  ..."ang ng mga sa si ni kay ay na at o ba po ko mo niya nila kanila ito iyan iyon dito doon yung yong kung para lang din rin naman".split(" "),
]);

interface IndexedValue {
  column: DatasetColumn;
  display: string;
  words: string[];
  /** Email addresses and web links count only when typed in full ("Pedro" isn't pedro@example.com). */
  wholeOnly: boolean;
}

/** Each text column's distinct values, by word. Words shared by many values of a column ("com", "inc") are left out: they tell nothing apart. */
function indexValues(columns: DatasetColumn[], rows: DatasetRow[]) {
  const byWord = new Map<string, IndexedValue[]>();
  for (const column of columns) {
    if (column.type !== "text") continue;
    const distinct = new Map<string, IndexedValue>();
    for (const row of rows) {
      const display = displayValue(row.values[column.id] ?? null).trim();
      if (!display || display.length > 120) continue;
      const words = wordsOf(display);
      const key = words.join(" ");
      if (key && !distinct.has(key)) distinct.set(key, { column, display, words, wholeOnly: /@|:\/\/|^www\./i.test(display) });
    }
    const spread = new Map<string, number>();
    for (const value of distinct.values()) for (const word of new Set(value.words)) spread.set(word, (spread.get(word) ?? 0) + 1);
    const common = (word: string) => distinct.size > 8 && (spread.get(word) ?? 0) > distinct.size * 0.25;
    for (const value of distinct.values()) {
      for (const word of new Set(value.words)) {
        // A short word like "it" or "and" is indexed only as a whole value ("IT" department), and matched only when typed in capitals.
        if (common(word) || (FUNCTION_WORDS.has(word) && value.words.length > 1)) continue;
        const list = byWord.get(word) ?? [];
        list.push(value);
        byWord.set(word, list);
      }
    }
  }
  return byWord;
}

/** A question word matches a data word exactly, as a plural, or (for longer words) with one or two letters off. */
function wordMatch(asked: string, data: string): "exact" | "fuzzy" | null {
  if (asked === data || stem(asked) === stem(data)) return "exact";
  if (valueMeaning(asked) && valueMeaning(asked) === valueMeaning(data)) return "exact";
  // Codes and numbers must match exactly.
  if (!/^\p{L}+$/u.test(asked) || !/^\p{L}+$/u.test(data)) return null;
  if (asked.length < 5 || data.length < 5 || asked[0] !== data[0] || Math.abs(asked.length - data.length) > 2) return null;
  return typoDistance(asked, data) <= (Math.min(asked.length, data.length) >= 8 ? 2 : 1) ? "fuzzy" : null;
}

/** Edit distance where swapping two neighbouring letters is one slip, not two ("finlnad" → "finland"). */
function typoDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function linkColumns(words: string[], columns: DatasetColumn[]): ColumnLink[] {
  const asked = words.map(canonical);
  const links: ColumnLink[] = [];
  for (const column of columns) {
    const header = wordsOf(column.name).map(canonical);
    if (!header.length) continue;
    // The whole header, in order ("first names" → First Name, "contact numbers" → Contact no.).
    let found = false;
    for (let i = 0; i + header.length <= asked.length; i++) {
      if (header.every((word, j) => asked[i + j] === word)) {
        links.push({ column, start: i, end: i + header.length, whole: true });
        found = true;
      }
    }
    if (found) continue;
    // Or its head word: the last word ("Monthly Income" → income, "Has Electricity" → electricity), unless that only identifies
    // (Customer Id, Order No, Phone 2) — then a field noun in it (phone). One-word headers also through a negating prefix ("unpaid").
    const last = header.at(-1)!;
    const head = header.length === 1 || (!ID_WORDS.has(last) && !/^\d+$/.test(last) && last.length >= 3) ? last : [...header].reverse().find((word) => FIELD_NOUNS.has(word));
    if (!head || head.length < 3 || /^\d+$/.test(head)) continue;
    const prefixed = (index: number) => header.length === 1 && head.length >= 4 && [2, 3].some((cut) => words[index].length >= cut + head.length && /^(un|non|di|in)/.test(words[index]) && words[index].slice(cut).startsWith(head));
    const i = asked.findIndex((word, index) => word === head || prefixed(index));
    if (i >= 0) links.push({ column, start: i, end: i + 1, whole: false });
  }
  // A whole header beats another header's head word on the same words ("first names" is First Name, not also Last Name).
  return links.filter((l) => l.whole || !links.some((w) => w.whole && w.start <= l.start && l.start < w.end));
}

const ID_WORDS = new Set(["id", "number", "code", "ref", "key", "index", "sku"]);

/** True for words that name a field (email, phone, price…) rather than the people or things a table lists. */
export const isFieldWord = (word: string) => FIELD_NOUNS.has(canonical(word));

/** True when a question word is a form of one of the header's words ("subscribed" → Subscription Date, "hired" → Hire Date). */
export function relatesToHeader(word: string, column: DatasetColumn) {
  return wordsOf(column.name).some((h) => h.length >= 4 && (stem(word) === stem(h) || word.startsWith(h) || (word.length >= 4 && h.startsWith(word)) || (word.length >= 6 && h.length >= 6 && word.slice(0, 6) === h.slice(0, 6))));
}

function linkValues(words: string[], taken: Set<number>, index: Map<string, IndexedValue[]>, acronyms: Set<number>): ValueLink[] {
  const dataWords = [...index.keys()];
  type Candidate = { start: number; end: number; value: IndexedValue; whole: boolean; fuzzy: boolean };
  const candidates: Candidate[] = [];
  for (let i = 0; i < words.length; i++) {
    if (taken.has(i) || (FUNCTION_WORDS.has(words[i]) && !acronyms.has(i)) || words[i].length < 2) continue;
    // Words of the data this question word could be.
    const near = index.has(words[i]) ? [{ word: words[i], fuzzy: false }] : [];
    for (const word of dataWords) {
      if (word === words[i]) continue;
      const kind = wordMatch(words[i], word);
      if (kind) near.push({ word, fuzzy: kind === "fuzzy" });
    }
    for (const { word, fuzzy } of near) {
      for (const value of index.get(word) ?? []) {
        // Extend over the following question words while they continue the value ("new zealand", "rich santos").
        const at = value.words.indexOf(word);
        let end = i + 1;
        while (end < words.length && at + (end - i) < value.words.length && !taken.has(end) && wordMatch(words[end], value.words[at + (end - i)])) end++;
        const whole = at === 0 && end - i === value.words.length;
        if (value.wholeOnly && !whole) continue;
        candidates.push({ start: i, end, value, whole, fuzzy });
      }
    }
  }
  // Longest phrases first; then whole values over parts of values, exact over fuzzy.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || Number(b.whole) - Number(a.whole) || Number(a.fuzzy) - Number(b.fuzzy));
  const links: ValueLink[] = [];
  const used = new Set<number>();
  for (const best of candidates) {
    if (Array.from({ length: best.end - best.start }, (_, k) => best.start + k).some((k) => used.has(k))) continue;
    // Everything as good as the best for this phrase: the same words in other values or columns.
    const tied = candidates.filter((c) => c.start === best.start && c.end === best.end && c.whole === best.whole && c.fuzzy === best.fuzzy);
    const byColumn = new Map<string, { column: DatasetColumn; values: string[]; whole: boolean }>();
    for (const c of tied) {
      const entry = byColumn.get(c.value.column.id) ?? { column: c.value.column, values: [], whole: c.whole };
      if (!entry.values.includes(c.value.display)) entry.values.push(c.value.display);
      byColumn.set(c.value.column.id, entry);
    }
    links.push({ start: best.start, end: best.end, matches: [...byColumn.values()], phrase: words.slice(best.start, best.end).join(" "), fuzzy: best.fuzzy });
    for (let k = best.start; k < best.end; k++) used.add(k);
  }
  return links.sort((a, b) => a.start - b.start);
}

/** Links a question to a dataset's columns, values and numbers. */
export function linkQuestion(question: string, columns: DatasetColumn[], rows: DatasetRow[]): QuestionLinks {
  const words = wordsOf(question);
  const numbers: NumberMention[] = [];
  words.forEach((word, i) => {
    const value = /^\d/.test(word) ? parseNumber(word) : null;
    if (value !== null) numbers.push({ value, start: i, end: i + 1 });
  });
  const columnLinks = linkColumns(words, columns);
  // A word that names a column (or is a plain number) isn't also read as a value.
  const taken = new Set([...columnLinks, ...numbers].flatMap((s) => Array.from({ length: s.end - s.start }, (_, k) => s.start + k)));
  const raw = rawWordsOf(question);
  const acronyms = new Set(raw.map((w, i) => (w.length >= 2 && w === w.toUpperCase() && /\p{L}/u.test(w) ? i : -1)).filter((i) => i >= 0));
  const values = linkValues(words, taken, indexValues(columns, rows), acronyms);
  // Words a column's cleaning rule knows ("boys" → Male, "babae" → Female in a Sex column).
  const linked = new Set([...taken, ...values.flatMap((v) => Array.from({ length: v.end - v.start }, (_, k) => v.start + k))]);
  for (const column of columns.filter((c) => c.type === "text" && ruleForLabel(c.name))) {
    const rule = ruleForLabel(column.name)!;
    const cells = new Map<string, string>();
    for (const row of rows) {
      const display = displayValue(row.values[column.id] ?? null).trim();
      if (display) cells.set(String(normalizeValue(rule, display)).toLowerCase(), cells.get(String(normalizeValue(rule, display)).toLowerCase()) ?? display);
    }
    words.forEach((word, i) => {
      if (linked.has(i) || FUNCTION_WORDS.has(word)) return;
      const meant = String(normalizeValue(rule, word)).toLowerCase();
      const display = meant !== word ? cells.get(meant) : undefined;
      if (!display) return;
      values.push({ start: i, end: i + 1, matches: [{ column, values: [display], whole: true }], phrase: word, fuzzy: false });
      linked.add(i);
    });
  }
  return { words, columns: columnLinks, values: values.sort((a, b) => a.start - b.start), numbers };
}
