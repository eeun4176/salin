/**
 * Census Sheet Test Fixtures
 * Draws a filled-in census sheet straight from the layout as a grayscale
 * image (markers, code strip, box outlines, ticks, filled bubbles and ink in
 * letter boxes — and, for a printed-looking page, the words, frames and grid
 * lines, with ticks drawn as one thin pen slash), and "photographs" it: tilted in perspective on a darker
 * table, optionally turned. No canvas needed, so the OMR runs in unit tests.
 */

import { layoutFor, PAGE, type Caption, type Rect } from "@/core/census/census-layout";
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
  /** Print the words (as letter-shaped ink), frames and grid lines too, like a real printed sheet. */
  printed?: boolean;
  /** How ticks are drawn: an X across the box (default), or one thin "/" that runs a little past the box. */
  tickStyle?: "x" | "slash";
}

function fillRect(img: GrayImage, r: Rect, scale: number, value = 0) {
  for (let y = Math.round(r.y * scale); y < Math.round((r.y + r.height) * scale); y++)
    for (let x = Math.round(r.x * scale); x < Math.round((r.x + r.width) * scale); x++) if (x >= 0 && y >= 0 && x < img.width && y < img.height) img.data[y * img.width + x] = value;
}

/** A printed outline: the stroke is centred on the box edge, as the SVG prints it. */
function outline(img: GrayImage, r: Rect, scale: number, value = 60) {
  const t = 0.3;
  fillRect(img, { x: r.x - t / 2, y: r.y - t / 2, width: r.width + t, height: t }, scale, value);
  fillRect(img, { x: r.x - t / 2, y: r.y + r.height - t / 2, width: r.width + t, height: t }, scale, value);
  fillRect(img, { x: r.x - t / 2, y: r.y - t / 2, width: t, height: r.height + t }, scale, value);
  fillRect(img, { x: r.x + r.width - t / 2, y: r.y - t / 2, width: t, height: r.height + t }, scale, value);
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

/** One thin "/" stroke, bottom-left to top-right, overshooting the box by `over` mm at both ends. */
function slash(img: GrayImage, r: Rect, scale: number, over = 0.8, value = 70) {
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const s = 0.3;
    const x = r.x - over + f * (r.width + 2 * over);
    const y = r.y + r.height + over - f * (r.height + 2 * over);
    fillRect(img, { x: x - s / 2, y: y - s / 2, width: s, height: s }, scale, value);
  }
}

/** A printed word as ink: one upright stroke per letter, cap-height tall, standing on the baseline. */
function word(img: GrayImage, c: Caption, scale: number) {
  const pitch = c.size * 0.64;
  const x0 = c.x - (c.anchor === "middle" ? (c.text.length * pitch) / 2 : c.anchor === "end" ? c.text.length * pitch : 0);
  [...c.text].forEach((ch, i) => {
    if (ch !== " ") fillRect(img, { x: x0 + i * pitch, y: c.y - c.size * 0.72, width: pitch * 0.55, height: c.size * 0.72 }, scale, 40);
  });
}

/** The flat sheet at `scale` px per mm. */
export function drawSheet(fill: SheetFill, scale = 8): GrayImage {
  const layout = layoutFor(fill.code.version);
  const img = createGray(PAGE.width * scale, PAGE.height * scale, 250);
  layout.markers.forEach((m) => fillRect(img, m, scale));
  fillRect(img, layout.hollowMarker, scale, 250);
  encodeSheetCode(fill.code).forEach((bit, i) => (bit ? fillRect(img, layout.code[i], scale) : outline(img, layout.code[i], scale, 200)));
  if (fill.printed) {
    [...layout.captions, ...(fill.code.continuation ? [] : layout.ownerCaptions)].forEach((c) => word(img, c, scale));
    layout.frames.forEach((f) => outline(img, f, scale, 90));
    // Grid lines print grey (#999), 0.2 mm.
    layout.rules.forEach((r) => fillRect(img, { ...r, width: Math.max(r.width, 0.2), height: Math.max(r.height, 0.2) }, scale, 153));
  }
  const pen = (r: Rect) => (fill.tickStyle === "slash" ? slash(img, r, scale) : tick(img, r, scale));

  const answers = fill.answers ?? {};
  const mark = (key: string, value: string, r: Rect) => {
    const wanted = answers[key];
    if (wanted === value || (Array.isArray(wanted) && wanted.includes(value))) pen(r);
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

/**
 * Paper that isn't quite flat: the middle of the page bows down by up to `mm`
 * while the corners (and their markers) stay put, so a straight-on homography
 * can't undo it and long rows come out tilted by up to a millimetre.
 */
export function bend(sheet: GrayImage, mm: number, scale = 8): GrayImage {
  const out = createGray(sheet.width, sheet.height, 250);
  for (let y = 0; y < sheet.height; y++)
    for (let x = 0; x < sheet.width; x++) {
      const dy = mm * scale * Math.sin((Math.PI * x) / sheet.width) * Math.sin((Math.PI * y) / sheet.height);
      const sy = Math.round(y - dy);
      if (sy >= 0 && sy < sheet.height) out.data[y * sheet.width + x] = sheet.data[sy * sheet.width + x];
    }
  return out;
}

/** Soft focus: a box blur of `r` px, across then down. */
function blur(img: GrayImage, r: number): GrayImage {
  const out = { ...img, data: new Uint8ClampedArray(img.data) };
  for (const across of [true, false]) {
    const src = new Uint8ClampedArray(out.data);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        let sum = 0;
        let n = 0;
        for (let d = -r; d <= r; d++) {
          const xx = across ? x + d : x;
          const yy = across ? y : y + d;
          if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
          sum += src[yy * img.width + xx];
          n++;
        }
        out.data[y * img.width + x] = sum / n;
      }
  }
  return out;
}

/** The sheet as a phone photo: on a grey table, seen at an angle, then turned `turn` degrees; `soft` blurs it by that many px. */
export function photograph(sheet: GrayImage, turn: 0 | 90 | 180 | 270 = 0, tilt = 0.04, soft = 0): GrayImage {
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
  return rotateQuarter(soft ? blur(photo, soft) : photo, turn, 1);
}
