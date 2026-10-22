/**
 * Census Sheet Layout (CVO-CENSUS v1)
 * Where everything sits on the printed Dog & Cat working sheet, in
 * millimetres on long bond paper (216 × 330 mm). Printing draws from it and
 * scanning reads from it, so the two always agree: four corner markers to
 * find and straighten the page, the code strip (barangay, date, sheet
 * number), letter boxes for handwriting, and well-spaced tick boxes and
 * number bubbles that are read by how much ink is inside them. One owner
 * and three pets per sheet; a continuation sheet carries pets 4–6. Never
 * move anything within a version — print a new version instead.
 */

import { CODE_BITS } from "@/core/census/code-strip";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Printed words that aren't read back (captions, option names). */
export interface Caption {
  x: number;
  y: number;
  text: string;
  size: number;
  bold?: boolean;
  anchor?: "start" | "middle" | "end";
}

/** A row (or rows) of letter boxes, one capital letter or digit per box. */
export interface WriteIn {
  key: string;
  label: string;
  rows: Rect[][];
  digits?: boolean;
}

/** Tick boxes where exactly one answer is expected. */
export interface ChoiceGroup {
  key: string;
  label: string;
  options: { value: string; box: Rect }[];
}

/** A number filled in as bubbles: one row per decimal place, value = base + Σ weight × filled position. */
export interface NumberGroup {
  key: string;
  label: string;
  base: number;
  places: { weight: number; bubbles: Rect[] }[];
}

export interface PetBlock {
  slot: number;
  frame: Rect;
  /** Where "C. PET RECORD n" goes (n is 1–3, or 4–6 on a continuation sheet). */
  titleAt: { x: number; y: number };
  notApplicable: Rect;
  writeIns: WriteIn[];
  choices: ChoiceGroup[];
  numbers: NumberGroup[];
}

export interface CensusLayout {
  page: { width: number; height: number };
  markers: Rect[];
  /** Centre of each marker, TL, TR, BR, BL — what the scanner aligns to. */
  markerCentres: { x: number; y: number }[];
  /** The marker with a white centre (orientation). */
  hollowMarker: Rect;
  code: Rect[];
  owner: WriteIn[];
  continuedFrom: NumberGroup;
  pets: PetBlock[];
  captions: Caption[];
  /** Words of the owner block (main sheets only; continuation sheets print continuationCaptions instead). */
  ownerCaptions: Caption[];
  /** Thin guide boxes around sections (printing only). */
  frames: Rect[];
}

export const PAGE = { width: 216, height: 330 };
const MARKER = 9;
const MARKER_INSET = 8;
const LEFT = 15;
const RIGHT = PAGE.width - 15;
const CELL_W = 6.2;
const CELL_H = 6.5;
export const BOX = 4.5;
const BUBBLE = 3.8;
const BUBBLE_PITCH = 5.2;
const CAPTION = 2.3;
const OPTION = 2.5;
const PET_HEIGHT = 70;
const PET_GAP = 1.5;

/** Approximate width of capital text in mm (Inter semibold), so option labels never collide. */
export const textWidth = (text: string, size: number) => text.length * size * 0.64;

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function cellRow(x: number, y: number, count: number, gapsAfter: number[] = []): Rect[] {
  const cells: Rect[] = [];
  let at = x;
  for (let i = 0; i < count; i++) {
    cells.push(rect(at, y, CELL_W, CELL_H));
    at += CELL_W + (gapsAfter.includes(i) ? 3 : 0);
  }
  return cells;
}

function writeIn(captions: Caption[], key: string, label: string, x: number, y: number, count: number, lines = 1, digits = false): WriteIn {
  captions.push({ x, y: y - 0.9, text: label, size: CAPTION, bold: true });
  const rows = Array.from({ length: lines }, (_, i) => cellRow(x, y + i * (CELL_H + 1), count, digits && count === 11 ? [3, 6] : []));
  return { key, label, rows, digits };
}

/** Tick boxes laid left to right with their names; returns where the next group may start. */
function choices(captions: Caption[], key: string, label: string, x: number, y: number, values: string[]): [ChoiceGroup, number] {
  captions.push({ x, y: y - 0.9, text: label, size: CAPTION, bold: true });
  let at = x;
  const options = values.map((value) => {
    const box = rect(at, y, BOX, BOX);
    captions.push({ x: at + BOX + 1.2, y: y + BOX - 1, text: value, size: OPTION });
    at += BOX + 1.2 + textWidth(value, OPTION) + 4;
    return { value, box };
  });
  return [{ key, label, options }, at + 3];
}

/** Bubble rows for a number, with each bubble's digit printed above it (not inside: ink inside would read as a mark). */
function bubbles(captions: Caption[], x: number, y: number, count: number, first = 0): Rect[] {
  return Array.from({ length: count }, (_, i) => {
    const bx = x + i * BUBBLE_PITCH;
    captions.push({ x: bx + BUBBLE / 2, y: y - 0.5, text: String(first + i), size: 1.9, anchor: "middle" });
    return rect(bx, y, BUBBLE, BUBBLE);
  });
}

function petBlock(slot: number, top: number, captions: Caption[], frames: Rect[]): PetBlock {
  frames.push(rect(LEFT - 2, top, RIGHT - LEFT + 4, PET_HEIGHT));
  const notApplicable = rect(RIGHT - 52, top + 0.9, BOX, BOX);
  captions.push({ x: notApplicable.x + BOX + 1.2, y: top + 4.4, text: "N/A — NO PET IN THIS SLOT", size: OPTION });

  const writeIns = [writeIn(captions, "pet_name", "NAME OF PET", LEFT, top + 9, 30)];

  // Age: years (tens 0–3, ones 0–9) and months (0–11).
  const ageY = top + 20.5;
  captions.push({ x: LEFT, y: ageY - 2.9, text: "AGE — YEARS", size: CAPTION, bold: true });
  const tens = bubbles(captions, LEFT, ageY, 4);
  const ones = bubbles(captions, LEFT + 4 * BUBBLE_PITCH + 3, ageY, 10);
  const monthsX = LEFT + 14 * BUBBLE_PITCH + 12;
  captions.push({ x: monthsX, y: ageY - 2.9, text: "AGE — MONTHS", size: CAPTION, bold: true });
  const months = bubbles(captions, monthsX, ageY, 12);
  const numbers: NumberGroup[] = [
    { key: "age_years", label: "Age (years)", base: 0, places: [{ weight: 10, bubbles: tens }, { weight: 1, bubbles: ones }] },
    { key: "age_months", label: "Age (months)", base: 0, places: [{ weight: 1, bubbles: months }] },
  ];

  const groups: ChoiceGroup[] = [];
  const line = (y: number, specs: [string, string, string[]][]) => {
    let x = LEFT;
    for (const [key, label, values] of specs) {
      const [group, next] = choices(captions, key, label, x, y, values);
      groups.push(group);
      x = next;
    }
    if (x - 3 > RIGHT) throw new Error(`Census layout: line at ${y} mm is too wide.`);
  };
  line(top + 28, [
    ["type", "TYPE OF PET", ["DOG", "CAT"]],
    ["sex", "SEX", ["MALE", "FEMALE"]],
    ["sterilized", "STERILIZED", ["YES", "NO", "UNKNOWN"]],
  ]);
  line(top + 36.5, [
    ["breed", "BREED", ["MONGREL MIX", "MIX", "PURE", "UNKNOWN"]],
    ["classification", "CLASSIFICATION", ["CONFINED", "SEMI-CONFINED", "FREE ROAMING"]],
  ]);
  line(top + 45, [
    ["vaccination", "VACCINATION STATUS", ["1ST", "2ND", "3RD", "BOOSTER", "NONE", "UNKNOWN"]],
    ["laps", "LAPS (SKIPPED A VACCINE)", ["YES", "NO", "UNKNOWN"]],
  ]);

  // Registered In: 20__ as two bubble rows side by side.
  const regY = top + 55;
  captions.push({ x: LEFT, y: regY - 2.9, text: "REGISTERED IN (YEAR)", size: CAPTION, bold: true });
  captions.push({ x: LEFT, y: regY + 3.3, text: "20", size: 3.4, bold: true });
  const regTens = bubbles(captions, LEFT + 6, regY, 10);
  const regOnes = bubbles(captions, LEFT + 6 + 10 * BUBBLE_PITCH + 3, regY, 10);
  numbers.push({ key: "registered", label: "Registered in", base: 2000, places: [{ weight: 10, bubbles: regTens }, { weight: 1, bubbles: regOnes }] });

  writeIns.push(writeIn(captions, "color", "COLOR", RIGHT - 11 * CELL_W, top + 53.3, 11));
  writeIns.push(writeIn(captions, "other_vaccines", "OTHER VACCINES", LEFT, top + 63.3, 12));
  writeIns.push(writeIn(captions, "remarks", "REMARKS", RIGHT - 17 * CELL_W, top + 63.3, 17));

  return { slot, frame: rect(LEFT - 2, top, RIGHT - LEFT + 4, PET_HEIGHT), titleAt: { x: LEFT, y: top + 3.8 }, notApplicable, writeIns, choices: groups, numbers };
}

export function buildCensusLayout(): CensusLayout {
  const captions: Caption[] = [];
  const frames: Rect[] = [];
  const near = MARKER_INSET;
  const far = (size: number) => size - MARKER_INSET - MARKER;
  const markers = [rect(near, near, MARKER, MARKER), rect(far(PAGE.width), near, MARKER, MARKER), rect(far(PAGE.width), far(PAGE.height), MARKER, MARKER), rect(near, far(PAGE.height), MARKER, MARKER)];
  const pitch = 3.2;
  const codeX = (PAGE.width - CODE_BITS * pitch + 0.7) / 2;
  const code = Array.from({ length: CODE_BITS }, (_, i) => rect(codeX + i * pitch, 28, 2.5, 2.5));

  frames.push(rect(LEFT - 2, 36.5, RIGHT - LEFT + 4, 10));
  frames.push(rect(LEFT - 2, 48, RIGHT - LEFT + 4, 41));
  captions.push({ x: RIGHT, y: 52.3 - 1.6, text: "USE CAPITAL LETTERS · ONE LETTER PER BOX · TICK ✓ OR FILL ● ONE BOX", size: 2.1, anchor: "end" });
  const ownerCaptions: Caption[] = [{ x: LEFT, y: 52.3 - 1.6, text: "B. OWNER INFORMATION", size: 3, bold: true }];
  const owner = [
    writeIn(ownerCaptions, "owner_name", "FULL NAME OF OWNER", LEFT, 55, 30),
    writeIn(ownerCaptions, "address", "COMPLETE ADDRESS", LEFT, 64.5, 30, 2),
    writeIn(ownerCaptions, "contact", "CONTACT NUMBER (0000-000-0000)", LEFT, 81, 11, 1, true),
  ];

  // Continuation sheets print this in the owner block instead.
  const continuedFrom: NumberGroup = {
    key: "continued_from",
    label: "Continued from sheet no.",
    base: 0,
    places: [1000, 100, 10, 1].map((weight, i) => ({ weight, bubbles: bubbles([], LEFT + 40, 58 + i * 7.5, 10) })),
  };

  const pets = [0, 1, 2].map((slot) => petBlock(slot, 91 + slot * (PET_HEIGHT + PET_GAP), captions, frames));

  return {
    page: PAGE,
    markers,
    markerCentres: markers.map((m) => ({ x: m.x + MARKER / 2, y: m.y + MARKER / 2 })),
    hollowMarker: rect(near + 3, near + 3, 3, 3),
    code,
    owner,
    continuedFrom,
    pets,
    captions,
    ownerCaptions,
    frames,
  };
}

export const CENSUS_LAYOUT = buildCensusLayout();

/** Captions for the continuation sheet's "Continued from sheet no." bubbles (digits above each bubble). */
export function continuationCaptions(layout: CensusLayout): Caption[] {
  const captions: Caption[] = [
    { x: LEFT, y: 52.3 - 1.6, text: "B. CONTINUATION SHEET — PETS 4 TO 6 OF THE SAME OWNER", size: 3, bold: true },
    { x: LEFT, y: 54.5, text: "CONTINUED FROM SHEET NO.", size: CAPTION, bold: true },
  ];
  layout.continuedFrom.places.forEach((place, i) => {
    captions.push({ x: LEFT, y: place.bubbles[0].y + 3, text: ["THOUSANDS", "HUNDREDS", "TENS", "ONES"][i], size: 2 });
    place.bubbles.forEach((b, d) => captions.push({ x: b.x + BUBBLE / 2, y: b.y - 0.5, text: String(d), size: 1.9, anchor: "middle" }));
  });
  return captions;
}
