/**
 * OCR Test Fixtures
 * Builds synthetic OCR output for layout and mapping tests: words laid out
 * on a page at given positions (10 px per character, 20 px tall), grouped
 * into lines, plus helpers for ruling lines and checkbox marks — so tests
 * describe a page by where its text sits instead of running real OCR.
 */

import type { Box, CheckboxMark, OcrLine, OcrPageResult, OcrWord, PageMarks } from "@/types/ocr";

export const CHAR = 10;
export const HEIGHT = 20;
const SPACE = 8;

/** Words of `text` starting at x, on the row at y. `confidence` applies to every word. */
export function words(x: number, y: number, text: string, confidence = 92): OcrWord[] {
  const out: OcrWord[] = [];
  let cursor = x;
  for (const word of text.split(" ").filter(Boolean)) {
    out.push({ text: word, confidence, box: { x: cursor, y, width: word.length * CHAR, height: HEIGHT }, unclear: "" });
    cursor += word.length * CHAR + SPACE;
  }
  return out;
}

/** One OCR line made of segments placed at their own x positions on row y. */
export function line(y: number, segments: [number, string, number?][], block = 0): OcrLine {
  const ws = segments.flatMap(([x, text, confidence]) => words(x, y, text, confidence));
  const x0 = Math.min(...ws.map((w) => w.box.x));
  const x1 = Math.max(...ws.map((w) => w.box.x + w.box.width));
  return { text: ws.map((w) => w.text).join(" "), confidence: ws.reduce((s, w) => s + w.confidence, 0) / ws.length, box: { x: x0, y, width: x1 - x0, height: HEIGHT }, words: ws, block };
}

export function emptyMarks(patch: Partial<PageMarks> = {}): PageMarks {
  return { horizontal: [], vertical: [], checkboxes: [], inkRatio: 0.05, skew: 0, sideways: false, ...patch };
}

export const hLine = (x: number, y: number, width: number): Box => ({ x, y, width, height: 2 });
export const vLine = (x: number, y: number, height: number): Box => ({ x, y, width: 2, height });
export const checkbox = (x: number, y: number, state: CheckboxMark["state"]): CheckboxMark => ({ box: { x, y, width: 18, height: 18 }, fill: state === "checked" ? 0.3 : state === "unclear" ? 0.06 : 0, state });

export function pageResult(lines: OcrLine[], patch: Partial<OcrPageResult> = {}): OcrPageResult {
  const all = lines.flatMap((l) => l.words);
  return {
    engine: "test",
    profile: "standard",
    languages: ["eng"],
    width: 1000,
    height: 1400,
    lines,
    text: lines.map((l) => l.text).join("\n"),
    confidence: all.length ? all.reduce((s, w) => s + w.confidence, 0) / all.length : 0,
    status: all.length ? "ok" : "blank",
    autoRotated: 0,
    durationMs: 1,
    ...patch,
  };
}
