/**
 * Parser Registry
 * The local document parsers the processing service uses, one per file type
 * (PDF, XLSX, CSV, TXT). Each parser's code — pdf.js, SheetJS, Papa Parse —
 * is loaded on first use, so none of it weighs down the app's startup. Bump a
 * parser's `version` here whenever its output changes, so cached extractions
 * are redone.
 */

import type { DocumentParser, ParseFn } from "@/core/processing/processing.service";
import type { FileKind } from "@/types/domain";

function lazyParser(id: string, version: number, kinds: FileKind[], load: () => Promise<ParseFn>): DocumentParser {
  return {
    id,
    version,
    kinds,
    async parse(input, context) {
      const parse = await load();
      context.signal.throwIfAborted();
      return parse(input, context);
    },
  };
}

export const documentParsers: DocumentParser[] = [
  lazyParser("pdfjs", 1, ["pdf"], async () => (await import("./pdf.parser")).parsePdf),
  lazyParser("xlsx", 1, ["xlsx"], async () => (await import("./xlsx.parser")).parseXlsx),
  lazyParser("csv", 1, ["csv"], async () => (await import("./csv.parser")).parseCsv),
  lazyParser("text", 1, ["txt"], async () => (await import("./text.parser")).parseText),
];

const PROCESSABLE_KINDS = new Set<FileKind>(documentParsers.flatMap((parser) => parser.kinds));

/** True if Salin can extract data from this file type. */
export function isProcessable(kind: FileKind | undefined): kind is FileKind {
  return kind !== undefined && PROCESSABLE_KINDS.has(kind);
}
