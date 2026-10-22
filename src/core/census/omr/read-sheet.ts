/**
 * Census Sheet Reader (OMR)
 * Reads a photo of a printed census sheet without any AI model: finds the
 * corner markers, flattens the page to the layout's exact size (so every box
 * is where the layout says), decodes the code strip, then measures the ink
 * inside each tick box and number bubble. Exactly one mark answers a
 * question; none means unanswered; two or more, or a faint smudge, is left
 * for the reviewer. It also notes which letter boxes hold writing (to place
 * spaces between words) and makes a copy with only the letter boxes' insides
 * — the handwriting — for text recognition.
 */

import { CENSUS_LAYOUT, layoutFor, PAGE, type CensusLayout, type NumberGroup, type Rect, type WriteIn } from "@/core/census/census-layout";
import { decodeSheetCode, type SheetCode } from "@/core/census/code-strip";
import { findCornerMarkers } from "@/core/census/omr/find-markers";
import { CHECKED_FILL, EMPTY_FILL, inkInBox } from "@/core/ocr/imaging/analysis";
import { createGray, homography, inkMask, resizeGray, warpPerspective, type GrayImage } from "@/core/ocr/imaging/pixels";
import type { Point } from "@/types/ocr";

/** Pixels per millimetre of the flattened sheet (1728 × 2640 px). */
export const SHEET_SCALE = 8;

export type MarkState = "checked" | "unchecked" | "unclear";

export interface AnswerRead {
  /** The one marked option (or number), `null` when unanswered or unclear. */
  value: string | null;
  state: "answered" | "unanswered" | "multiple" | "unclear";
  /** The marked options, when several are. */
  marked: string[];
  /** Where on the flattened sheet, in mm. */
  box: Rect;
}

export interface CensusSheetRead {
  code: SheetCode;
  /** Keyed `owner.<key>` / `pet<slot>.<key>`. */
  answers: Record<string, AnswerRead>;
  /** Which letter boxes hold writing, per row, keyed like answers. */
  inked: Record<string, boolean[][]>;
  /** The same letter boxes where they actually are on the flattened sheet (mm), lined up on their printed lines. */
  cells: Record<string, Rect[][]>;
  /** Open writing lines: where the writing is along each line, and the gaps between its words (mm, sheet x). */
  writing?: Record<string, ({ from: number; to: number; gaps: number[] } | null)[]>;
  /** Pet slots marked "N/A — no pet in this slot". */
  emptySlots: boolean[];
}

const DETECT_SIDE = 1600;

/** The inner part of a box (in mm) as sheet pixels, leaving the printed outline out. */
function inner(box: Rect, inset: number): Rect {
  const dx = box.width * inset;
  const dy = box.height * inset;
  return { x: (box.x + dx) * SHEET_SCALE, y: (box.y + dy) * SHEET_SCALE, width: (box.width - 2 * dx) * SHEET_SCALE, height: (box.height - 2 * dy) * SHEET_SCALE };
}

const markState = (fill: number): MarkState => (fill >= CHECKED_FILL ? "checked" : fill <= EMPTY_FILL ? "unchecked" : "unclear");

const union = (boxes: Rect[]): Rect => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
};

// Printers, scanner apps and paper curl can shift a square by up to a millimetre from where the corners put it.
const NUDGES = [-1, -0.5, 0, 0.5, 1];

/** How filled a code square is, at the best nearby position (squares are 0.7 mm apart, so a neighbour never reaches in). */
function codeSquareFill(mask: Uint8Array, width: number, box: Rect) {
  let best = 0;
  for (const dx of NUDGES) for (const dy of NUDGES) best = Math.max(best, inkInBox(mask, width, inner({ ...box, x: box.x + dx, y: box.y + dy }, 0.1)));
  return best;
}

/** Points (mm) along a box's printed outline: its square edge, or its circle for bubbles. */
function outline(box: Rect, round: boolean) {
  const points: { x: number; y: number }[] = [];
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let i = 0; i < 32; i++) {
    const t = i / 32;
    if (round) points.push({ x: cx + (Math.cos(t * 2 * Math.PI) * box.width) / 2, y: cy + (Math.sin(t * 2 * Math.PI) * box.height) / 2 });
    else {
      const side = Math.floor(t * 4);
      const f = t * 4 - side;
      points.push([{ x: box.x + f * box.width, y: box.y }, { x: box.x + box.width, y: box.y + f * box.height }, { x: box.x + (1 - f) * box.width, y: box.y + box.height }, { x: box.x, y: box.y + (1 - f) * box.height }][side]);
    }
  }
  return points;
}

/**
 * The small shift (mm) that best lines a row of boxes up with their printed
 * outlines, so each mark is measured inside its own box and not on its
 * neighbour's edge.
 */
function alignment(mask: Uint8Array, width: number, boxes: Rect[], round: boolean) {
  const reach = 1.2;
  const height = mask.length / width;
  const points = boxes.flatMap((b) => outline(b, round));
  const inkAt = (x: number, y: number) => {
    const px = Math.round(x * SHEET_SCALE);
    const py = Math.round(y * SHEET_SCALE);
    return px >= 0 && py >= 0 && px < width && py < height ? mask[py * width + px] : 0;
  };
  let best = { dx: 0, dy: 0, score: -1 };
  for (let dx = -reach; dx <= reach + 0.0001; dx += 0.2) {
    for (let dy = -reach; dy <= reach + 0.0001; dy += 0.2) {
      let score = 0;
      for (const p of points) score += inkAt(p.x + dx, p.y + dy);
      // Ties go to the smaller shift.
      if (score > best.score || (score === best.score && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy))) best = { dx, dy, score };
    }
  }
  return best;
}

function answer(mask: Uint8Array, width: number, options: { value: string; box: Rect }[], round = false): AnswerRead {
  const { dx, dy } = alignment(mask, width, options.map((o) => o.box), round);
  // A bubble's inner square reaches close to its circle, so measure a smaller middle.
  const states = options.map((o) => markState(inkInBox(mask, width, inner({ ...o.box, x: o.box.x + dx, y: o.box.y + dy }, round ? 0.3 : 0.2))));
  const marked = options.filter((_, i) => states[i] === "checked").map((o) => o.value);
  const box = union(options.map((o) => o.box));
  if (marked.length > 1) return { value: null, state: "multiple", marked, box };
  if (states.includes("unclear")) return { value: null, state: "unclear", marked, box };
  if (marked.length === 0) return { value: null, state: "unanswered", marked, box };
  return { value: marked[0], state: "answered", marked, box };
}

function numberAnswer(mask: Uint8Array, width: number, group: NumberGroup): AnswerRead {
  const places = group.places.map((place) => answer(mask, width, place.bubbles.map((box, digit) => ({ value: String(digit), box })), true));
  const box = union(group.places.flatMap((p) => p.bubbles));
  const marked = places.flatMap((p) => p.marked);
  const worst = places.find((p) => p.state === "multiple") ?? places.find((p) => p.state === "unclear");
  if (worst) return { ...worst, value: null, marked, box };
  // Nothing filled at all: unanswered. Leading places left empty count as 0 (e.g. age 7 = only the ones row).
  if (places.every((p) => p.state === "unanswered")) return { value: null, state: "unanswered", marked, box };
  const value = group.places.reduce((sum, place, i) => sum + place.weight * Number(places[i].value ?? 0), group.base);
  return { value: String(value), state: "answered", marked, box };
}

/** A row of letter boxes moved onto its printed lines. */
function alignedRow(mask: Uint8Array, width: number, row: Rect[]) {
  const { dx, dy } = alignment(mask, width, row, false);
  return row.map((cell) => ({ ...cell, x: cell.x + dx, y: cell.y + dy }));
}

/** A box shrunk by `mm` on every side, as sheet pixels. */
function insetMm(box: Rect, mm: number): Rect {
  return { x: (box.x + mm) * SHEET_SCALE, y: (box.y + mm) * SHEET_SCALE, width: (box.width - 2 * mm) * SHEET_SCALE, height: (box.height - 2 * mm) * SHEET_SCALE };
}

function letterCells(mask: Uint8Array, width: number, field: WriteIn) {
  const cells = field.rows.map((row) => alignedRow(mask, width, row));
  // Letter boxes: the middle half only — letters cross it, while a box line a slight tilt brings closer stays outside.
  // Open lines: everything a millimetre inside the line's box; even a short word inks a small share of a long line.
  const written = (cell: Rect) => (field.open ? inkInBox(mask, width, insetMm(cell, 1)) > 0.004 : inkInBox(mask, width, inner(cell, 0.25)) > 0.03);
  return { cells, inked: cells.map((row) => row.map(written)) };
}

/** Word gaps on an open line: never narrower than this (mm)… */
export const WORD_GAP_MM = 2;
/** …and always a word gap from this width (mm) on, however widely the writer spaces letters. */
const SURE_WORD_GAP_MM = 3.5;

/**
 * Where the writing on an open line is: the first and last inked column, and
 * the middle of every ink-free gap wide enough to be a space between words
 * (handwriting readers often miss spaces; the gaps put them back). "Wide
 * enough" follows the writer: clearly wider than their usual gap between
 * letters (1.7 × the median gap), between WORD_GAP_MM and SURE_WORD_GAP_MM.
 */
function writingSpan(mask: Uint8Array, width: number, line: Rect) {
  const r = insetMm(line, 1);
  const x0 = Math.round(r.x);
  const x1 = Math.round(r.x + r.width);
  const y0 = Math.round(r.y);
  const y1 = Math.round(r.y + r.height);
  const inked: boolean[] = [];
  for (let x = x0; x < x1; x++) {
    let n = 0;
    for (let y = y0; y < y1; y++) n += mask[y * width + x];
    inked.push(n > 0);
  }
  const first = inked.indexOf(true);
  if (first < 0) return null;
  const last = inked.lastIndexOf(true);
  const blanks: { at: number; width: number }[] = [];
  let gapStart = -1;
  for (let i = first; i <= last; i++) {
    if (!inked[i] && gapStart < 0) gapStart = i;
    if (inked[i] && gapStart >= 0) {
      blanks.push({ at: (x0 + (gapStart + i) / 2) / SHEET_SCALE, width: (i - gapStart) / SHEET_SCALE });
      gapStart = -1;
    }
  }
  const widths = blanks.map((b) => b.width).sort((a, b) => a - b);
  const median = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  const wordGap = Math.max(WORD_GAP_MM, Math.min(SURE_WORD_GAP_MM, 1.7 * median));
  return { from: (x0 + first) / SHEET_SCALE, to: (x0 + last + 1) / SHEET_SCALE, gaps: blanks.filter((b) => b.width >= wordGap).map((b) => b.at) };
}

/**
 * Reads the answers from a flattened sheet (SHEET_SCALE px per mm), with the
 * layout of the version its code strip names. `null` when the strip isn't valid.
 */
export function readFlatSheet(sheet: GrayImage): CensusSheetRead | null {
  const mask = inkMask(sheet);
  const { width } = sheet;
  // The code strip is in the same place in every version.
  const bits = CENSUS_LAYOUT.code.map((box) => (codeSquareFill(mask, width, box) > 0.5 ? 1 : 0));
  const code = decodeSheetCode(bits);
  if (!code) return null;
  const layout = layoutFor(code.version);

  const answers: Record<string, AnswerRead> = {};
  const inked: Record<string, boolean[][]> = {};
  const cells: Record<string, Rect[][]> = {};
  const writing: Record<string, ({ from: number; to: number; gaps: number[] } | null)[]> = {};
  const letters = (key: string, field: WriteIn) => {
    const found = letterCells(mask, width, field);
    inked[key] = found.inked;
    cells[key] = found.cells;
    if (field.open) writing[key] = found.cells.map((row, r) => (found.inked[r][0] ? writingSpan(mask, width, row[0]) : null));
  };
  if (code.continuation) answers["owner.continued_from"] = numberAnswer(mask, width, layout.continuedFrom);
  else for (const field of layout.owner) letters(`owner.${field.key}`, field);
  const emptySlots = layout.pets.map((pet) => answer(mask, width, [{ value: "N/A", box: pet.notApplicable }]).state === "answered");
  for (const pet of layout.pets) {
    const prefix = `pet${pet.slot}`;
    for (const group of pet.choices) answers[`${prefix}.${group.key}`] = answer(mask, width, group.options);
    for (const group of pet.numbers) answers[`${prefix}.${group.key}`] = numberAnswer(mask, width, group);
    for (const field of pet.writeIns) letters(`${prefix}.${field.key}`, field);
  }
  return { code, answers, inked, cells, writing, emptySlots };
}

/** The four sheet-corner orders to try: the hollow marker's first, then the others. */
function cornerOrders(hollow: boolean[]): number[] {
  const first = hollow.filter(Boolean).length === 1 ? hollow.indexOf(true) : 0;
  return [0, 1, 2, 3].map((k) => (first + k) % 4);
}

/**
 * Finds the sheet in a photo and flattens it to the layout's size. Tries the
 * hollow-marker orientation first and keeps the first whose code strip is
 * valid, so a sideways or upside-down photo still reads.
 */
export function locateAndRead(photo: GrayImage, layout: CensusLayout = CENSUS_LAYOUT): { sheet: GrayImage; read: CensusSheetRead } | null {
  const scale = Math.min(1, DETECT_SIDE / Math.max(photo.width, photo.height));
  const small = scale < 1 ? resizeGray(photo, Math.round(photo.width * scale), Math.round(photo.height * scale)) : photo;
  const markers = findCornerMarkers(small);
  if (!markers) return null;
  const centres = markers.map((m) => ({ x: m.centre.x / scale, y: m.centre.y / scale }));
  for (const start of cornerOrders(markers.map((m) => m.hollow))) {
    const quad = [0, 1, 2, 3].map((k) => centres[(start + k) % 4]) as [Point, Point, Point, Point];
    const sheet = flatten(photo, quad, layout);
    const read = readFlatSheet(sheet);
    if (read) return { sheet, read };
  }
  return null;
}

/** Warps the photo so the marker centres land where the layout puts them, covering the whole page. */
export function flatten(photo: GrayImage, markerQuad: [Point, Point, Point, Point], layout: CensusLayout = CENSUS_LAYOUT): GrayImage {
  const [tl, , br] = layout.markerCentres;
  const w = (br.x - tl.x) * SHEET_SCALE;
  const h = (br.y - tl.y) * SHEET_SCALE;
  const m = homography(markerQuad, w, h);
  const at = (u: number, v: number): Point => {
    const d = m[6] * u + m[7] * v + m[8];
    return { x: (m[0] * u + m[1] * v + m[2]) / d, y: (m[3] * u + m[4] * v + m[5]) / d };
  };
  const left = -tl.x * SHEET_SCALE;
  const top = -tl.y * SHEET_SCALE;
  const right = left + PAGE.width * SHEET_SCALE;
  const bottom = top + PAGE.height * SHEET_SCALE;
  const pageQuad: [Point, Point, Point, Point] = [at(left, top), at(right, top), at(right, bottom), at(left, bottom)];
  return warpPerspective(photo, pageQuad, PAGE.width * SHEET_SCALE, PAGE.height * SHEET_SCALE);
}

/** Where a letter box's writing is, in sheet pixels (inside its printed lines). */
export const letterArea = (cell: Rect) => insetMm(cell, 0.75);

/** A white page with only the letter boxes' insides copied over: the handwriting, without printed words or box lines. */
export function handwritingOnly(sheet: GrayImage, read: CensusSheetRead): GrayImage {
  const out = createGray(sheet.width, sheet.height);
  for (const cell of Object.values(read.cells).flat(2)) {
    const r = letterArea(cell);
    for (let y = Math.round(r.y); y < Math.round(r.y + r.height); y++) {
      const row = y * sheet.width;
      out.data.set(sheet.data.subarray(row + Math.round(r.x), row + Math.round(r.x + r.width)), row + Math.round(r.x));
    }
  }
  return out;
}
