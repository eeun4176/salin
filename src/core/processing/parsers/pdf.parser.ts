/**
 * PDF Parser
 * Extracts the embedded text of a text-based PDF with pdf.js, page by page,
 * rebuilding lines from the position of each text fragment. Runs pdf.js in a
 * worker bundled with the app, so it works offline. Scanned (image-only)
 * pages have no text layer and are reported; reading them needs OCR.
 */

import * as pdfjs from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { ProcessingError } from "@/core/processing/processing-errors";
import type { ParseFn } from "@/core/processing/processing.service";
import type { ExtractedPage } from "@/types/processing";

import { assertDocumentSize } from "./parser-helpers";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Fragments whose baselines are within this many points share a line. */
const LINE_TOLERANCE = 2;

/** Orders text fragments top-to-bottom, left-to-right and joins them into lines. */
function pageText(items: TextItem[]) {
  const lines: { y: number; parts: { x: number; text: string }[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const [x, y] = [item.transform[4], item.transform[5]];
    let line = lines.find((l) => Math.abs(l.y - y) <= LINE_TOLERANCE);
    if (!line) lines.push((line = { y, parts: [] }));
    line.parts.push({ x, text: item.str.trim() });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(" "))
    .join("\n");
}

export const parsePdf: ParseFn = async ({ file, blob }, { signal, onProgress }) => {
  assertDocumentSize(blob, file.name);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new ProcessingError("parse-failed", `"${file.name}" isn't a valid PDF document.`);
  }

  // Text only: fonts are never loaded, and a damaged object doesn't stop the remaining pages.
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, stopAtErrors: false });
  const stop = () => void task.destroy();
  signal.addEventListener("abort", stop);
  try {
    const pdf = await task.promise;
    const pages: ExtractedPage[] = [];
    const blankPages: number[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = pageText(content.items.filter((item): item is TextItem => "str" in item));
      if (!text) blankPages.push(number);
      pages.push({ number, text });
      page.cleanup();
      onProgress(number / pdf.numPages);
    }
    if (blankPages.length === pages.length) {
      throw new ProcessingError("no-content", `"${file.name}" has no selectable text. It looks like a scan — use Read text (OCR) on it instead.`);
    }
    const warnings = blankPages.length
      ? [`${blankPages.length === 1 ? "Page" : "Pages"} ${blankPages.join(", ")} had no selectable text (likely scanned images).`]
      : [];
    return { pages, tables: [], warnings };
  } catch (error) {
    if (signal.aborted || error instanceof ProcessingError) throw error;
    if ((error as { name?: string }).name === "PasswordException") {
      throw new ProcessingError("parse-failed", `"${file.name}" is password-protected. Remove the password, then try again.`);
    }
    throw new ProcessingError("parse-failed", `"${file.name}" is damaged or couldn't be read as a PDF.`);
  } finally {
    signal.removeEventListener("abort", stop);
    await task.destroy();
  }
};
