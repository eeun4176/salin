/**
 * Line Crops
 * Cuts the regions of form fields and table cells out of a prepared page
 * image and scales each to the 48-pixel line height the handwriting
 * recognizer reads. Ruled cells are trimmed slightly so their border lines
 * aren't read as letters. Runs on the main thread (the crops are tiny); the
 * pixels are then handed to the AI worker.
 */

import { LINE_HEIGHT, lineWidth } from "@/core/ai/handwriting";
import type { LineCrop } from "@/core/ai/ai-runtime";
import type { Box } from "@/types/ocr";

/** Shrinks a box so the lines around a table cell or fill-in field stay outside it. */
function inset(box: Box, imageWidth: number, imageHeight: number): Box {
  const dx = Math.min(6, box.width * 0.05);
  const dy = Math.min(4, box.height * 0.08);
  const x = Math.max(0, Math.round(box.x + dx));
  const y = Math.max(0, Math.round(box.y + dy));
  return { x, y, width: Math.max(1, Math.min(imageWidth - x, Math.round(box.width - 2 * dx))), height: Math.max(1, Math.min(imageHeight - y, Math.round(box.height - 2 * dy))) };
}

export async function cropLines(page: Blob, boxes: Box[]): Promise<LineCrop[]> {
  const bitmap = await createImageBitmap(page);
  try {
    const canvas = document.createElement("canvas");
    canvas.height = LINE_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    return boxes.map((box) => {
      const r = inset(box, bitmap.width, bitmap.height);
      const width = lineWidth(r.width, r.height);
      canvas.width = width;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, LINE_HEIGHT);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, width, LINE_HEIGHT);
      return { pixels: ctx.getImageData(0, 0, width, LINE_HEIGHT).data, width };
    });
  } finally {
    bitmap.close();
  }
}
