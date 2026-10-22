/**
 * OCR Runner
 * Reads a scan's pages, one by one, entirely on the device: makes each
 * page's prepared image (reusing it when the edits haven't changed),
 * straightens sideways or upside-down pages automatically, runs OCR in the
 * engine's worker, analyses the layout, and saves the results — so pages
 * already read aren't read again. Supports progress, cancellation (stops at
 * once) and retrying only failed pages; a page that fails doesn't stop the
 * others. A scan can't be read twice at the same time. A printed census
 * sheet is recognised first by its corner markers: it's flattened to the
 * sheet layout, its boxes are read by OMR, and OCR reads only the
 * handwriting in its letter boxes, one box (one character) at a time.
 */

import { letterBoxGroups, linesFromLetterBoxes, sheetLetterRows } from "@/core/census/census-extraction";
import { prepareImage, readCensusSheet } from "@/core/ocr/imaging/imaging-client";
import type { CensusImage, PreparedImage } from "@/core/ocr/imaging/imaging-ops";
import { UnreadableImageError } from "@/core/ocr/imaging/image-io";
import { aiRuntime } from "@/core/ai/ai-runtime";
import { ocrRuntime } from "@/core/ocr/engine/ocr-runtime";
import type { EngineConfig } from "@/core/ocr/engine/ocr-engine";
import { analyzeLayout } from "@/core/ocr/layout/layout-analysis";
import { ModelError } from "@/core/ocr/models/model-manager";
import { errorMessage } from "@/core/storage/errors";
import { getOcrPages, updateOcrPage } from "@/core/storage/repositories/ocr.repository";
import { cropLines } from "@/features/ai/line-crops";
import { pageSource, sourceKey } from "@/features/ocr/page-sources";
import { handwritingReaderInstalled } from "@/stores/ai-store";
import type { OcrPage, OcrPageResult, OcrProfileId, PageEdits, PageMarks, QuarterTurn } from "@/types/ocr";

export type ReadStage = "preparing" | "starting" | "reading" | "analysing";

export interface ReadProgress {
  /** 0-based index of the page being read, among the pages being read. */
  index: number;
  count: number;
  pageId: string;
  stage: ReadStage;
  /** 0–1 across all pages being read. */
  fraction: number;
  /** Engine start-up message, when starting. */
  detail?: string;
}

export interface ReadOutcome {
  read: number;
  failed: number;
  cancelled: boolean;
  /** A problem that stopped every page (e.g. model files missing offline). */
  fatal: string | null;
}

export interface ReadOptions {
  config: EngineConfig;
  /** Only these pages (retry); default: every page not read yet with these settings. */
  pageIds?: string[];
  /** Read again even if a page already has a result. */
  force?: boolean;
  onProgress?: (progress: ReadProgress) => void;
}

const running = new Map<string, { controller: AbortController; promise: Promise<ReadOutcome> }>();

export const isReading = (documentId: string) => running.has(documentId);

export function cancelReading(documentId: string) {
  running.get(documentId)?.controller.abort();
}

/** Below this confidence, the page is also tried upside down. */
const FLIP_BELOW = 55;

function rotate(edits: PageEdits, turns: QuarterTurn): PageEdits {
  // A crop is relative to the rotated image, so it doesn't survive an automatic turn.
  return { ...edits, rotation: (((edits.rotation + turns) % 360) as QuarterTurn), crop: turns === 0 ? edits.crop : null };
}

const processedKeyOf = (source: string, edits: PageEdits, profile: OcrProfileId) => `${source}|${profile}|${JSON.stringify(edits)}`;
const CENSUS_KEY = "census|";
const resultKeyOf = (processedKey: string, config: EngineConfig) => `${processedKey}|${config.core.id}|${[...config.languages].sort().join("+")}`;

/** The page's prepared image for these edits (reused when it's up to date). */
async function prepared(page: OcrPage, source: Blob, key: string, edits: PageEdits, profile: OcrProfileId, signal: AbortSignal): Promise<PreparedImage> {
  if (page.processed && page.processedKey === key && page.marks) return { blob: page.processed, width: page.width, height: page.height, marks: page.marks };
  return prepareImage(source, edits, profile, signal);
}

const score = (r: Pick<OcrPageResult, "confidence" | "lines">) => r.confidence * r.lines.reduce((n, l) => n + l.words.length, 0);

/**
 * A census sheet: OCR reads each written-in letter box of the handwriting-only
 * copy as one character (only letters, or only digits, as the box allows);
 * the flattened sheet is what review shows.
 */
/**
 * The handwriting reader on every written row of the sheet (one character per
 * letter box; open lines whole), as OCR lines — or `null` when it isn't
 * installed or can't run, so printed-text OCR reads instead.
 */
async function readWithHandwritingReader(census: CensusImage, signal: AbortSignal, report: (stage: ReadStage, fraction: number, detail?: string) => void) {
  if (!(await handwritingReaderInstalled())) return null;
  const rows = sheetLetterRows(census.read);
  if (!rows.length) return [];
  try {
    // Tesseract and the reader never sit in memory together (phones).
    await ocrRuntime.shutdown();
    const crops = await cropLines(census.handwriting, rows.map((r) => r.box), rows.map((r) => r.slots), rows.map((r) => (r.slots.length ? undefined : r.allowed)), rows.map((r) => r.gaps));
    const read = () => aiRuntime.readLines(crops, { signal, onProgress: (p) => report("reading", 0.2 + (p.fraction ?? 0) * 0.7) });
    // A stalled worker is stopped by the runtime's watchdog; one fresh try before giving up.
    const readings = await read().catch((error: unknown) => {
      if (signal.aborted) throw error;
      return read();
    });
    return rows.map((row, i) => {
      const word = { text: readings[i].text, confidence: Math.round(readings[i].confidence * 100), box: row.box, unclear: "" };
      return { text: word.text, confidence: word.confidence, box: row.box, block: 0, words: [word] };
    });
  } catch (error) {
    if (signal.aborted) throw error;
    console.error(error);
    return null;
  }
}

async function readCensusPage(page: OcrPage, census: CensusImage, key: string, options: ReadOptions, signal: AbortSignal, report: (stage: ReadStage, fraction: number, detail?: string) => void) {
  const marks: PageMarks = { horizontal: [], vertical: [], checkboxes: [], inkRatio: 1, skew: 0, sideways: false };
  const started = performance.now();
  let lines = await readWithHandwritingReader(census, signal, report);
  const byReader = lines !== null;
  if (!lines) {
    const groups = letterBoxGroups(census.read);
    const reads = [];
    for (const [i, group] of groups.entries()) {
      report("reading", 0.2 + (i / groups.length) * 0.7);
      reads.push(await ocrRuntime.readRegions(census.handwriting, group.boxes, group.allowed, options.config, { signal, onStatus: (status, p) => report("starting", 0.2, `${status} ${Math.round(p * 100)}%`) }));
    }
    lines = linesFromLetterBoxes(groups, reads);
  }
  const read = lines.filter((l) => l.text);
  const result: Omit<OcrPageResult, "width" | "height" | "autoRotated"> = {
    engine: byReader ? "PP-OCRv5 handwriting reader · census sheet" : "tesseract.js 7 · letter boxes",
    profile: options.config.profile,
    languages: options.config.languages,
    lines,
    text: read.map((l) => l.text).join(""),
    confidence: read.length ? Math.round(read.reduce((n, l) => n + l.confidence, 0) / read.length) : 0,
    status: "ok",
    durationMs: Math.round(performance.now() - started),
  };
  report("analysing", 0.95);
  const { width, height } = census;
  await updateOcrPage(page.id, {
    processed: census.sheet,
    processedKey: key,
    width,
    height,
    marks,
    result: { ...result, width, height, autoRotated: 0 },
    resultKey: resultKeyOf(key, options.config),
    layout: analyzeLayout({ width, height, lines: result.lines, marks }),
    census: census.read,
    handwriting: census.handwriting,
    state: "done",
    error: null,
  });
}

async function readOne(page: OcrPage, options: ReadOptions, signal: AbortSignal, report: (stage: ReadStage, fraction: number, detail?: string) => void) {
  const { config } = options;
  const profile = config.profile;
  report("preparing", 0);
  const source = await pageSource(page);
  const sKey = await sourceKey(page);
  // Printed census sheets first: their markers say exactly where every box is.
  const census = await readCensusSheet(source, page.edits.rotation, signal).catch((error: unknown) => {
    if (signal.aborted) throw error;
    return null;
  });
  if (census) return readCensusPage(page, census, CENSUS_KEY + processedKeyOf(sKey, page.edits, profile), options, signal, report);

  let edits = page.edits;
  let key = processedKeyOf(sKey, edits, profile);
  let image = await prepared(page, source, key, edits, profile, signal);
  let autoRotated: QuarterTurn = 0;

  const read = (img: PreparedImage, base: number, share: number) =>
    ocrRuntime.readPage(img.blob, img.marks, config, {
      signal,
      onStatus: (status, p) => report("starting", base, `${status} ${Math.round(p * 100)}%`),
      onProgress: (f) => report("reading", base + f * share),
    });

  let result = await read(image, 0.1, 0.5);
  // Text that seems to run top-to-bottom, or a poor read: try the page turned, and keep
  // whichever way reads clearly better (noise can fool the sideways check, so it's verified).
  const turns: QuarterTurn[] = [];
  if (image.marks.sideways) turns.push(90, 270);
  if (result.status !== "blank" && result.confidence < FLIP_BELOW) turns.push(180);
  for (const [i, turn] of turns.entries()) {
    const turnedEdits = rotate(page.edits, turn);
    const turned = await prepareImage(source, turnedEdits, profile, signal);
    const second = await read(turned, 0.6 + (i * 0.3) / turns.length, 0.3 / turns.length);
    if (score(second) > score(result) * 1.2) {
      result = second;
      edits = turnedEdits;
      image = turned;
      key = processedKeyOf(sKey, edits, profile);
      autoRotated = turn;
    }
  }

  report("analysing", 0.95);
  const layout = analyzeLayout({ width: image.width, height: image.height, lines: result.lines, marks: image.marks });
  await updateOcrPage(page.id, {
    edits,
    census: null,
    handwriting: null,
    processed: image.blob,
    processedKey: key,
    width: image.width,
    height: image.height,
    marks: image.marks,
    result: { ...result, width: image.width, height: image.height, autoRotated },
    resultKey: resultKeyOf(key, config),
    layout,
    state: "done",
    error: null,
  });
}

/** Has this page already been read with these settings? */
async function upToDate(page: OcrPage, config: EngineConfig) {
  if (page.state !== "done" || !page.result || !page.resultKey) return false;
  // Pages turned automatically keep their result (its key includes the turned edits).
  const key = processedKeyOf(await sourceKey(page), page.edits, config.profile);
  return page.resultKey === resultKeyOf(key, config) || page.resultKey === resultKeyOf(CENSUS_KEY + key, config);
}

/**
 * Reads the scan's pages. Resolves when done, cancelled or stopped by a
 * fatal problem; per-page failures are recorded on the pages.
 */
export function readDocument(documentId: string, options: ReadOptions): Promise<ReadOutcome> {
  const existing = running.get(documentId);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const promise = (async (): Promise<ReadOutcome> => {
    const outcome: ReadOutcome = { read: 0, failed: 0, cancelled: false, fatal: null };
    const all = await getOcrPages(documentId);
    const pages: OcrPage[] = [];
    for (const page of all) {
      if (options.pageIds && !options.pageIds.includes(page.id)) continue;
      if (!options.force && (await upToDate(page, options.config))) continue;
      pages.push(page);
    }
    // OCR and the AI models never sit in memory together (phones).
    if (pages.length) await aiRuntime.unload();
    for (const [index, page] of pages.entries()) {
      const report = (stage: ReadStage, fraction: number, detail?: string) =>
        options.onProgress?.({ index, count: pages.length, pageId: page.id, stage, fraction: (index + Math.min(1, fraction)) / pages.length, detail });
      try {
        await readOne(page, options, controller.signal, report);
        outcome.read++;
      } catch (error) {
        if (controller.signal.aborted) {
          await updateOcrPage(page.id, { state: "cancelled", error: null }).catch(() => {});
          outcome.cancelled = true;
          break;
        }
        // Missing model files or storage: every page would fail the same way.
        if (error instanceof ModelError) {
          outcome.fatal = error.message;
          break;
        }
        const message =
          error instanceof UnreadableImageError
            ? error.message
            : error instanceof Error && error.name === "PdfOpenError"
              ? error.message
              : errorMessage(error, "This page couldn't be read. Try again, or retake the photo.");
        console.error(error);
        await updateOcrPage(page.id, { state: "failed", error: message }).catch(() => {});
        outcome.failed++;
        if (/storage space/i.test(message)) {
          outcome.fatal = message;
          break;
        }
      }
    }
    return outcome;
  })().finally(() => running.delete(documentId));
  running.set(documentId, { controller, promise });
  return promise;
}

/**
 * Rebuilds a page's prepared image when it's missing (e.g. after restoring a
 * backup, which leaves images out). The same edits give the same image, so
 * the stored recognition result still lines up — nothing is read again.
 */
export async function ensureProcessed(page: OcrPage): Promise<Blob | null> {
  if (page.processed) return page.processed;
  if (!page.result) return null;
  const source = await pageSource(page);
  if (page.census) {
    const census = await readCensusSheet(source, page.edits.rotation);
    if (!census) return null;
    await updateOcrPage(page.id, { processed: census.sheet, width: census.width, height: census.height });
    return census.sheet;
  }
  const image = await prepareImage(source, page.edits, page.result.profile);
  await updateOcrPage(page.id, { processed: image.blob, width: image.width, height: image.height });
  return image.blob;
}
