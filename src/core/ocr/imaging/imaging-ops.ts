/**
 * Imaging Operations
 * The three jobs the page editor and OCR need — prepare a page for
 * recognition, make a quick preview of the edits, and find the page edges
 * in a photo. Shared by the imaging Web Worker and the main-thread fallback.
 */

import { detectDocumentQuad } from "@/core/ocr/imaging/analysis";
import { decodeImage, encodeGray } from "@/core/ocr/imaging/image-io";
import { PREVIEW_MAX_SIDE, preparePage, RESOLUTION } from "@/core/ocr/imaging/pipeline";
import { rotateQuarter, toGray } from "@/core/ocr/imaging/pixels";
import type { OcrProfileId, PageEdits, PageMarks, Quad, QuarterTurn } from "@/types/ocr";

export type ImagingRequest =
  | { op: "prepare"; blob: Blob; edits: PageEdits; profile: OcrProfileId }
  | { op: "preview"; blob: Blob; edits: PageEdits }
  | { op: "detect"; blob: Blob; rotation: QuarterTurn };

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  marks: PageMarks;
}

export interface PreviewImage {
  blob: Blob;
  width: number;
  height: number;
  skew: number;
}

export type ImagingResult = PreparedImage | PreviewImage | { quad: Quad | null };

export async function runImaging(request: ImagingRequest): Promise<ImagingResult> {
  if (request.op === "detect") {
    const rgba = await decodeImage(request.blob, 1200);
    const gray = rotateQuarter(toGray(rgba), request.rotation, 1);
    return { quad: detectDocumentQuad(gray)?.quad ?? null };
  }
  if (request.op === "preview") {
    // Decode small: previews only need screen resolution.
    const rgba = await decodeImage(request.blob, PREVIEW_MAX_SIDE * 2);
    const { image, marks } = preparePage(rgba, request.edits, { max: PREVIEW_MAX_SIDE, min: 300 }, false);
    return { blob: await encodeGray(image, "image/jpeg", 0.85), width: image.width, height: image.height, skew: marks.skew };
  }
  const limits = RESOLUTION[request.profile];
  // Keep some headroom over the target size so a tight crop still has enough detail.
  const rgba = await decodeImage(request.blob, Math.round(limits.max * 1.6));
  const { image, marks } = preparePage(rgba, request.edits, limits);
  return { blob: await encodeGray(image, "image/png"), width: image.width, height: image.height, marks };
}
