/**
 * Page Image Analysis
 * Finds structure in a page image without OCR: the page's corners in a
 * photo (for automatic cropping), how far the text is tilted (deskew),
 * whether the text runs sideways, drawn ruling lines (table grids, fill-in
 * lines), and checkboxes with how much of each is marked. Pure functions
 * over pixel arrays, shared by the worker and the tests.
 */

import { boxBlur, otsuThreshold, resizeGray, type GrayImage } from "@/core/ocr/imaging/pixels";
import type { Box, CheckboxMark, Point, Quad } from "@/types/ocr";

/* ------------------------------------------------------------------
   Document boundaries
------------------------------------------------------------------- */

export interface DetectedQuad {
  quad: Quad;
  /** 0–1: how rectangular and well separated from the background the page looked. */
  confidence: number;
}

/**
 * Looks for a bright page on a darker background (a photo of paper on a
 * table). Returns its corners as 0–1 fractions, or `null` when the page
 * already fills the image or no clear page edge is visible.
 */
export function detectDocumentQuad(image: GrayImage): DetectedQuad | null {
  const scale = 256 / Math.max(image.width, image.height);
  const small = boxBlur(resizeGray(image, image.width * scale, image.height * scale), 1);
  const { width, height, data } = small;
  const threshold = otsuThreshold(small);

  // Largest 4-connected bright region = the paper.
  const labels = new Int32Array(width * height).fill(-1);
  const stack: number[] = [];
  let best: number[] = [];
  for (let start = 0; start < data.length; start++) {
    if (labels[start] !== -1 || data[start] <= threshold) continue;
    const pixels: number[] = [];
    labels[start] = start;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % width;
      const neighbours = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width];
      for (const q of neighbours) {
        if (q < 0 || q >= data.length || labels[q] !== -1 || data[q] <= threshold) continue;
        labels[q] = start;
        stack.push(q);
      }
    }
    if (pixels.length > best.length) best = pixels;
  }

  const coverage = best.length / data.length;
  if (coverage < 0.15 || coverage > 0.95) return null;

  // Corners = the region's extreme points along the diagonals.
  let tl = { s: Infinity, x: 0, y: 0 };
  let br = { s: -Infinity, x: 0, y: 0 };
  let tr = { s: -Infinity, x: 0, y: 0 };
  let bl = { s: Infinity, x: 0, y: 0 };
  for (const p of best) {
    const x = p % width;
    const y = (p - x) / width;
    if (x + y < tl.s) tl = { s: x + y, x, y };
    if (x + y > br.s) br = { s: x + y, x, y };
    if (x - y > tr.s) tr = { s: x - y, x, y };
    if (x - y < bl.s) bl = { s: x - y, x, y };
  }
  const corners: Point[] = [tl, tr, br, bl].map((c) => ({ x: c.x, y: c.y }));
  const area = polygonArea(corners);
  if (area <= 0) return null;
  // A page is a convex four-sided shape that its corners outline closely.
  const fill = best.length / area;
  if (fill < 0.85 || fill > 1.15 || !isConvex(corners)) return null;
  const touchesAllEdges = corners.every((c) => c.x <= 1 || c.y <= 1 || c.x >= width - 2 || c.y >= height - 2);
  if (touchesAllEdges) return null;

  const quad = corners.map((c) => ({ x: Math.min(1, Math.max(0, c.x / (width - 1))), y: Math.min(1, Math.max(0, c.y / (height - 1))) })) as Quad;
  const confidence = Math.max(0, Math.min(1, 1 - Math.abs(1 - fill) * 4));
  return { quad, confidence };
}

function polygonArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function isConvex(points: Point[]) {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/* ------------------------------------------------------------------
   Skew and orientation
------------------------------------------------------------------- */

/** Up to this many ink pixels are sampled when measuring skew. */
const SKEW_SAMPLES = 60_000;

function inkPoints(mask: Uint8Array, width: number) {
  let total = 0;
  for (let i = 0; i < mask.length; i++) total += mask[i];
  const step = Math.max(1, Math.floor(total / SKEW_SAMPLES));
  const xs: number[] = [];
  const ys: number[] = [];
  let seen = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    if (seen++ % step) continue;
    xs.push(i % width);
    ys.push(Math.floor(i / width));
  }
  return { xs, ys };
}

/** How sharply text lines stand out when the page is projected at `degrees`: higher = better aligned. */
function profileSharpness(xs: number[], ys: number[], degrees: number, height: number, width: number) {
  const rad = (degrees * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const bins = new Float64Array(height + width + 2);
  const offset = width;
  for (let i = 0; i < xs.length; i++) {
    const y = Math.round(ys[i] * cos - xs[i] * sin) + offset;
    if (y >= 0 && y < bins.length) bins[y]++;
  }
  let sum = 0;
  for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
  return sum;
}

/**
 * Estimates how many degrees the text is tilted (clockwise positive) by
 * finding the angle at which the rows of text project most sharply.
 * Rotating the page by the negative of this straightens it. Returns 0 for
 * pages with too little text to judge.
 */
export function estimateSkew(mask: Uint8Array, width: number, height: number, maxDegrees = 10): number {
  const { xs, ys } = inkPoints(mask, width);
  if (xs.length < 200) return 0;
  let best = 0;
  let bestScore = -1;
  for (let a = -maxDegrees; a <= maxDegrees + 1e-9; a += 0.5) {
    const score = profileSharpness(xs, ys, a, height, width);
    if (score > bestScore) [best, bestScore] = [a, score];
  }
  for (let a = best - 0.4; a <= best + 0.4 + 1e-9; a += 0.1) {
    const score = profileSharpness(xs, ys, a, height, width);
    if (score > bestScore) [best, bestScore] = [a, score];
  }
  // Lines tilted clockwise by θ (y = x·tanθ + c) project sharpest at exactly θ.
  const skew = Math.round(best * 10) / 10;
  return Math.abs(skew) < 0.2 ? 0 : skew;
}

/**
 * True when text lines run vertically (the page is on its side): the
 * column profile is much sharper than the row profile.
 */
export function looksSideways(mask: Uint8Array, width: number, height: number): boolean {
  const { xs, ys } = inkPoints(mask, width);
  if (xs.length < 500) return false;
  // Relative to an even spread (n² / bins), so tall and wide pages compare fairly.
  const rows = profileSharpness(xs, ys, 0, height, width) * height;
  const columns = profileSharpness(ys, xs, 0, width, height) * width;
  return columns > rows * 1.6;
}

/* ------------------------------------------------------------------
   Ruling lines
------------------------------------------------------------------- */

/** Merges per-row runs into line segments (thin boxes). */
function collectRuns(mask: Uint8Array, width: number, height: number, horizontal: boolean, minLength: number, maxGap: number): Box[] {
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const at = (o: number, i: number) => (horizontal ? mask[o * width + i] : mask[i * width + o]);
  const open: { start: number; end: number; first: number; last: number }[] = [];
  const done: Box[] = [];

  const finish = (seg: { start: number; end: number; first: number; last: number }) => {
    const thickness = seg.last - seg.first + 1;
    if (thickness > Math.max(6, minLength / 12)) return; // a filled block, not a line
    done.push(horizontal ? { x: seg.start, y: seg.first, width: seg.end - seg.start + 1, height: thickness } : { x: seg.first, y: seg.start, width: thickness, height: seg.end - seg.start + 1 });
  };

  for (let o = 0; o < outer; o++) {
    const runs: [number, number][] = [];
    let start = -1;
    let gap = 0;
    for (let i = 0; i <= inner; i++) {
      const ink = i < inner && at(o, i) === 1;
      if (ink) {
        if (start === -1) start = i;
        gap = 0;
      } else if (start !== -1) {
        gap++;
        if (gap > maxGap || i === inner) {
          const end = i - gap;
          if (end - start + 1 >= minLength) runs.push([start, end]);
          start = -1;
          gap = 0;
        }
      }
    }
    // Continue segments from the previous row/column when they overlap.
    for (const [s, e] of runs) {
      const match = open.find((seg) => seg.last >= o - 2 && Math.min(seg.end, e) - Math.max(seg.start, s) >= 0.8 * Math.min(seg.end - seg.start, e - s));
      if (match) {
        match.start = Math.min(match.start, s);
        match.end = Math.max(match.end, e);
        match.last = o;
      } else {
        open.push({ start: s, end: e, first: o, last: o });
      }
    }
    for (let k = open.length - 1; k >= 0; k--) {
      if (open[k].last < o - 2) {
        finish(open[k]);
        open.splice(k, 1);
      }
    }
  }
  open.forEach(finish);
  return done;
}

/**
 * Finds drawn horizontal and vertical lines: table grids, boxes and
 * fill-in lines. Short strokes (letters) are ignored.
 */
export function findRulingLines(mask: Uint8Array, width: number, height: number) {
  const unit = Math.max(width, height);
  const horizontal = collectRuns(mask, width, height, true, Math.max(30, Math.round(unit * 0.035)), 2);
  const vertical = collectRuns(mask, width, height, false, Math.max(30, Math.round(unit * 0.03)), 2);
  return { horizontal, vertical };
}

/* ------------------------------------------------------------------
   Checkboxes
------------------------------------------------------------------- */

/** Fill share above which a box counts as ticked, and below which as empty. */
const CHECKED_FILL = 0.1;
const EMPTY_FILL = 0.035;

/**
 * Finds square, hollow outlines the size of a checkbox and measures how
 * much of each one's inside is marked. In-between fills (a faint or tiny
 * mark, a smudge) are reported as "unclear" rather than guessed.
 */
export function findCheckboxes(mask: Uint8Array, width: number, height: number): CheckboxMark[] {
  const unit = Math.max(width, height);
  const minSide = Math.max(9, Math.round(unit * 0.006));
  const maxSide = Math.round(unit * 0.035);
  const labels = new Int32Array(width * height).fill(-1);
  const stack: number[] = [];
  const found: CheckboxMark[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let count = 0;
    labels[start] = start;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && labels[q] === -1) {
            labels[q] = start;
            stack.push(q);
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w < minSide || h < minSide || w > maxSide || h > maxSide) continue;
    if (w / h < 0.75 || w / h > 1.33) continue;
    if (count < (w + h) * 1.6) continue; // too little ink to be a closed outline
    if (sideCoverage(mask, width, x0, y0, x1, y1) < 0.85) continue; // not a closed square outline

    const inset = Math.max(2, Math.round(Math.min(w, h) * 0.2));
    let ink = 0;
    let area = 0;
    for (let y = y0 + inset; y <= y1 - inset; y++) {
      for (let x = x0 + inset; x <= x1 - inset; x++) {
        ink += mask[y * width + x];
        area++;
      }
    }
    const fill = area ? ink / area : 0;
    const state = fill >= CHECKED_FILL ? "checked" : fill <= EMPTY_FILL ? "unchecked" : "unclear";
    found.push({ box: { x: x0, y: y0, width: w, height: h }, fill: Math.round(fill * 1000) / 1000, state });
  }
  return found;
}

/** Lowest share of inked positions along any of the four sides of the box (within a 2-pixel band). */
function sideCoverage(mask: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number) {
  const inkAt = (x: number, y: number) => mask[y * width + x] === 1;
  const band = 2;
  const sides = [0, 0, 0, 0];
  for (let x = x0; x <= x1; x++) {
    let top = false;
    let bottom = false;
    for (let b = 0; b < band; b++) {
      top ||= inkAt(x, y0 + b);
      bottom ||= inkAt(x, y1 - b);
    }
    sides[0] += Number(top);
    sides[1] += Number(bottom);
  }
  for (let y = y0; y <= y1; y++) {
    let left = false;
    let right = false;
    for (let b = 0; b < band; b++) {
      left ||= inkAt(x0 + b, y);
      right ||= inkAt(x1 - b, y);
    }
    sides[2] += Number(left);
    sides[3] += Number(right);
  }
  const w1 = x1 - x0 + 1;
  const h1 = y1 - y0 + 1;
  return Math.min(sides[0] / w1, sides[1] / w1, sides[2] / h1, sides[3] / h1);
}

/** Share of inked pixels, 0–1. */
export function inkRatio(mask: Uint8Array) {
  let ink = 0;
  for (let i = 0; i < mask.length; i++) ink += mask[i];
  return mask.length ? ink / mask.length : 0;
}

/** Share of inked pixels inside `box`. */
export function inkInBox(mask: Uint8Array, width: number, box: Box) {
  let ink = 0;
  let area = 0;
  const height = mask.length / width;
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(height, Math.ceil(box.y + box.height)); y++) {
    for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(width, Math.ceil(box.x + box.width)); x++) {
      ink += mask[y * width + x];
      area++;
    }
  }
  return area ? ink / area : 0;
}

/* ------------------------------------------------------------------
   Noise
------------------------------------------------------------------- */

/**
 * Isolated specks (ink blobs of at most `maxSize` pixels) per million
 * pixels. Clean print has few — dots on i's and full stops are bigger —
 * while grainy low-light photos and dirty photocopies have thousands.
 */
export function speckDensity(mask: Uint8Array, width: number, height: number, maxSize = 6): number {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  let specks = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (size <= maxSize) specks++;
  }
  return (specks / mask.length) * 1_000_000;
}
