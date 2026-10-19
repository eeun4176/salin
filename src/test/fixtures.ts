/**
 * Test Fixtures
 * Helpers for building import entries and dataset content, and reading the
 * raw database state in storage and processing tests.
 */

import { db } from "@/core/storage/database";
import type { ImportEntry } from "@/core/storage/repositories/file-repository";
import type { FileKind } from "@/types/domain";
import type { CellValue, DatasetColumn, DatasetContent } from "@/types/processing";

const MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export function entry(name: string, content = `contents of ${name}`, dirPath = ""): ImportEntry {
  const kind = (name.split(".").pop() ?? "pdf") as FileKind;
  return { blob: new Blob([content], { type: MIME[kind] }), name, kind, mimeType: MIME[kind], dirPath, source: "import" };
}

export async function counts() {
  return {
    folders: await db.folders.count(),
    files: await db.files.count(),
    blobs: await db.fileBlobs.count(),
  };
}

/** Text columns named `names`, plus rows given as arrays of cell values in column order. */
export function content(names: string[], cells: CellValue[][] = []): DatasetContent {
  const columns: DatasetColumn[] = names.map((name) => ({
    id: crypto.randomUUID(),
    name,
    type: "text",
    required: false,
    sourceHeader: name,
  }));
  return {
    columns,
    rows: cells.map((row) => ({ values: Object.fromEntries(columns.map((c, i) => [c.id, row[i] ?? null])), source: null })),
  };
}
