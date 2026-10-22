/**
 * Census Sheet Layouts (CVO-CENSUS v1, v2 and v3)
 * Where everything sits on the printed Dog & Cat working sheet, in
 * millimetres on long bond paper (216 × 330 mm). Printing draws from it and
 * scanning reads from it, so the two always agree: four corner markers to
 * find and straighten the page, the code strip (barangay, date, sheet
 * number, form version), handwriting fields, and well-spaced tick boxes and
 * number bubbles that are read by how much ink is inside them. One owner
 * and three pets per sheet; a continuation sheet carries pets 4–6.
 *
 * v1 uses one letter box per character everywhere. v2 keeps boxes only for
 * the contact number; names, address and remarks are open writing lines,
 * Color is tick boxes, age is one row of bubbles and Registered In is a row
 * of years. v3 (printed now) keeps the v2 fields with a one-line address and
 * lays the pet record out as a grid: every category in its own cell, tick
 * boxes in the same columns from row to row. Markers and the code strip sit
 * in the same place in every version, so any sheet says which layout it uses.
 * Never move anything within a version — add a new version instead.
 */

import { CODE_BITS, FORM_VERSION, SUPPORTED_VERSIONS } from "@/core/census/code-strip";

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

/**
 * Handwriting: rows of letter boxes (one capital letter or digit per box),
 * or open writing lines (`open`: each row is a single box spanning the line).
 */
export interface WriteIn {
  key: string;
  label: string;
  rows: Rect[][];
  digits?: boolean;
  open?: boolean;
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
  /** Thin lines between cells (printing only): Rects with no width or no height. */
  rules: Rect[];
}

export const PAGE = { width: 216, height: 330 };
/** Registered In on v2: option values that stand for years counted back from the census year. */
export const YEAR_OPTION = /^YEAR-(\d)$/;
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
const PET_HEIGHT_V2 = 72;
const LINE_H = 6.5;
const PET_GAP = 1.5;
const PET_HEIGHT_V3 = 74.5;
const PET_GAP_V3 = 1;
/** v3 pet grid: the frame's width in 12 columns, and the height of a row of tick boxes. */
const GRID = (RIGHT - LEFT + 4) / 12;
const GRID_ROW = 8.2;

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

/** An open writing line (or lines), `width` mm wide. */
function openLine(captions: Caption[], key: string, label: string, x: number, y: number, width: number, lines = 1, height = LINE_H): WriteIn {
  captions.push({ x, y: y - 0.9, text: label, size: CAPTION, bold: true });
  return { key, label, open: true, rows: Array.from({ length: lines }, (_, i) => [rect(x, y + i * (height + 1), width, height)]) };
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
    // Year options print as four digits, not their placeholder.
    at += BOX + 1.2 + textWidth(YEAR_OPTION.test(value) ? "0000" : value, OPTION) + 4;
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

/** Tick-box lines of a pet block; throws if one runs past the margin (caught by the layout tests). */
function choiceLines(captions: Caption[], lines: [number, [string, string, string[]][]][]): ChoiceGroup[] {
  const groups: ChoiceGroup[] = [];
  for (const [y, specs] of lines) {
    let x = LEFT;
    for (const [key, label, values] of specs) {
      const [group, next] = choices(captions, key, label, x, y, values);
      groups.push(group);
      x = next;
    }
    if (x - 3 > RIGHT) throw new Error(`Census layout: line at ${y} mm is too wide.`);
  }
  return groups;
}

const PET_CHOICES: [string, string, string[]][][] = [
  [
    ["type", "TYPE OF PET", ["DOG", "CAT"]],
    ["sex", "SEX", ["MALE", "FEMALE"]],
    ["sterilized", "STERILIZED", ["YES", "NO", "UNKNOWN"]],
  ],
  [
    ["breed", "BREED", ["MONGREL MIX", "MIX", "PURE", "UNKNOWN"]],
    ["classification", "CLASSIFICATION", ["CONFINED", "SEMI-CONFINED", "FREE ROAMING"]],
  ],
  [
    ["vaccination", "VACCINATION STATUS", ["1ST", "2ND", "3RD", "BOOSTER", "NONE", "UNKNOWN"]],
    ["laps", "LAPS (SKIPPED A VACCINE)", ["YES", "NO", "UNKNOWN"]],
  ],
];

const COLOR: [string, string, string[]] = ["color", "COLOR", ["BLACK", "WHITE", "BROWN", "GRAY", "ORANGE", "MIXED/SPOTTED", "OTHER"]];
// Years are printed from the census year (YEAR-7 … YEAR-0): the same boxes every year.
const REGISTERED: [string, string, string[]] = ["registered", "REGISTERED IN (YEAR)", [...[7, 6, 5, 4, 3, 2, 1, 0].map((k) => `YEAR-${k}`), "EARLIER", "NOT YET"]];

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

  const groups = choiceLines(captions, [
    [top + 28, PET_CHOICES[0]],
    [top + 36.5, PET_CHOICES[1]],
    [top + 45, PET_CHOICES[2]],
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

/**
 * v2 pet block: open lines for the name, other vaccines and remarks; age as
 * one row (0–20+ years, 0–11 months); Color and Registered In as tick boxes.
 */
function petBlockV2(slot: number, top: number, captions: Caption[], frames: Rect[]): PetBlock {
  frames.push(rect(LEFT - 2, top, RIGHT - LEFT + 4, PET_HEIGHT_V2));
  const notApplicable = rect(RIGHT - 52, top + 0.9, BOX, BOX);
  captions.push({ x: notApplicable.x + BOX + 1.2, y: top + 4.4, text: "N/A — NO PET IN THIS SLOT", size: OPTION });

  const writeIns = [openLine(captions, "pet_name", "NAME OF PET", LEFT, top + 8.5, RIGHT - LEFT)];

  const ageY = top + 19.5;
  captions.push({ x: LEFT, y: ageY - 2.9, text: "AGE — YEARS", size: CAPTION, bold: true });
  const years = bubbles(captions, LEFT, ageY, 21);
  // The last bubble means 20 or older.
  captions.splice(captions.length - 1, 1, { x: years[20].x + BUBBLE / 2, y: ageY - 0.5, text: "20+", size: 1.9, anchor: "middle" });
  const monthsX = LEFT + 21 * BUBBLE_PITCH + 8;
  captions.push({ x: monthsX, y: ageY - 2.9, text: "AGE — MONTHS", size: CAPTION, bold: true });
  const months = bubbles(captions, monthsX, ageY, 12);
  const numbers: NumberGroup[] = [
    { key: "age_years", label: "Age (years)", base: 0, places: [{ weight: 1, bubbles: years }] },
    { key: "age_months", label: "Age (months)", base: 0, places: [{ weight: 1, bubbles: months }] },
  ];

  const groups = choiceLines(captions, [
    [top + 26.5, PET_CHOICES[0]],
    [top + 34.2, PET_CHOICES[1]],
    [top + 41.9, PET_CHOICES[2]],
    [top + 49.6, [COLOR]],
    [top + 57.3, [REGISTERED]],
  ]);

  const half = (RIGHT - LEFT - 6) / 2;
  writeIns.push(openLine(captions, "other_vaccines", "OTHER VACCINES", LEFT, top + 66, half, 1, 5));
  writeIns.push(openLine(captions, "remarks", "REMARKS (OR OTHER COLOR)", LEFT + half + 6, top + 66, half, 1, 5));

  return { slot, frame: rect(LEFT - 2, top, RIGHT - LEFT + 4, PET_HEIGHT_V2), titleAt: { x: LEFT, y: top + 3.8 }, notApplicable, writeIns, choices: groups, numbers };
}

/**
 * One row of the v3 pet grid: each category gets `spans` columns, its name
 * on top and its tick boxes on column lines, so boxes line up down the rows.
 * Throws if a category's options don't fit its columns (caught by the layout tests).
 */
function gridRow(captions: Caption[], rules: Rect[], top: number, specs: [string, string, string[]][], spans: number[]): ChoiceGroup[] {
  let col = 0;
  return specs.map(([key, label, values], i) => {
    const cellX = LEFT - 2 + col * GRID;
    if (col > 0) rules.push(rect(cellX, top, 0, GRID_ROW));
    captions.push({ x: cellX + 2.5, y: top + 2.3, text: label, size: CAPTION, bold: true });
    let at = col;
    const options = values.map((value) => {
      const box = rect(LEFT - 2 + at * GRID + 2.5, top + 3, BOX, BOX);
      captions.push({ x: box.x + BOX + 1.2, y: box.y + BOX - 1, text: value, size: OPTION });
      // M and W print wider than textWidth allows ("BROWN" would touch the next box).
      const width = textWidth(YEAR_OPTION.test(value) ? "0000" : value, OPTION) + (value.match(/[MW]/g)?.length ?? 0) * 0.8;
      at += Math.ceil((BOX + 1.2 + width + 2) / GRID);
      return { value, box };
    });
    col += spans[i];
    if (at > col) throw new Error(`Census layout: ${label} doesn't fit its ${spans[i]} columns.`);
    return { key, label, options };
  });
}

/**
 * v3 pet block: name and age as on v2, then a grid of categories (type, sex,
 * sterilized / breed, classification / vaccination, laps / color / registered
 * in), then other vaccines and remarks side by side.
 */
function petBlockV3(slot: number, top: number, captions: Caption[], frames: Rect[], rules: Rect[]): PetBlock {
  const frame = rect(LEFT - 2, top, RIGHT - LEFT + 4, PET_HEIGHT_V3);
  frames.push(frame);
  const notApplicable = rect(RIGHT - 52, top + 1, BOX, BOX);
  captions.push({ x: notApplicable.x + BOX + 1.2, y: top + 4.5, text: "N/A — NO PET IN THIS SLOT", size: OPTION });

  const writeIns = [openLine(captions, "pet_name", "NAME OF PET", LEFT, top + 9, RIGHT - LEFT)];

  const ageY = top + 21.4;
  captions.push({ x: LEFT, y: ageY - 3.3, text: "AGE — YEARS", size: CAPTION, bold: true });
  const years = bubbles(captions, LEFT, ageY, 21);
  captions.splice(captions.length - 1, 1, { x: years[20].x + BUBBLE / 2, y: ageY - 0.5, text: "20+", size: 1.9, anchor: "middle" });
  const monthsX = LEFT + 21 * BUBBLE_PITCH + 8;
  captions.push({ x: monthsX, y: ageY - 3.3, text: "AGE — MONTHS", size: CAPTION, bold: true });
  const months = bubbles(captions, monthsX, ageY, 12);
  const numbers: NumberGroup[] = [
    { key: "age_years", label: "Age (years)", base: 0, places: [{ weight: 1, bubbles: years }] },
    { key: "age_months", label: "Age (months)", base: 0, places: [{ weight: 1, bubbles: months }] },
  ];

  const gridTop = top + 26.6;
  const rows: [[string, string, string[]][], number[]][] = [
    [PET_CHOICES[0], [4, 4, 4]],
    [PET_CHOICES[1], [6, 6]],
    [PET_CHOICES[2], [8, 4]],
    [[COLOR], [12]],
    [[REGISTERED], [12]],
  ];
  for (let r = 0; r <= rows.length; r++) rules.push(rect(frame.x, gridTop + r * GRID_ROW, frame.width, 0));
  const groups = rows.flatMap(([specs, spans], r) => gridRow(captions, rules, gridTop + r * GRID_ROW, specs, spans));

  // Other vaccines | remarks, each named left of its line.
  const lineTop = gridTop + rows.length * GRID_ROW;
  const lineY = lineTop + 0.7;
  const middle = frame.x + 6 * GRID;
  rules.push(rect(middle, lineTop, 0, top + PET_HEIGHT_V3 - lineTop));
  captions.push({ x: LEFT, y: lineY + 3.6, text: "OTHER VACCINES", size: CAPTION, bold: true });
  captions.push({ x: middle + 2.5, y: lineY + 2.4, text: "REMARKS", size: CAPTION, bold: true });
  captions.push({ x: middle + 2.5, y: lineY + 4.8, text: "(OR OTHER COLOR)", size: 1.9 });
  writeIns.push({ key: "other_vaccines", label: "OTHER VACCINES", open: true, rows: [[rect(LEFT + 22, lineY, middle - 2.5 - (LEFT + 22), 5.5)]] });
  writeIns.push({ key: "remarks", label: "REMARKS (OR OTHER COLOR)", open: true, rows: [[rect(middle + 23.5, lineY, RIGHT - (middle + 23.5), 5.5)]] });

  return { slot, frame, titleAt: { x: LEFT, y: top + 4.4 }, notApplicable, writeIns, choices: groups, numbers };
}

export function buildCensusLayout(version: number = FORM_VERSION): CensusLayout {
  const captions: Caption[] = [];
  const frames: Rect[] = [];
  const rules: Rect[] = [];
  const near = MARKER_INSET;
  const far = (size: number) => size - MARKER_INSET - MARKER;
  const markers = [rect(near, near, MARKER, MARKER), rect(far(PAGE.width), near, MARKER, MARKER), rect(far(PAGE.width), far(PAGE.height), MARKER, MARKER), rect(near, far(PAGE.height), MARKER, MARKER)];
  const pitch = 3.2;
  const codeX = (PAGE.width - CODE_BITS * pitch + 0.7) / 2;
  const code = Array.from({ length: CODE_BITS }, (_, i) => rect(codeX + i * pitch, 28, 2.5, 2.5));

  frames.push(rect(LEFT - 2, 36.5, RIGHT - LEFT + 4, 10));
  const v1 = version === 1;
  const v3 = version >= 3;
  frames.push(rect(LEFT - 2, 48, RIGHT - LEFT + 4, v3 ? 35.5 : 41));
  captions.push({
    x: RIGHT,
    y: 52.3 - 1.6,
    text: v1 ? "USE CAPITAL LETTERS · ONE LETTER PER BOX · TICK ✓ OR FILL ● ONE BOX" : "WRITE IN CAPITAL LETTERS INSIDE THE LINES · TICK ✓ OR FILL ● ONE BOX",
    size: 2.1,
    anchor: "end",
  });
  const ownerCaptions: Caption[] = [{ x: LEFT, y: 52.3 - 1.6, text: "B. OWNER INFORMATION", size: 3, bold: true }];
  const owner = v1
    ? [
        writeIn(ownerCaptions, "owner_name", "FULL NAME OF OWNER", LEFT, 55, 30),
        writeIn(ownerCaptions, "address", "COMPLETE ADDRESS", LEFT, 64.5, 30, 2),
        writeIn(ownerCaptions, "contact", "CONTACT NUMBER (0000-000-0000)", LEFT, 81, 11, 1, true),
      ]
    : [
        openLine(ownerCaptions, "owner_name", "FULL NAME OF OWNER", LEFT, 55, RIGHT - LEFT),
        openLine(ownerCaptions, "address", "COMPLETE ADDRESS", LEFT, v3 ? 65 : 64.5, RIGHT - LEFT, v3 ? 1 : 2),
        writeIn(ownerCaptions, "contact", "CONTACT NUMBER (0000-000-0000)", LEFT, v3 ? 75 : 81, 11, 1, true),
      ];

  // Continuation sheets print this in the owner block instead.
  const continuedFrom: NumberGroup = {
    key: "continued_from",
    label: "Continued from sheet no.",
    base: 0,
    places: [1000, 100, 10, 1].map((weight, i) => ({ weight, bubbles: bubbles([], LEFT + 40, v3 ? 56 + i * 6.6 : 58 + i * 7.5, 10) })),
  };

  const pets = [0, 1, 2].map((slot) =>
    v1
      ? petBlock(slot, 91 + slot * (PET_HEIGHT + PET_GAP), captions, frames)
      : v3
        ? petBlockV3(slot, 84.5 + slot * (PET_HEIGHT_V3 + PET_GAP_V3), captions, frames, rules)
        : petBlockV2(slot, 91 + slot * (PET_HEIGHT_V2 + PET_GAP), captions, frames),
  );

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
    rules,
  };
}

const LAYOUTS = new Map(SUPPORTED_VERSIONS.map((v) => [v, buildCensusLayout(v)]));

/** The layout a sheet of this form version was printed with. */
export function layoutFor(version: number): CensusLayout {
  const layout = LAYOUTS.get(version);
  if (!layout) throw new RangeError(`Census sheet version ${version} isn't known.`);
  return layout;
}

/** The layout printed now. */
export const CENSUS_LAYOUT = layoutFor(FORM_VERSION);

/** What a printed option says: Registered In years are counted back from the census year. */
export function optionText(value: string, censusYear: number) {
  const year = value.match(YEAR_OPTION);
  return year ? String(censusYear - Number(year[1])) : value;
}

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
