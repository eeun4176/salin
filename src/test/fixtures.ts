/**
 * Test Fixtures
 * Helpers for building import entries and reading the raw database state in
 * storage tests.
 */

import { db } from "@/core/storage/database";
import type { ImportEntry } from "@/core/storage/repositories/file-repository";
import type { FileKind } from "@/types/domain";

const MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
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
