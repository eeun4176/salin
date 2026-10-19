/**
 * Image Decode & Encode
 * Reads an image file into pixels (applying the photo's EXIF orientation,
 * and shrinking very large camera photos so phones don't run out of
 * memory) and writes pixels back to PNG/JPEG. Uses OffscreenCanvas inside
 * Web Workers and a normal canvas on the main thread.
 */

import { grayToRgba, type GrayImage, type RgbaImage } from "@/core/ocr/imaging/pixels";

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export const canUseOffscreen = () => typeof OffscreenCanvas !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (canUseOffscreen()) return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: AnyCanvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas 2D is not available.");
  return ctx;
}

export class UnreadableImageError extends Error {
  constructor() {
    super("This image can't be opened. It may be damaged or in an unsupported format.");
    this.name = "UnreadableImageError";
  }
}

/**
 * Decodes an image. EXIF orientation is applied (`imageOrientation:
 * "from-image"`), so phone photos come out upright. The longer side is
 * capped at `maxSide`.
 */
export async function decodeImage(blob: Blob, maxSide = 4800): Promise<RgbaImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new UnreadableImageError();
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = makeCanvas(width, height);
    const ctx = context(canvas);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}

export async function encodeGray(image: GrayImage, type: "image/png" | "image/jpeg" = "image/png", quality = 0.9): Promise<Blob> {
  const rgba = grayToRgba(image);
  const canvas = makeCanvas(image.width, image.height);
  context(canvas).putImageData(new ImageData(rgba.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed."))), type, quality));
}
