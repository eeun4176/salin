/**
 * Page Sources
 * Gets the image each scan page starts from: an image file's own bytes, or
 * a PDF page rendered by PDF.js at about 200 dpi (enough for small print).
 * Rendered pages are stored with the scan page so they're made once and
 * work offline; the original PDF is never changed. Also counts PDF pages.
 */

import { db } from "@/core/storage/database";
import { getFileWithBlob } from "@/core/storage/repositories/file-repository";
import { updateOcrPage } from "@/core/storage/repositories/ocr.repository";
import type { OcrPage } from "@/types/ocr";

/** Long side of a rendered PDF page, in pixels. */
const PDF_RENDER_SIDE = 2400;

async function loadPdfjs() {
  const [pdfjs, { default: workerUrl }] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

export class PdfOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfOpenError";
  }
}

async function openPdf(blob: Blob) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    return { task, pdf: await task.promise };
  } catch (error) {
    await task.destroy();
    if ((error as { name?: string }).name === "PasswordException") throw new PdfOpenError("This PDF is password-protected. Remove the password, then try again.");
    throw new PdfOpenError("This PDF is damaged or couldn't be read.");
  }
}

export async function pdfPageCount(blob: Blob) {
  const { task, pdf } = await openPdf(blob);
  try {
    return pdf.numPages;
  } finally {
    await task.destroy();
  }
}

async function renderPdfPage(blob: Blob, pageNumber: number): Promise<Blob> {
  const { task, pdf } = await openPdf(blob);
  try {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_RENDER_SIDE / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!out) throw new Error("The page couldn't be rendered.");
    return out;
  } finally {
    await task.destroy();
  }
}

/** The image a page starts from (rendered and stored once for PDF pages). */
export async function pageSource(page: OcrPage): Promise<Blob> {
  if (page.source) return page.source;
  const { blob } = await getFileWithBlob(page.fileId);
  if (page.pdfPage === null) return blob;
  const rendered = await renderPdfPage(blob, page.pdfPage);
  await updateOcrPage(page.id, { source: rendered });
  return rendered;
}

/** Identifies a page's starting image (for knowing when a processed copy is out of date). */
export async function sourceKey(page: OcrPage) {
  const file = await db.files.get(page.fileId);
  return `${file?.blobId ?? page.fileId}#${page.pdfPage ?? 0}`;
}
