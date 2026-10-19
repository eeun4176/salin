/**
 * Box Geometry
 * Helpers for the rectangles OCR and layout analysis work with: union,
 * centre, overlap, containment, and conversion to and from page-relative
 * (0–1) boxes used by templates and source references.
 */

import type { Box } from "@/types/ocr";

export const right = (b: Box) => b.x + b.width;
export const bottom = (b: Box) => b.y + b.height;
export const centerX = (b: Box) => b.x + b.width / 2;
export const centerY = (b: Box) => b.y + b.height / 2;

export function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map(right));
  const y1 = Math.max(...boxes.map(bottom));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function intersection(a: Box, b: Box) {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Intersection over the smaller box's area. */
export function overlapRatio(a: Box, b: Box) {
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 ? intersection(a, b) / smaller : 0;
}

export function containsPoint(b: Box, x: number, y: number) {
  return x >= b.x && x <= right(b) && y >= b.y && y <= bottom(b);
}

/** Vertical overlap of two boxes as a share of the shorter one. */
export function verticalOverlap(a: Box, b: Box) {
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return h > 0 ? h / Math.min(a.height, b.height) : 0;
}

export function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Page-relative box (0–1) for storing regions independent of image size. */
export function normalize(b: Box, width: number, height: number): Box {
  const r = (v: number) => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));
  const x = r(b.x / width);
  const y = r(b.y / height);
  return { x, y, width: Math.min(1 - x, r(b.width / width)), height: Math.min(1 - y, r(b.height / height)) };
}

export function denormalize(b: Box, width: number, height: number): Box {
  return { x: b.x * width, y: b.y * height, width: b.width * width, height: b.height * height };
}

export function expand(b: Box, dx: number, dy = dx): Box {
  return { x: b.x - dx, y: b.y - dy, width: b.width + 2 * dx, height: b.height + 2 * dy };
}
