/**
 * Page Preparation Pipeline
 * Turns a page photo or scan into the image OCR reads: quarter turns, crop
 * with perspective correction, a resolution that keeps fine text readable,
 * shadow/lighting correction, contrast, noise removal (also switched on
 * automatically for grainy, speckled pages), automatic
 * straightening (deskew) and optional black-and-white — then finds ruling
 * lines and checkboxes in the result. The original image is never changed;
 * this returns a new one.
 */

import { estimateSkew, findCheckboxes, findRulingLines, inkRatio, looksSideways, speckDensity } from "@/core/ocr/imaging/analysis";
import {
  fitScale,
  flattenLighting,
  inkMask,
  maskToGray,
  median3,
  resizeGray,
  rotateGray,
  rotateQuarter,
  stretchContrast,
  toGray,
  warpPerspective,
  warpSize,
  type GrayImage,
  type RgbaImage,
} from "@/core/ocr/imaging/pixels";
import type { OcrProfileId, PageEdits, PageMarks, Point } from "@/types/ocr";

/** Long-side limits per OCR profile: enough pixels for small print without wasting memory. */
export const RESOLUTION: Record<OcrProfileId, { max: number; min: number }> = {
  standard: { max: 2200, min: 1400 },
  accurate: { max: 3000, min: 1800 },
};

/** Size of the quick previews shown while editing. */
export const PREVIEW_MAX_SIDE = 900;

/** Above this many specks per megapixel a page is treated as noisy and cleaned automatically. */
export const NOISY_SPECKS = 1500;

export const DEFAULT_EDITS: PageEdits = {
  rotation: 0,
  crop: null,
  deskew: true,
  enhance: { shadows: true, contrast: true, denoise: false, blackAndWhite: false },
};

export interface PreparedPage {
  image: GrayImage;
  marks: PageMarks;
}

/** Rotation, crop/perspective and scaling — the geometric part, done in one resampling step where possible. */
export function applyGeometry(source: RgbaImage, edits: PageEdits, limits: { max: number; min: number }): GrayImage {
  const gray = rotateQuarter(toGray(source), edits.rotation, 1);
  if (edits.crop) {
    const quad = edits.crop.map((p) => ({ x: p.x * (gray.width - 1), y: p.y * (gray.height - 1) })) as [Point, Point, Point, Point];
    const size = warpSize(quad);
    const scale = fitScale(size.width, size.height, limits.max, limits.min);
    return warpPerspective(gray, quad, Math.round(size.width * scale), Math.round(size.height * scale));
  }
  const scale = fitScale(gray.width, gray.height, limits.max, limits.min);
  return scale === 1 ? gray : resizeGray(gray, gray.width * scale, gray.height * scale);
}

/** Lighting, contrast and noise. */
export function applyEnhancements(image: GrayImage, enhance: PageEdits["enhance"]): GrayImage {
  let out = image;
  if (enhance.shadows) out = flattenLighting(out);
  if (enhance.contrast) out = stretchContrast(out);
  if (enhance.denoise) out = median3(out);
  return out;
}

/**
 * Prepares a page for OCR. `analyse: false` skips line/checkbox detection
 * (used for live previews).
 */
export function preparePage(source: RgbaImage, edits: PageEdits, limits: { max: number; min: number }, analyse = true): PreparedPage {
  let image = applyEnhancements(applyGeometry(source, edits, limits), edits.enhance);
  let mask = inkMask(image);
  // Grainy photos hide the text from OCR's layout step: remove the specks even if not asked to.
  let denoised = edits.enhance.denoise;
  if (!denoised && speckDensity(mask, image.width, image.height) > NOISY_SPECKS) {
    image = median3(image);
    mask = inkMask(image);
    denoised = true;
  }
  let skew = 0;
  if (edits.deskew) {
    skew = estimateSkew(mask, image.width, image.height);
    if (skew !== 0) {
      image = rotateGray(image, -skew);
      mask = inkMask(image);
    }
  }
  if (edits.enhance.blackAndWhite) image = maskToGray(mask, image.width, image.height);

  const marks: PageMarks = analyse
    ? {
        ...findRulingLines(mask, image.width, image.height),
        checkboxes: findCheckboxes(mask, image.width, image.height),
        inkRatio: inkRatio(mask),
        skew,
        sideways: looksSideways(mask, image.width, image.height),
        autoDenoised: denoised && !edits.enhance.denoise,
      }
    : { horizontal: [], vertical: [], checkboxes: [], inkRatio: inkRatio(mask), skew, sideways: false, autoDenoised: denoised && !edits.enhance.denoise };
  return { image, marks };
}
