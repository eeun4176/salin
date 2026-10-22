/**
 * Census Sheet Test Fixtures
 * Draws a filled-in census sheet straight from the layout as a grayscale
 * image (markers, code strip, box outlines, ticks, filled bubbles and ink in
 * letter boxes), and "photographs" it: tilted in perspective on a darker
 * table, optionally turned. No canvas needed, so the OMR runs in unit tests.
 */

import { layoutFor, PAGE, type Rect } from "@/core/census/census-layout";
import { encodeSheetCode, type SheetCode } from "@/core/census/code-strip";
import { createGray, rotateQuarter, warpPerspective, type GrayImage } from "@/core/ocr/imaging/pixels";

export interface SheetFill {
  code: SheetCode;
  /** "pet0.type" → "DOG"; a number group → its value; several values tick several boxes. */
  answers?: Record<string, string | string[]>;
  /** Faint smudges (too light to be a tick) in these options. */
  faint?: Record<string, string>;
  /** Writing to ink, by "owner.owner_name" → cell indexes of the first row (on an open line: letter positions along it). */
  writing?: Record<string, number[]>;
  emptySlots?: number[];
}

function fillRect(img: GrayImage, r: Rect, scale: number, value = 0) {
  for (let y = Math.round(r.y * scale); y < Math.round((r.y + r.height) * scale); y++)
    for (let x = Math.round(r.x * scale); x < Math.round((r.x + r.width) * scale); x++) if (x >= 0 && y >= 0 && x < img.width && y < img.height) img.data[y * img.width + x] = value;
}

function outline(img: GrayImage, r: Rect, scale: number, value = 60) {
  const t = 0.25;
  fillRect(img, { x: r.x, y: r.y, width: r.width, height: t }, scale, value);
  fillRect(img, { x: r.x, y: r.y + r.height - t, width: r.width, height: t }, scale, value);
  fillRect(img, { x: r.x, y: r.y, width: t, height: r.height }, scale, value);
  fillRect(img, { x: r.x + r.width - t, y: r.y, width: t, height: r.height }, scale, value);
}

/** An X through the box (a pen tick). */
function tick(img: GrayImage, r: Rect, scale: number, value = 20) {
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const s = 0.45;
    fillRect(img, { x: r.x + f * r.width - s / 2, y: r.y + f * r.height - s / 2, width: s, height: s }, scale, value);
    fillRect(img, { x: r.x + (1 - f) * r.width - s / 2, y: r.y + f * r.height - s / 2, width: s, height: s }, scale, value);
  }
}

/** The flat sheet at `scale` px per mm. */
export function drawSheet(fill: SheetFill, scale = 8): GrayImage {
  const layout = layoutFor(fill.code.version);
  const img = createGray(PAGE.width * scale, PAGE.height * scale, 250);
  layout.markers.forEach((m) => fillRect(img, m, scale));
  fillRect(img, layout.hollowMarker, scale, 250);
  encodeSheetCode(fill.code).forEach((bit, i) => (bit ? fillRect(img, layout.code[i], scale) : outline(img, layout.code[i], scale, 200)));

  const answers = fill.answers ?? {};
  const mark = (key: string, value: string, r: Rect) => {
    const wanted = answers[key];
    if (wanted === value || (Array.isArray(wanted) && wanted.includes(value))) tick(img, r, scale);
    if (fill.faint?.[key] === value) fillRect(img, { x: r.x + r.width * 0.45, y: r.y + r.height * 0.45, width: r.width * 0.12, height: r.height * 0.12 }, scale, 30);
  };
  const number = (key: string, group: (typeof layout.pets)[number]["numbers"][number]) => {
    const wanted = answers[key];
    group.places.forEach((place) =>
      place.bubbles.forEach((b, digit) => {
        outline(img, b, scale);
        if (typeof wanted !== "string") return;
        const value = Number(wanted) - group.base;
        // A 0–11 months row holds the whole value; decimal rows hold one digit (leading zeros left blank).
        const placeValue = place.bubbles.length > 10 ? value : Math.floor(value / place.weight) % 10;
        if (placeValue === digit && (place.weight === 1 || value >= place.weight)) fillRect(img, b, scale, 30);
      }),
    );
  };
  const letters = (key: string, rows: Rect[][]) => {
    rows.flat().forEach((cell) => outline(img, cell, scale, 120));
    for (const i of fill.writing?.[key] ?? []) {
      // An open line is one long box: letters go one after another along it.
      const c = rows[0].length === 1 ? { ...rows[0][0], x: rows[0][0].x + 2 + i * 4.5, width: 4.5 } : rows[0][i];
      fillRect(img, { x: c.x + c.width * 0.3, y: c.y + c.height * 0.25, width: c.width * 0.35, height: c.height * 0.5 }, scale, 25);
    }
  };

  if (fill.code.continuation) layout.continuedFrom.places.forEach(() => number("owner.continued_from", layout.continuedFrom));
  else layout.owner.forEach((field) => letters(`owner.${field.key}`, field.rows));
  for (const pet of layout.pets) {
    outline(img, pet.notApplicable, scale);
    if (fill.emptySlots?.includes(pet.slot)) tick(img, pet.notApplicable, scale);
    for (const group of pet.choices)
      for (const option of group.options) {
        outline(img, option.box, scale);
        mark(`pet${pet.slot}.${group.key}`, option.value, option.box);
      }
    for (const group of pet.numbers) number(`pet${pet.slot}.${group.key}`, group);
    for (const field of pet.writeIns) letters(`pet${pet.slot}.${field.key}`, field.rows);
  }
  return img;
}

/** The sheet as a phone photo: on a grey table, seen at an angle, then turned `turn` degrees. */
export function photograph(sheet: GrayImage, turn: 0 | 90 | 180 | 270 = 0, tilt = 0.04): GrayImage {
  const pad = Math.round(sheet.width * 0.12);
  const table = createGray(sheet.width + pad * 2, sheet.height + pad * 2, 140);
  for (let y = 0; y < sheet.height; y++) table.data.set(sheet.data.subarray(y * sheet.width, (y + 1) * sheet.width), (y + pad) * table.width + pad);
  const w = table.width;
  const h = table.height;
  // Pick a slightly skewed window of the table: the sheet comes out in perspective.
  const quad: Parameters<typeof warpPerspective>[1] = [
    { x: w * tilt, y: h * tilt * 0.5 },
    { x: w * (1 - tilt * 0.3), y: 0 },
    { x: w, y: h * (1 - tilt * 0.4) },
    { x: w * tilt * 0.6, y: h },
  ];
  const photo = warpPerspective(table, quad, Math.round(w * 0.6), Math.round(h * 0.6));
  return rotateQuarter(photo, turn, 1);
}
