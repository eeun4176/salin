/**
 * Corner Marker Finder
 * Finds the four solid black squares printed in the corners of a census
 * sheet in a photo: dark, square-ish, solid blobs of a plausible size, taking
 * the outermost one toward each corner of the picture. Also tells which one
 * has a white centre (the sheet's top-left), so a page photographed sideways
 * or upside down can be turned the right way.
 */

import { otsuThreshold, type GrayImage } from "@/core/ocr/imaging/pixels";
import type { Point } from "@/types/ocr";

export interface FoundMarker {
  centre: Point;
  size: number;
  hollow: boolean;
}

interface Blob {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
  sumX: number;
  sumY: number;
}

// Markers are clearly darker than paper; never trust a threshold that calls mid-grey ink.
const MAX_THRESHOLD = 128;

function darkBlobs(image: GrayImage, minSide: number, maxSide: number): Blob[] {
  const { width, height, data } = image;
  const threshold = Math.min(otsuThreshold(image), MAX_THRESHOLD);
  const seen = new Uint8Array(width * height);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < data.length; start++) {
    if (seen[start] || data[start] >= threshold) continue;
    const blob: Blob = { minX: width, minY: height, maxX: 0, maxY: 0, count: 0, sumX: 0, sumY: 0 };
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      blob.count++;
      blob.sumX += x;
      blob.sumY += y;
      if (x < blob.minX) blob.minX = x;
      if (x > blob.maxX) blob.maxX = x;
      if (y < blob.minY) blob.minY = y;
      if (y > blob.maxY) blob.maxY = y;
      const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const n of next) {
        if (n >= 0 && !seen[n] && data[n] < threshold) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    const w = blob.maxX - blob.minX + 1;
    const h = blob.maxY - blob.minY + 1;
    const fill = blob.count / (w * h);
    if (w >= minSide && h >= minSide && w <= maxSide && h <= maxSide && w / h > 0.6 && w / h < 1.67 && fill > 0.6) blobs.push(blob);
  }
  return blobs;
}

/** Is the blob's middle (a third of its size) paper? */
function isHollow(image: GrayImage, blob: Blob) {
  const threshold = Math.min(otsuThreshold(image), MAX_THRESHOLD);
  const cx = Math.round(blob.sumX / blob.count);
  const cy = Math.round(blob.sumY / blob.count);
  const r = Math.max(1, Math.floor((blob.maxX - blob.minX) / 8));
  let light = 0;
  let total = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      total++;
      if (image.data[y * image.width + x] >= threshold) light++;
    }
  }
  return light / total > 0.5;
}

/**
 * The four corner markers in picture order — top-left, top-right,
 * bottom-right, bottom-left of the image (not yet of the sheet) — or `null`
 * when four consistent markers aren't visible.
 */
export function findCornerMarkers(image: GrayImage): FoundMarker[] | null {
  const long = Math.max(image.width, image.height);
  const blobs = darkBlobs(image, Math.max(6, long * 0.008), long * 0.12);
  if (blobs.length < 4) return null;
  const centre = (b: Blob) => ({ x: b.sumX / b.count, y: b.sumY / b.count });
  const pick = (score: (p: Point) => number) => blobs.reduce((best, b) => (score(centre(b)) > score(centre(best)) ? b : best));
  const corners = [pick((p) => -p.x - p.y), pick((p) => p.x - p.y), pick((p) => p.x + p.y), pick((p) => p.y - p.x)];
  if (new Set(corners).size !== 4) return null;
  const sizes = corners.map((b) => Math.max(b.maxX - b.minX, b.maxY - b.minY) + 1);
  if (Math.max(...sizes) / Math.min(...sizes) > 2.2) return null;
  return corners.map((b, i) => ({ centre: centre(b), size: sizes[i], hollow: isHollow(image, b) }));
}
