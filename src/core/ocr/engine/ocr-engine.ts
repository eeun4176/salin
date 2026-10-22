/**
 * OCR Engine Interface
 * The contract every on-device recognition engine implements, so the rest
 * of Salin doesn't depend on one library: start it with a profile and
 * languages, read an image (whole page, or sparse text for forms) into lines
 * and words with boxes and confidence, read one line of text in each of
 * given boxes (letter-box rows on printed forms), and shut it down. Also converts the
 * Tesseract result shape into Salin's OCR types.
 */

import type { Box, OcrLine, OcrProfileId } from "@/types/ocr";
import type { ModelAsset } from "@/core/ocr/models/model-assets";

export interface EngineConfig {
  profile: OcrProfileId;
  languages: string[];
  core: ModelAsset;
}

export const engineKey = (config: EngineConfig) => `${config.core.id}|${[...config.languages].sort().join("+")}`;

/** auto = full page layout; sparse = find as much scattered text as possible (forms with gaps). */
export type ReadMode = "auto" | "sparse";

export interface ReadOptions {
  mode: ReadMode;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

/** The text read in one box: "" when nothing allowed was recognised. */
export interface RegionRead {
  text: string;
  /** 0–100. */
  confidence: number;
}

export interface RawRecognition {
  lines: OcrLine[];
  text: string;
  /** Mean word confidence, 0–100. */
  confidence: number;
}

export interface OcrEngine {
  readonly key: string;
  readonly label: string;
  /** False once terminated (e.g. after a cancel); a new engine must be started. */
  readonly alive: boolean;
  read(image: Blob, options: ReadOptions): Promise<RawRecognition>;
  /** Reads one line of text inside each box (pixels) of the image, using only the `allowed` characters. */
  readRegions(image: Blob, boxes: Box[], allowed: string, signal?: AbortSignal): Promise<RegionRead[]>;
  terminate(): Promise<void>;
}

/** Status messages while an engine starts ("loading tesseract core", 0–1). */
export type EngineStatus = (status: string, progress: number) => void;

/* ------------------------------------------------------------------
   Tesseract → Salin
------------------------------------------------------------------- */

interface TessBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TessWord {
  text: string;
  confidence: number;
  bbox: TessBox;
  symbols?: { text: string; confidence: number }[];
}

interface TessBlock {
  paragraphs: { lines: { text: string; confidence: number; bbox: TessBox; words: TessWord[] }[] }[];
}

const toBox = (b: TessBox): Box => ({ x: b.x0, y: b.y0, width: Math.max(1, b.x1 - b.x0), height: Math.max(1, b.y1 - b.y0) });

/** Rule lines and dot leaders that OCR reads as "|", "___" or "....". */
const JUNK_WORD = /^[|_\-—–=~'"`.,•·]+$/;
/** Checkbox outlines that OCR reads as "[]", "[#]" or "[|". */
const BOX_GLYPH = /^[[(|][^A-Za-z0-9]{0,2}[\])|]?$/;

/** Characters below this confidence are listed as unclear. */
const UNCLEAR_SYMBOL = 60;

export function fromTesseract(blocks: TessBlock[] | null): RawRecognition {
  const lines: OcrLine[] = [];
  let sum = 0;
  let count = 0;
  (blocks ?? []).forEach((block, blockIndex) => {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const words = line.words
          .filter((w) => w.text.trim() !== "" && !JUNK_WORD.test(w.text.trim()) && !BOX_GLYPH.test(w.text.trim()))
          .map((w) => ({
            text: w.text.trim(),
            confidence: Math.round(w.confidence * 10) / 10,
            box: toBox(w.bbox),
            unclear: (w.symbols ?? [])
              .filter((s) => s.confidence < UNCLEAR_SYMBOL)
              .map((s) => s.text)
              .join(""),
          }));
        if (words.length === 0) continue;
        for (const w of words) {
          sum += w.confidence;
          count++;
        }
        const x0 = Math.min(...words.map((w) => w.box.x));
        const y0 = Math.min(...words.map((w) => w.box.y));
        const x1 = Math.max(...words.map((w) => w.box.x + w.box.width));
        const y1 = Math.max(...words.map((w) => w.box.y + w.box.height));
        lines.push({
          text: words.map((w) => w.text).join(" "),
          confidence: Math.round((words.reduce((s, w) => s + w.confidence, 0) / words.length) * 10) / 10,
          box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
          words,
          block: blockIndex,
        });
      }
    }
  });
  return { lines, text: lines.map((l) => l.text).join("\n"), confidence: count ? Math.round((sum / count) * 10) / 10 : 0 };
}
