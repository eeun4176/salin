/**
 * Grounding
 * Checks that an AI suggestion is backed by the document: a value the
 * language model "extracted" must be found among the words OCR read on the
 * page (and that's where its source region comes from), and an OCR
 * correction must stay close to what was read — a fix of a few characters,
 * not a different value. Anything that fails is flagged "Not found on
 * page" and can't be saved without the reviewer explicitly choosing it.
 */

import { levenshtein, normalizeText } from "@/core/ocr/benchmark/accuracy";
import { union } from "@/core/ocr/layout/geometry";
import type { Box, OcrWord } from "@/types/ocr";

/** 1 = identical, 0 = nothing in common (character edit distance, case- and space-insensitive). */
export function textSimilarity(a: string, b: string) {
  const x = [...normalizeText(a)];
  const y = [...normalizeText(b)];
  const longest = Math.max(x.length, y.length);
  return longest ? 1 - levenshtein(x, y) / longest : 1;
}

/** A correction counts as grounded when it changes only a small part of what OCR read. */
export const CORRECTION_SIMILARITY = 0.6;
/** An extracted value counts as found on the page at this similarity to a run of words. */
export const FOUND_SIMILARITY = 0.82;

export function isCloseCorrection(original: string, suggested: string) {
  if (!original.trim() || !suggested.trim()) return false;
  return textSimilarity(original, suggested) >= CORRECTION_SIMILARITY;
}

export interface PageMatch {
  text: string;
  score: number;
  box: Box;
  confidence: number;
}

/**
 * The run of consecutive words (in reading order) that best matches `value`,
 * if it matches well enough to count as found on the page.
 */
export function findOnPage(value: string, words: OcrWord[]): PageMatch | null {
  const wanted = normalizeText(value);
  if (!wanted) return null;
  // Labels ("Name:", or glued as "Name:Juan") are never part of a value.
  const candidates = words.map((w) => ({ ...w, text: w.text.includes(":") ? w.text.slice(w.text.lastIndexOf(":") + 1) : w.text })).filter((w) => w.text.trim());
  const size = wanted.split(" ").length;
  let best: PageMatch | null = null;
  for (let start = 0; start < candidates.length; start++) {
    for (let n = Math.max(1, size - 1); n <= size + 1 && start + n <= candidates.length; n++) {
      const run = candidates.slice(start, start + n);
      const text = run.map((w) => w.text).join(" ");
      const score = textSimilarity(text, value);
      if (!best || score > best.score) best = { text, score, box: union(run.map((w) => w.box)), confidence: run.reduce((s, w) => s + w.confidence, 0) / run.length };
    }
  }
  return best && best.score >= FOUND_SIMILARITY ? best : null;
}
