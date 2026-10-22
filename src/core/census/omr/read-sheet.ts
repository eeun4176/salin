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

import { CENSUS_LAYOUT, PAGE, type CensusLayout, type NumberGroup, type Rect, type WriteIn } from "@/core/census/census-layout";
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

function answer(mask: Uint8Array, width: number, options: { value: string; box: Rect }[]): AnswerRead {
  const states = options.map((o) => markState(inkInBox(mask, width, inner(o.box, 0.2))));
  const marked = options.filter((_, i) => states[i] === "checked").map((o) => o.value);
  const box = union(options.map((o) => o.box));
  if (marked.length > 1) return { value: null, state: "multiple", marked, box };
  if (states.includes("unclear")) return { value: null, state: "unclear", marked, box };
  if (marked.length === 0) return { value: null, state: "unanswered", marked, box };
  return { value: marked[0], state: "answered", marked, box };
}

function numberAnswer(mask: Uint8Array, width: number, group: NumberGroup): AnswerRead {
  const places = group.places.map((place) => answer(mask, width, place.bubbles.map((box, digit) => ({ value: String(digit), box }))));
  const box = union(group.places.flatMap((p) => p.bubbles));
  const marked = places.flatMap((p) => p.marked);
  const worst = places.find((p) => p.state === "multiple") ?? places.find((p) => p.state === "unclear");
  if (worst) return { ...worst, value: null, marked, box };
  // Nothing filled at all: unanswered. Leading places left empty count as 0 (e.g. age 7 = only the ones row).
  if (places.every((p) => p.state === "unanswered")) return { value: null, state: "unanswered", marked, box };
  const value = group.places.reduce((sum, place, i) => sum + place.weight * Number(places[i].value ?? 0), group.base);
  return { value: String(value), state: "answered", marked, box };
}

function inkedCells(mask: Uint8Array, width: number, field: WriteIn) {
  return field.rows.map((row) => row.map((cell) => inkInBox(mask, width, inner(cell, 0.15)) > 0.03));
}

/** Reads the answers from a flattened sheet (SHEET_SCALE px per mm). `null` when its code strip isn't valid. */
export function readFlatSheet(sheet: GrayImage, layout: CensusLayout = CENSUS_LAYOUT): CensusSheetRead | null {
  const mask = inkMask(sheet);
  const { width } = sheet;
  const bits = layout.code.map((box) => (inkInBox(mask, width, inner(box, 0.25)) > 0.5 ? 1 : 0));
  const code = decodeSheetCode(bits);
  if (!code) return null;

  const answers: Record<string, AnswerRead> = {};
  const inked: Record<string, boolean[][]> = {};
  if (code.continuation) answers["owner.continued_from"] = numberAnswer(mask, width, layout.continuedFrom);
  else for (const field of layout.owner) inked[`owner.${field.key}`] = inkedCells(mask, width, field);
  const emptySlots = layout.pets.map((pet) => markState(inkInBox(mask, width, inner(pet.notApplicable, 0.2))) === "checked");
  for (const pet of layout.pets) {
    const prefix = `pet${pet.slot}`;
    for (const group of pet.choices) answers[`${prefix}.${group.key}`] = answer(mask, width, group.options);
    for (const group of pet.numbers) answers[`${prefix}.${group.key}`] = numberAnswer(mask, width, group);
    for (const field of pet.writeIns) inked[`${prefix}.${field.key}`] = inkedCells(mask, width, field);
  }
  return { code, answers, inked, emptySlots };
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
    const read = readFlatSheet(sheet, layout);
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

/** Every letter box of the layout (main sheets: owner and pets; continuation sheets: pets only). */
export function letterBoxes(continuation: boolean, layout: CensusLayout = CENSUS_LAYOUT): WriteIn[] {
  return [...(continuation ? [] : layout.owner), ...layout.pets.flatMap((p) => p.writeIns)];
}

/** A white page with only the letter boxes' insides copied over: the handwriting, without printed words or box lines. */
export function handwritingOnly(sheet: GrayImage, continuation: boolean, layout: CensusLayout = CENSUS_LAYOUT): GrayImage {
  const out = createGray(sheet.width, sheet.height);
  for (const field of letterBoxes(continuation, layout)) {
    for (const cell of field.rows.flat()) {
      const r = inner(cell, 0.1);
      for (let y = Math.round(r.y); y < Math.round(r.y + r.height); y++) {
        const row = y * sheet.width;
        out.data.set(sheet.data.subarray(row + Math.round(r.x), row + Math.round(r.x + r.width)), row + Math.round(r.x));
      }
    }
  }
  return out;
}
