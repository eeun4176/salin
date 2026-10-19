/**
 * File Thumbnails
 * Makes the preview shown on each file card from the file's real contents:
 * photos are scaled down, PDFs show their first page, CSV files their first
 * rows, Excel workbooks their main table (found by table detection on the
 * first visible sheet with data), and text files their first lines. Previews
 * are made in the background (two at a time), saved in IndexedDB per set of
 * bytes, and kept in memory for the session, so each file is rendered once;
 * a preview that fails isn't saved, so it's tried again next visit.
 */

import { getFileWithBlob } from "@/core/storage/repositories/file-repository";
import { getThumbnail, saveThumbnail } from "@/core/storage/repositories/thumbnail.repository";
import { parseCsvPreview } from "@/lib/csv";
import type { Thumbnail, WorkspaceFile } from "@/types/domain";

/** Bump when thumbnails should be regenerated (new look or better rendering). */
export const THUMBNAIL_VERSION = 2;
const WIDTH = 360;
/** PDF pages render wider, so their small print stays legible when the card crops to the top of the page. */
const PDF_WIDTH = 520;
const MAX_HEIGHT = 480;
const TABLE_ROWS = 10;
const TABLE_COLUMNS = 5;
/** Rows read per sheet when looking for a workbook's main table. */
const EXCEL_SCAN_ROWS = 120;
const TEXT_CHARS = 700;

/** What a card renders: an image URL, rows, text, or nothing (fall back to the drawing). */
export type ThumbnailView = { kind: "image"; url: string } | { kind: "table"; rows: string[][]; title?: string } | { kind: "text"; text: string } | { kind: "none" };

async function canvasToBlob(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) throw new Error("Canvas couldn't be encoded.");
  return blob;
}

function sizedCanvas(width: number, height: number) {
  const scale = Math.min(1, WIDTH / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.min(MAX_HEIGHT, Math.round(height * scale)));
  return { canvas, scale };
}

async function imageThumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const { canvas, scale } = sizedCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
    return canvasToBlob(canvas);
  } finally {
    bitmap.close();
  }
}

async function pdfThumbnail(blob: Blob) {
  const [pdfjs, { default: workerUrl }] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const page = await (await task.promise).getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.min(MAX_HEIGHT, Math.round(viewport.height));
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvasToBlob(canvas);
  } finally {
    await task.destroy();
  }
}

const clip = (rows: string[][]) => rows.slice(0, TABLE_ROWS).map((row) => row.slice(0, TABLE_COLUMNS).map((cell) => cell.slice(0, 40)));

/**
 * The workbook's main table: on the first visible sheet that has data, the
 * biggest table the detector finds (skipping hidden or empty sheets, titles
 * and notes), with its title. Falls back to the sheet's first filled rows.
 */
async function excelPreview(file: WorkspaceFile, blob: Blob): Promise<{ title?: string; rows: string[][] }> {
  const [{ readWorkbook }, { detectTables, extractTable }, { formatRange }] = await Promise.all([
    import("@/core/processing/excel/workbook-reader"),
    import("@/core/processing/excel/table-detection"),
    import("@/core/processing/excel/cell-range"),
  ]);
  const workbook = await readWorkbook(blob, file.name, { maxRows: EXCEL_SCAN_ROWS, maxSheets: 8, inspectPackage: false });
  const sheets = workbook.sheets.filter((s) => s.visibility === "visible" && !s.isChartSheet && s.used);
  for (const sheet of sheets) {
    const size = (t: { stats: { dataRows: number; columns: number } }) => t.stats.dataRows * t.stats.columns;
    const best = detectTables(sheet)
      .filter((t) => t.stats.dataRows > 0 && t.stats.columns > 1)
      .sort((a, b) => size(b) - size(a))[0];
    if (!best) continue;
    const table = extractTable(sheet, { sheet: sheet.name, range: formatRange(best.range), headerRows: best.headerRows });
    const rows = table.rows.filter((r) => r.some((v) => v.trim()));
    return { title: best.title ?? undefined, rows };
  }
  const sheet = sheets[0];
  if (!sheet?.used) return { rows: [] };
  const { s, e } = sheet.used;
  const rows: string[][] = [];
  for (let r = s.r; r <= e.r && rows.length < TABLE_ROWS; r++) {
    const row = sheet.cells[r]?.slice(s.c, e.c + 1) ?? [];
    if (row.some((v) => v.trim())) rows.push(row);
  }
  return { rows };
}

/** Makes a file's preview. `null` means it failed, so it isn't saved and is tried again next time. */
async function generate(file: WorkspaceFile): Promise<Thumbnail | null> {
  const base = { blobId: file.blobId, version: THUMBNAIL_VERSION };
  try {
    const { blob } = await getFileWithBlob(file.id);
    switch (file.kind) {
      case "png":
      case "jpg":
      case "webp":
        return { ...base, kind: "image", image: await imageThumbnail(blob) };
      case "pdf":
        return { ...base, kind: "image", image: await pdfThumbnail(blob) };
      case "csv":
        return { ...base, kind: "table", rows: clip(parseCsvPreview(await blob.slice(0, 64 * 1024).text(), TABLE_ROWS).rows) };
      case "xlsx": {
        const { title, rows } = await excelPreview(file, blob);
        return rows.length ? { ...base, kind: "table", rows: clip(rows), ...(title ? { title } : {}) } : { ...base, kind: "none" };
      }
      case "txt":
        return { ...base, kind: "text", text: (await blob.slice(0, TEXT_CHARS * 4).text()).slice(0, TEXT_CHARS) };
    }
  } catch (error) {
    console.warn(`No thumbnail for ${file.name}`, error);
  }
  return null;
}

/* ------------------------------------------------------------------
   Cache and queue
------------------------------------------------------------------- */

const views = new Map<string, ThumbnailView>();
const pending = new Map<string, Promise<ThumbnailView>>();
const queue: (() => void)[] = [];
let running = 0;
const CONCURRENCY = 2;

function toView(thumbnail: Thumbnail): ThumbnailView {
  switch (thumbnail.kind) {
    case "image":
      return { kind: "image", url: URL.createObjectURL(thumbnail.image) };
    case "table":
      return { kind: "table", rows: thumbnail.rows, title: thumbnail.title };
    case "text":
      return { kind: "text", text: thumbnail.text };
    default:
      return { kind: "none" };
  }
}

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running++;
      task()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < CONCURRENCY) start();
    else queue.push(start);
  });
}

/** Already-loaded view for these bytes, if any (no waiting). */
export function cachedThumbnail(blobId: string) {
  return views.get(blobId);
}

/** The card preview for a file: from memory, then IndexedDB, else generated and saved. */
export function loadThumbnail(file: WorkspaceFile): Promise<ThumbnailView> {
  const cached = views.get(file.blobId);
  if (cached) return Promise.resolve(cached);
  let promise = pending.get(file.blobId);
  if (!promise) {
    promise = (async () => {
      const stored = await getThumbnail(file.blobId);
      let thumbnail = stored?.version === THUMBNAIL_VERSION ? stored : undefined;
      if (!thumbnail) {
        const generated = await schedule(() => generate(file));
        // A full disk just means it's regenerated next time.
        if (generated) await saveThumbnail(generated).catch(() => {});
        thumbnail = generated ?? { blobId: file.blobId, version: THUMBNAIL_VERSION, kind: "none" };
      }
      const view = toView(thumbnail);
      views.set(file.blobId, view);
      return view;
    })().finally(() => pending.delete(file.blobId));
    pending.set(file.blobId, promise);
  }
  return promise;
}
