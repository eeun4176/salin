/**
 * CSV Parser
 * Reads a CSV file into one table with Papa Parse (delimiter detected
 * automatically; quoted fields, line breaks and Unicode handled). Rejects
 * files with broken quoting or beyond the size limits, and reports minor
 * row problems as warnings.
 */

import Papa from "papaparse";

import { ProcessingError } from "@/core/processing/processing-errors";
import type { ParseFn } from "@/core/processing/processing.service";

import { assertTableSize, readText } from "./parser-helpers";

export const parseCsv: ParseFn = async ({ file, blob }, { signal, onProgress }) => {
  const text = await readText(blob, file.name);
  signal.throwIfAborted();
  onProgress(0.3);

  const { data, errors } = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  if (errors.some((error) => error.code === "MissingQuotes" || error.code === "InvalidQuotes")) {
    throw new ProcessingError("parse-failed", `"${file.name}" has a quoted value that never closes, so its rows can't be read reliably.`);
  }
  // A trailing newline leaves one empty row behind.
  const rows = data.at(-1)?.length === 1 && data.at(-1)?.[0] === "" ? data.slice(0, -1) : data;
  assertTableSize(rows.length, rows.reduce((max, row) => Math.max(max, row.length), 0), file.name);
  onProgress(1);

  const minor = errors.length;
  return {
    pages: [],
    tables: rows.length ? [{ name: file.name, sheet: null, page: null, rows, firstRowNumber: 1 }] : [],
    warnings: minor ? [`${minor} row${minor === 1 ? " has" : "s have"} a different number of values than the header.`] : [],
  };
};
