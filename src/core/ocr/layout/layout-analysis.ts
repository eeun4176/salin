/**
 * Layout Analysis
 * Rebuilds a page's structure from OCR words plus the ruling lines and
 * checkboxes found in the image: ruled tables (drawn grids, with merged
 * cells), aligned tables (columns of text without lines, with wrapped rows
 * joined), "Label: value" fields (including fill-in lines and checkbox
 * choices), headings, and ordinary text in reading order (two-column pages
 * read column by column). Decorative borders, empty grids, overlapping marks
 * and low-confidence regions are reported as issues. Nothing is invented:
 * an empty cell or blank field stays empty.
 */

import { bottom, centerX, centerY, containsPoint, median, overlapRatio, right, union, verticalOverlap } from "@/core/ocr/layout/geometry";
import type {
  Box,
  CheckboxMark,
  KeyValue,
  LayoutCell,
  LayoutCheckbox,
  LayoutIssue,
  LayoutTable,
  LayoutText,
  OcrLine,
  OcrWord,
  PageLayout,
  PageMarks,
} from "@/types/ocr";

export interface LayoutInput {
  width: number;
  height: number;
  lines: OcrLine[];
  marks: PageMarks | null;
}

interface Word extends OcrWord {
  id: number;
}

interface Row {
  words: Word[];
  box: Box;
}

interface Chunk {
  words: Word[];
  box: Box;
  text: string;
}

const LOW_CONFIDENCE = 50;

const meanConfidence = (words: OcrWord[]) => (words.length ? Math.round((words.reduce((s, w) => s + w.confidence, 0) / words.length) * 10) / 10 : 0);
const joinWords = (words: OcrWord[]) => words.map((w) => w.text).join(" ");
const unclearOf = (words: OcrWord[]) => words.map((w) => w.unclear).join("");
const isNumeric = (text: string) => /^[\s\d.,:/%₱$+()-]+$/.test(text) && /\d/.test(text);

/** Groups words into visual rows (words whose vertical centres line up), each sorted left to right. */
export function groupRows(words: Word[], lineHeight: number): Row[] {
  const rows: Row[] = [];
  for (const word of [...words].sort((a, b) => centerY(a.box) - centerY(b.box))) {
    const row = rows.find((r) => Math.abs(centerY(r.box) - centerY(word.box)) < lineHeight * 0.55 && verticalOverlap(r.box, word.box) > 0.35);
    if (row) {
      row.words.push(word);
      row.box = union([row.box, word.box]);
    } else {
      rows.push({ words: [word], box: { ...word.box } });
    }
  }
  for (const row of rows) row.words.sort((a, b) => a.box.x - b.box.x);
  return rows.sort((a, b) => a.box.y - b.box.y);
}

/** Splits a row where the gap between words is wide (a new column or field) or a drawn line separates them. */
function chunksOf(row: Row, lineHeight: number, vertical: Box[]): Chunk[] {
  const chunks: Word[][] = [];
  let current: Word[] = [];
  for (const word of row.words) {
    const prev = current[current.length - 1];
    if (prev) {
      const gap = word.box.x - right(prev.box);
      const ruled = vertical.some((v) => v.x >= right(prev.box) - 2 && right(v) <= word.box.x + 2 && v.y <= centerY(word.box) && bottom(v) >= centerY(word.box));
      if (gap > lineHeight * 1.2 || ruled) {
        chunks.push(current);
        current = [];
      }
    }
    current.push(word);
  }
  if (current.length) chunks.push(current);
  return chunks.map((words) => ({ words, box: union(words.map((w) => w.box)), text: joinWords(words) }));
}

/* ------------------------------------------------------------------
   Ruled tables
------------------------------------------------------------------- */

/** Sorted positions with near-duplicates (within `tolerance`) merged. */
function distinct(values: number[], tolerance: number) {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length && v - out[out.length - 1] <= tolerance) continue;
    out.push(v);
  }
  return out;
}

interface RuledResult {
  tables: LayoutTable[];
  used: Set<number>;
  issues: LayoutIssue[];
}

function findRuledTables(words: Word[], marks: PageMarks, width: number, height: number, lineHeight: number): RuledResult {
  const result: RuledResult = { tables: [], used: new Set(), issues: [] };
  const tolerance = Math.max(6, height * 0.012);
  const groups: Box[][] = [];
  for (const v of [...marks.vertical].sort((a, b) => a.y - b.y)) {
    const group = groups.find((g) => Math.abs(g[0].y - v.y) <= tolerance && Math.abs(bottom(g[0]) - bottom(v)) <= tolerance);
    if (group) group.push(v);
    else groups.push([v]);
  }

  for (const group of groups) {
    const xs = distinct(group.map(centerX), lineHeight * 0.5);
    if (xs.length < 2) continue;
    const box: Box = { x: xs[0], y: group[0].y, width: xs[xs.length - 1] - xs[0], height: group[0].height };
    if (box.width < lineHeight * 3 || box.height < lineHeight * 1.5) continue;
    const inside = words.filter((w) => !result.used.has(w.id) && containsPoint(box, centerX(w.box), centerY(w.box)));

    // Two long verticals around most of the page with nothing between them: a frame.
    const isFrame = xs.length === 2 && box.width > width * 0.8 && box.height > height * 0.6;
    if (isFrame) {
      result.issues.push({ kind: "decorative", message: "A decorative border around the page was ignored.", box });
      continue;
    }

    const rowLines = distinct(
      marks.horizontal.filter((h) => h.width >= box.width * 0.7 && centerY(h) >= box.y - tolerance && centerY(h) <= bottom(box) + tolerance).map(centerY),
      lineHeight * 0.5,
    );
    // Columns also come from shorter verticals inside the table (sub-columns under a merged heading).
    const inner = marks.vertical.filter((v) => v.height >= lineHeight * 1.2 && centerX(v) > box.x + lineHeight * 0.5 && centerX(v) < right(box) - lineHeight * 0.5 && v.y >= box.y - tolerance && bottom(v) <= bottom(box) + tolerance);
    const columnsX = distinct([...xs, ...inner.map(centerX)], lineHeight * 0.5);
    if (columnsX.length < 3 || rowLines.length < 2) {
      // A box with no internal grid is a section, not a table.
      continue;
    }
    if (inside.length === 0) {
      result.issues.push({ kind: "empty-table", message: "An empty table (no filled-in rows) was skipped.", box });
      continue;
    }

    const rowEdges = distinct([box.y, ...rowLines, bottom(box)], lineHeight * 0.5);
    const columns = columnsX.slice(0, -1).map((x0, i) => ({ x0, x1: columnsX[i + 1] }));
    // Bands between drawn row lines. Below the first band (the header, whose text may wrap),
    // a band holding several lines of text without lines between them is several records.
    const bands: [number, number][] = [];
    for (let r = 0; r < rowEdges.length - 1; r++) {
      const top = rowEdges[r];
      const bot = rowEdges[r + 1];
      if (bot - top < lineHeight * 0.6) continue;
      const textRows = groupRows(
        inside.filter((w) => centerY(w.box) > top && centerY(w.box) < bot),
        lineHeight,
      );
      if (bands.length === 0 || textRows.length < 2) {
        bands.push([top, bot]);
        continue;
      }
      let edge = top;
      for (let k = 1; k < textRows.length; k++) {
        const split = (bottom(textRows[k - 1].box) + textRows[k].box.y) / 2;
        bands.push([edge, split]);
        edge = split;
      }
      bands.push([edge, bot]);
    }
    const rows: LayoutTable["rows"] = [];
    for (const [top, bot] of bands) {
      const mid = (top + bot) / 2;
      const rowBox: Box = { x: box.x, y: top, width: box.width, height: bot - top };
      const cells: LayoutCell[] = columns.map((c) => {
        const cellBox: Box = { x: c.x0, y: top, width: c.x1 - c.x0, height: bot - top };
        const cellWords = inside.filter((w) => containsPoint(cellBox, centerX(w.box), centerY(w.box))).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
        cellWords.forEach((w) => result.used.add(w.id));
        return { text: joinWords(cellWords), box: cellBox, confidence: cellWords.length ? meanConfidence(cellWords) : null, unclear: unclearOf(cellWords) };
      });
      // Where no vertical line crosses this row at a column boundary, the cells are merged.
      for (let c = 1; c < columns.length; c++) {
        const x = columns[c].x0;
        const crossed = marks.vertical.some((v) => Math.abs(centerX(v) - x) <= lineHeight * 0.5 && v.y <= mid && bottom(v) >= mid);
        if (crossed) continue;
        let first = c - 1;
        while (first > 0 && cells[first].merged && cells[first].text === "" && cells[first].confidence === null) first--;
        const target = cells[first];
        const joined = [target.text, cells[c].text].filter(Boolean).join(" ");
        cells[first] = { ...target, text: joined, box: union([target.box, cells[c].box]), merged: true, confidence: target.confidence ?? cells[c].confidence };
        cells[c] = { text: "", box: cells[c].box, confidence: null, unclear: "", merged: true };
      }
      rows.push({ box: rowBox, cells });
    }
    // Trailing blank rows of a printed form are not records.
    while (rows.length && rows[rows.length - 1].cells.every((c) => c.text === "")) rows.pop();
    if (rows.length === 0) continue;
    result.tables.push({ id: `t${result.tables.length + 1}`, box, source: "ruled", columns, rows, headerRows: headerRowsOf(rows) });
  }
  return result;
}

/** 1 when the first row reads like column names (words, mostly filled, unlike the rows below). */
function headerRowsOf(rows: LayoutTable["rows"]) {
  if (rows.length < 2) return 0;
  const first = rows[0].cells.filter((c) => c.text !== "");
  if (first.length < Math.max(2, rows[0].cells.length * 0.6)) return 0;
  if (first.some((c) => isNumeric(c.text))) return 0;
  return 1;
}

/* ------------------------------------------------------------------
   Aligned (unruled) tables
------------------------------------------------------------------- */

const isLabelChunk = (chunk: Chunk) => /[A-Za-z].*:\s*\S*/.test(chunk.text) && /:/.test(chunk.text);

function findAlignedTables(rows: Row[], used: Set<number>, lineHeight: number, vertical: Box[], startId: number, pageWidth: number) {
  const tables: LayoutTable[] = [];
  const free = rows
    .map((row) => ({ ...row, words: row.words.filter((w) => !used.has(w.id)) }))
    .filter((row) => row.words.length > 0)
    .map((row) => ({ row, chunks: chunksOf({ words: row.words, box: union(row.words.map((w) => w.box)) }, lineHeight, vertical) }));

  // A line that starts with "Label:" is a form line (e.g. "Species: ☑ Dog ☐ Cat"), not a table row.
  const tabular = (entry: (typeof free)[number]) =>
    entry.chunks.length >= 2 && !isLabelChunk(entry.chunks[0]) && entry.chunks.filter(isLabelChunk).length < entry.chunks.length / 2;

  let i = 0;
  while (i < free.length) {
    if (!tabular(free[i])) {
      i++;
      continue;
    }
    const run = [free[i]];
    let j = i + 1;
    while (j < free.length) {
      const prev = run[run.length - 1];
      const gap = free[j].row.box.y - bottom(prev.row.box);
      if (gap > lineHeight * 2.2) break;
      if (tabular(free[j])) {
        run.push(free[j]);
        j++;
        continue;
      }
      // A wrapped line of the previous record: one short chunk right under it.
      if (free[j].chunks.length === 1 && gap < lineHeight * 0.6 && j + 1 < free.length && tabular(free[j + 1])) {
        run.push(free[j]);
        j++;
        continue;
      }
      break;
    }
    const table = alignedTable(run, lineHeight, `t${startId + tables.length}`, pageWidth);
    if (table) {
      tables.push(table);
      for (const entry of run) entry.row.words.forEach((w) => used.add(w.id));
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

function alignedTable(run: { row: Row; chunks: Chunk[] }[], lineHeight: number, id: string, pageWidth: number): LayoutTable | null {
  const multi = run.filter((e) => e.chunks.length >= 2);
  if (multi.length < 2 || (multi.length < 3 && Math.max(...multi.map((e) => e.chunks.length)) < 3)) return null;

  // Column intervals: overlapping chunk spans across rows merge into one column.
  const spans = multi.flatMap((e) => e.chunks.map((c) => [c.box.x, right(c.box)] as [number, number])).sort((a, b) => a[0] - b[0]);
  const intervals: [number, number][] = [];
  for (const [x0, x1] of spans) {
    const last = intervals[intervals.length - 1];
    if (last && x0 <= last[1] + lineHeight * 0.3) last[1] = Math.max(last[1], x1);
    else intervals.push([x0, x1]);
  }
  if (intervals.length < 2) return null;
  // Two wide columns of running text are a two-column page, not a table.
  if (intervals.length === 2 && intervals.every(([a, b]) => b - a > pageWidth * 0.28)) return null;
  const spread = multi.filter((e) => new Set(e.chunks.map((c) => intervals.findIndex(([a, b]) => centerX(c.box) >= a && centerX(c.box) <= b))).size >= 2).length;
  if (spread < multi.length * 0.6) return null;

  const columnOf = (w: OcrWord) => {
    const cx = centerX(w.box);
    let best = 0;
    let bestDistance = Infinity;
    intervals.forEach(([a, b], k) => {
      const d = cx < a ? a - cx : cx > b ? cx - b : 0;
      if (d < bestDistance) [best, bestDistance] = [k, d];
    });
    return best;
  };

  const rows: LayoutTable["rows"] = [];
  for (const entry of run) {
    const byColumn: OcrWord[][] = intervals.map(() => []);
    for (const w of entry.row.words) byColumn[columnOf(w)].push(w);
    const cells: LayoutCell[] = byColumn.map((ws, k) => ({
      text: joinWords(ws),
      box: ws.length ? union(ws.map((w) => w.box)) : { x: intervals[k][0], y: entry.row.box.y, width: intervals[k][1] - intervals[k][0], height: entry.row.box.height },
      confidence: ws.length ? meanConfidence(ws) : null,
      unclear: unclearOf(ws),
    }));
    const prev = rows[rows.length - 1];
    const gap = prev ? entry.row.box.y - bottom(prev.box) : Infinity;
    // Wrapped text: no first-column value and tucked right under the previous record.
    if (prev && rows.length > 1 && cells[0].text === "" && gap < lineHeight * 0.6) {
      prev.cells = prev.cells.map((c, k) => (cells[k].text ? { ...c, text: [c.text, cells[k].text].filter(Boolean).join(" "), box: union([c.box, cells[k].box]), confidence: Math.min(c.confidence ?? 100, cells[k].confidence ?? 100) } : c));
      prev.box = union([prev.box, entry.row.box]);
      continue;
    }
    rows.push({ box: entry.row.box, cells });
  }
  const box = union(rows.map((r) => r.box));
  return { id, box, source: "aligned", columns: intervals.map(([x0, x1]) => ({ x0, x1 })), rows, headerRows: headerRowsOf(rows) };
}

/* ------------------------------------------------------------------
   Fields, checkboxes, headings, text
------------------------------------------------------------------- */

function attachCheckboxLabels(checkboxes: CheckboxMark[], rows: Row[], lineHeight: number): LayoutCheckbox[] {
  const sorted = [...checkboxes].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return sorted.map((mark) => {
    const row = rows.find((r) => verticalOverlap(r.box, mark.box) > 0.3);
    if (!row) return { ...mark, label: "", labelBox: null };
    // Words to the right, up to the next checkbox or a wide gap.
    const nextBox = sorted.find((o) => o !== mark && verticalOverlap(o.box, mark.box) > 0.3 && o.box.x > right(mark.box));
    const label: Word[] = [];
    for (const w of row.words) {
      if (w.box.x < right(mark.box) - 2) continue;
      if (nextBox && w.box.x >= nextBox.box.x) break;
      const prevRight = label.length ? right(label[label.length - 1].box) : right(mark.box);
      if (w.box.x - prevRight > lineHeight * 1.5) break;
      label.push(w);
    }
    return { ...mark, label: joinWords(label).replace(/[:;,]$/, ""), labelBox: label.length ? union(label.map((w) => w.box)) : null };
  });
}

/** Words that commonly start a two-word label ("Date of Birth:", "Contact No.:", "Pet Name:"). */
const LABEL_LEAD = /^(date|pet|owner'?s?|contact|mobile|cell|phone|tel\.?|home|civil|birth|total|no\.?|zip|email|e-mail|place|name|of|first|last|middle|full|signature)$/i;

/**
 * "Name: Ana" style fields, plus labels followed by a fill-in line or
 * checkbox choices. A row splits into chunks at wide gaps; inside a chunk a
 * word ending in ":" closes a label. The first label of a chunk may be up
 * to five words; later ones (packed right after another value) take one
 * word, or two when the first is a typical label word ("Date of", "Pet").
 */
function findKeyValues(rows: Row[], used: Set<number>, marks: PageMarks | null, checkboxes: LayoutCheckbox[], lineHeight: number): { keyValues: KeyValue[]; consumed: Set<number> } {
  const keyValues: KeyValue[] = [];
  const consumed = new Set<number>();
  const underlines = marks?.horizontal ?? [];
  const checkboxWords = new Set<number>();
  for (const cb of checkboxes) {
    if (!cb.labelBox) continue;
    for (const row of rows) for (const w of row.words) if (overlapRatio(w.box, cb.labelBox) > 0.6) checkboxWords.add(w.id);
  }

  for (const row of rows) {
    const free = row.words.filter((w) => !used.has(w.id));
    if (free.length === 0) continue;
    const chunks = chunksOf({ words: free, box: union(free.map((w) => w.box)) }, lineHeight, []);

    chunks.forEach((chunk, c) => {
      const words = chunk.words;
      const ends = words.map((w, i) => (/:$/.test(w.text) ? i : -1)).filter((i) => i >= 0);
      if (ends.length === 0) return;
      const starts = ends.map((end, k) => {
        if (k === 0) return Math.max(0, end - 4);
        let start = end;
        if (start - 1 > ends[k - 1] + 1 && LABEL_LEAD.test(words[start - 1].text)) start--;
        return start;
      });

      ends.forEach((end, k) => {
        const labelWords = words.slice(starts[k], end + 1);
        const label = joinWords(labelWords).replace(/\s*:$/, "").trim();
        if (!/[A-Za-z]{2}/.test(label)) return;
        const labelBox = union(labelWords.map((w) => w.box));
        let valueWords = words.slice(end + 1, k + 1 < ends.length ? starts[k + 1] : words.length);
        // "Name:      Ana Cruz" — the value is the next chunk on the line when it isn't a label itself.
        const next = chunks[c + 1];
        if (valueWords.length === 0 && k === ends.length - 1 && next && !next.words.some((w) => /:$/.test(w.text)) && !next.words.some((w) => consumed.has(w.id))) {
          valueWords = next.words;
        }
        valueWords = valueWords.filter((w) => !checkboxWords.has(w.id));
        labelWords.forEach((w) => consumed.add(w.id));
        valueWords.forEach((w) => consumed.add(w.id));

        // Checkbox choices to the right of the label (before the next label) make the value.
        const limit = k + 1 < ends.length ? words[starts[k + 1]].box.x : chunks[c + 1]?.words.some((w) => /:$/.test(w.text)) ? chunks[c + 1].box.x : Infinity;
        const boxes = checkboxes.filter((cb) => verticalOverlap(cb.box, row.box) > 0.3 && cb.box.x > right(labelBox) && cb.box.x < limit);
        if (boxes.length) {
          const checked = boxes.filter((cb) => cb.state === "checked");
          keyValues.push({
            label,
            labelBox,
            value: checked.map((cb) => cb.label).join(", "),
            valueBox: union(boxes.map((cb) => (cb.labelBox ? union([cb.box, cb.labelBox]) : cb.box))),
            confidence: boxes.some((cb) => cb.state === "unclear") ? 40 : 95,
            unclear: "",
          });
          return;
        }

        const underline = underlines.find((u) => u.x >= right(labelBox) - lineHeight && u.x <= right(labelBox) + lineHeight * 3 && Math.abs(u.y - bottom(labelBox)) < lineHeight * 0.8);
        const valueBox = valueWords.length
          ? union(valueWords.map((w) => w.box))
          : underline
            ? { x: underline.x, y: underline.y - lineHeight * 1.4, width: underline.width, height: lineHeight * 1.4 }
            : null;
        keyValues.push({ label, labelBox, value: joinWords(valueWords), valueBox, confidence: valueWords.length ? meanConfidence(valueWords) : null, unclear: unclearOf(valueWords) });
      });
    });
  }
  return { keyValues, consumed };
}

/** Finds a vertical gutter that splits the text into two columns. Returns its x, or null. */
function findGutter(lines: LayoutText[], width: number) {
  if (lines.length < 6) return null;
  const bins = 100;
  const coverage = new Uint16Array(bins);
  for (const line of lines) {
    if (line.box.width > width * 0.6) continue; // full-width lines don't decide columns
    const a = Math.floor((line.box.x / width) * bins);
    const b = Math.min(bins - 1, Math.floor((right(line.box) / width) * bins));
    for (let k = a; k <= b; k++) coverage[k]++;
  }
  let bestStart = -1;
  let bestLength = 0;
  for (let k = 25; k <= 75; k++) {
    if (coverage[k] !== 0) continue;
    let end = k;
    while (end + 1 < bins && coverage[end + 1] === 0) end++;
    if (end - k + 1 > bestLength) [bestStart, bestLength] = [k, end - k + 1];
    k = end;
  }
  if (bestLength < 2) return null;
  const gutter = ((bestStart + bestLength / 2) / bins) * width;
  const left = lines.filter((l) => right(l.box) < gutter).length;
  const rightCount = lines.filter((l) => l.box.x > gutter).length;
  return left >= 3 && rightCount >= 3 ? gutter : null;
}

export function analyzeLayout({ width, height, lines, marks }: LayoutInput): PageLayout {
  let nextId = 0;
  const words: Word[] = lines.flatMap((line) => line.words.map((w) => ({ ...w, id: nextId++ })));
  const issues: LayoutIssue[] = [];
  const empty: PageLayout = { headings: [], text: [], keyValues: [], tables: [], checkboxes: [], columns: 1, issues };
  if (words.length === 0) return empty;

  const lineHeight = Math.max(8, median(words.map((w) => w.box.height)));
  const rows = groupRows(words, lineHeight);

  // 1. Ruled tables, 2. aligned tables.
  const ruled = marks ? findRuledTables(words, marks, width, height, lineHeight) : { tables: [], used: new Set<number>(), issues: [] };
  issues.push(...ruled.issues);
  const used = ruled.used;
  const checkboxes = attachCheckboxLabels(marks?.checkboxes ?? [], rows, lineHeight);
  const aligned = findAlignedTables(rows, used, lineHeight, marks?.vertical ?? [], ruled.tables.length + 1, width);
  const tables = [...ruled.tables, ...aligned].sort((a, b) => a.box.y - b.box.y);

  // 3. Fields.
  const { keyValues, consumed } = findKeyValues(rows, used, marks, checkboxes, lineHeight);
  for (const id of consumed) used.add(id);

  // 4. Headings and text from what's left, as visual lines.
  const leftover = groupRows(
    words.filter((w) => !used.has(w.id)),
    lineHeight,
  );
  const headings: LayoutText[] = [];
  const text: LayoutText[] = [];
  for (const row of leftover) {
    for (const chunk of chunksOf(row, lineHeight, [])) {
      const item = { text: chunk.text, box: chunk.box, confidence: meanConfidence(chunk.words) };
      const tall = median(chunk.words.map((w) => w.box.height)) >= lineHeight * 1.35;
      const shouting = chunk.words.length <= 8 && chunk.text === chunk.text.toUpperCase() && /[A-Z]{3}/.test(chunk.text) && chunk.box.y < height * 0.25;
      (tall || shouting ? headings : text).push(item);
    }
  }
  const gutter = findGutter(text, width);
  const ordered = text
    .map((t) => ({ ...t, column: gutter !== null && t.box.x > gutter ? 1 : 0 }))
    .sort((a, b) => a.column - b.column || a.box.y - b.box.y || a.box.x - b.box.x);

  // 5. Issues: overlapping marks (stamps, writing over print) and unclear regions.
  for (let a = 0; a < words.length; a++) {
    for (let b = a + 1; b < words.length; b++) {
      if (overlapRatio(words[a].box, words[b].box) > 0.45) {
        issues.push({ kind: "overlap", message: `Text overlaps near “${words[a].text}” — a stamp or handwriting over print? Check this area.`, box: union([words[a].box, words[b].box]) });
        b = words.length;
      }
    }
    if (issues.filter((i) => i.kind === "overlap").length >= 5) break;
  }
  const unclear = words.filter((w) => w.confidence < LOW_CONFIDENCE);
  if (unclear.length) {
    issues.push({ kind: "low-confidence", message: `${unclear.length} word${unclear.length === 1 ? " was" : "s were"} hard to read.`, box: union(unclear.map((w) => w.box)) });
  }

  return { headings, text: ordered, keyValues, tables, checkboxes, columns: gutter === null ? 1 : 2, issues };
}

/**
 * Phrases on the page: words grouped along each line and split at wide gaps
 * ("Juan Dela Cruz", "Poblacion"). What a reviewer can tap to fill a field.
 */
export function phrases(lines: OcrLine[]): LayoutText[] {
  let nextId = 0;
  const words: Word[] = lines.flatMap((line) => line.words.map((w) => ({ ...w, id: nextId++ })));
  if (words.length === 0) return [];
  const lineHeight = Math.max(8, median(words.map((w) => w.box.height)));
  return groupRows(words, lineHeight).flatMap((row) => chunksOf(row, lineHeight, []).map((c) => ({ text: c.text, box: c.box, confidence: meanConfidence(c.words) })));
}

/**
 * Rebuilds a table from the words inside a region the reviewer drew around
 * it (when detection missed it or got its edges wrong). Columns come from
 * text alignment; with a single column, each line is a row.
 */
export function tableFromRegion(lines: OcrLine[], region: Box, pageWidth: number): LayoutTable | null {
  let nextId = 0;
  const words: Word[] = lines.flatMap((line) => line.words.map((w) => ({ ...w, id: nextId++ }))).filter((w) => containsPoint(region, centerX(w.box), centerY(w.box)));
  if (words.length === 0) return null;
  const lineHeight = Math.max(8, median(words.map((w) => w.box.height)));
  const rows = groupRows(words, lineHeight).map((row) => ({ row, chunks: chunksOf(row, lineHeight, []) }));
  const table = alignedTable(rows, lineHeight, "drawn", pageWidth * 10);
  if (table) return { ...table, box: region };
  return {
    id: "drawn",
    box: region,
    source: "aligned",
    columns: [{ x0: region.x, x1: region.x + region.width }],
    rows: rows.map(({ row }) => ({ box: row.box, cells: [{ text: joinWords(row.words), box: row.box, confidence: meanConfidence(row.words), unclear: unclearOf(row.words) }] })),
    headerRows: 0,
  };
}
