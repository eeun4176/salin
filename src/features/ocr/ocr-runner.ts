/**
 * OCR Runner
 * Reads a scan's pages, one by one, entirely on the device: makes each
 * page's prepared image (reusing it when the edits haven't changed),
 * straightens sideways or upside-down pages automatically, runs OCR in the
 * engine's worker, analyses the layout, and saves the results — so pages
 * already read aren't read again. Supports progress, cancellation (stops at
 * once) and retrying only failed pages; a page that fails doesn't stop the
 * others. A scan can't be read twice at the same time.
 */

import { prepareImage } from "@/core/ocr/imaging/imaging-client";
import type { PreparedImage } from "@/core/ocr/imaging/imaging-ops";
import { UnreadableImageError } from "@/core/ocr/imaging/image-io";
import { aiRuntime } from "@/core/ai/ai-runtime";
import { ocrRuntime } from "@/core/ocr/engine/ocr-runtime";
import type { EngineConfig } from "@/core/ocr/engine/ocr-engine";
import { analyzeLayout } from "@/core/ocr/layout/layout-analysis";
import { ModelError } from "@/core/ocr/models/model-manager";
import { errorMessage } from "@/core/storage/errors";
import { getOcrPages, updateOcrPage } from "@/core/storage/repositories/ocr.repository";
import { pageSource, sourceKey } from "@/features/ocr/page-sources";
import type { OcrPage, OcrPageResult, OcrProfileId, PageEdits, QuarterTurn } from "@/types/ocr";

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
const resultKeyOf = (processedKey: string, config: EngineConfig) => `${processedKey}|${config.core.id}|${[...config.languages].sort().join("+")}`;

/** The page's prepared image for these edits (reused when it's up to date). */
async function prepared(page: OcrPage, source: Blob, key: string, edits: PageEdits, profile: OcrProfileId, signal: AbortSignal): Promise<PreparedImage> {
  if (page.processed && page.processedKey === key && page.marks) return { blob: page.processed, width: page.width, height: page.height, marks: page.marks };
  return prepareImage(source, edits, profile, signal);
}

const score = (r: Pick<OcrPageResult, "confidence" | "lines">) => r.confidence * r.lines.reduce((n, l) => n + l.words.length, 0);

async function readOne(page: OcrPage, options: ReadOptions, signal: AbortSignal, report: (stage: ReadStage, fraction: number, detail?: string) => void) {
  const { config } = options;
  const profile = config.profile;
  report("preparing", 0);
  const source = await pageSource(page);
  const sKey = await sourceKey(page);
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
  return page.resultKey === resultKeyOf(key, config);
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
  const image = await prepareImage(source, page.edits, page.result.profile);
  await updateOcrPage(page.id, { processed: image.blob, width: image.width, height: image.height });
  return image.blob;
}
