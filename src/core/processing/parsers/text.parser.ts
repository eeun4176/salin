/**
 * Text Parser
 * Reads a plain-text (.txt) file as a single page of text. Structuring then
 * turns each non-empty line into a row.
 */

import { ProcessingError } from "@/core/processing/processing-errors";
import type { ParseFn } from "@/core/processing/processing.service";

import { MAX_TEXT_CHARACTERS, readText } from "./parser-helpers";

export const parseText: ParseFn = async ({ file, blob }, { onProgress }) => {
  const text = await readText(blob, file.name);
  if (text.length > MAX_TEXT_CHARACTERS) throw new ProcessingError("parse-failed", `"${file.name}" contains too much text to process safely.`);
  onProgress(1);
  return { pages: [{ number: 1, text }], tables: [], warnings: [] };
};
