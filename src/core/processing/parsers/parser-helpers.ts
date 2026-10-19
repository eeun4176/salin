/**
 * Parser Helpers
 * Shared limits and checks for the document parsers: maximum document size
 * and table dimensions (so a huge file fails with a clear message instead of
 * freezing the tab), and text decoding that handles UTF-8, UTF-16 and legacy
 * Windows-1252 files.
 */

import { ProcessingError } from "@/core/processing/processing-errors";

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_TABLE_ROWS = 200_000;
export const MAX_TABLE_COLUMNS = 500;
export const MAX_TABLE_CELLS = 2_000_000;
export const MAX_TEXT_CHARACTERS = 20_000_000;

export function assertDocumentSize(blob: Blob, name: string) {
  if (blob.size > MAX_DOCUMENT_BYTES) {
    throw new ProcessingError("parse-failed", `"${name}" is larger than the 50 MB processing limit.`);
  }
}

/** Throws a readable error when a table is too large to process safely. */
export function assertTableSize(rows: number, columns: number, name: string) {
  if (rows > MAX_TABLE_ROWS) throw new ProcessingError("parse-failed", `"${name}" has more than ${MAX_TABLE_ROWS.toLocaleString()} rows.`);
  if (columns > MAX_TABLE_COLUMNS) throw new ProcessingError("parse-failed", `"${name}" has more than ${MAX_TABLE_COLUMNS} columns.`);
  if (rows * columns > MAX_TABLE_CELLS) throw new ProcessingError("parse-failed", `"${name}" contains too many cells to process safely.`);
}

/** Decodes UTF-8 (with or without BOM) and UTF-16; falls back to Windows-1252 for legacy files. */
export async function readText(blob: Blob, name: string) {
  assertDocumentSize(blob, name);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
  try {
    // TextDecoder drops a leading byte-order mark by default.
    return new TextDecoder(utf16 ?? "utf-8", { fatal: !utf16 }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
