/**
 * Line Crops
 * Cuts the regions of form fields and table cells out of a prepared page
 * image and scales each to the 48-pixel line height the handwriting
 * recognizer reads. Ruled cells are trimmed slightly so their border lines
 * aren't read as letters. Letter boxes in a crop (census sheets) are passed
 * along as positions across it, so the reader takes one character per box.
 * Runs on the main thread (the crops are tiny); the pixels are then handed
 * to the AI worker.
 */

import { LINE_HEIGHT, lineWidth, type LineSlot } from "@/core/ai/handwriting";
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

/** Letter boxes inside a crop, in page pixels. */
export type SlotBoxes = { box: Box; allowed: string; spaceBefore: boolean }[];

/** The regions as full-resolution PNG data URLs (for the City Vet server, which reads its own sizes). */
export async function cropImages(page: Blob, boxes: Box[]): Promise<string[]> {
  const bitmap = await createImageBitmap(page);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    return boxes.map((box) => {
      const r = inset(box, bitmap.width, bitmap.height);
      canvas.width = r.width;
      canvas.height = r.height;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, r.width, r.height);
      ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      return canvas.toDataURL("image/png");
    });
  } finally {
    bitmap.close();
  }
}

/** `slots`: letter boxes per crop (one character each); `allowed`: the characters an open line may hold. */
export async function cropLines(page: Blob, boxes: Box[], slots: (SlotBoxes | undefined)[] = [], allowed: (string | undefined)[] = [], gaps: (number[] | undefined)[] = []): Promise<LineCrop[]> {
  const bitmap = await createImageBitmap(page);
  try {
    const canvas = document.createElement("canvas");
    canvas.height = LINE_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    return boxes.map((box, n) => {
      const r = inset(box, bitmap.width, bitmap.height);
      const across = (x: number) => Math.min(1, Math.max(0, (x - r.x) / r.width));
      const lineSlots: LineSlot[] | undefined = slots[n]?.map((s) => ({ from: across(s.box.x), to: across(s.box.x + s.box.width), allowed: s.allowed, spaceBefore: s.spaceBefore }));
      const width = lineWidth(r.width, r.height);
      canvas.width = width;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, LINE_HEIGHT);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, width, LINE_HEIGHT);
      const lineGaps = gaps[n]?.map(across);
      return { pixels: ctx.getImageData(0, 0, width, LINE_HEIGHT).data, width, ...(lineSlots?.length ? { slots: lineSlots } : {}), ...(allowed[n] ? { allowed: allowed[n] } : {}), ...(lineGaps?.length ? { gaps: lineGaps } : {}) };
    });
  } finally {
    bitmap.close();
  }
}
