/**
 * Download Helper
 * Saves a Blob to the user's device under a given file name (used for file
 * and folder downloads, backups and CSV exports), and makes sure document
 * names keep an extension that matches their type.
 */

import type { FileKind } from "@/types/domain";

const EXTENSIONS: Record<FileKind, string[]> = {
  pdf: [".pdf"],
  xlsx: [".xlsx"],
  csv: [".csv"],
  txt: [".txt"],
  png: [".png"],
  jpg: [".jpg", ".jpeg"],
  webp: [".webp"],
};

/** "Census Form" (pdf) → "Census Form.pdf"; names that already end correctly are kept. */
export function withExtension(name: string, kind: FileKind) {
  const lower = name.toLowerCase();
  return EXTENSIONS[kind].some((ext) => lower.endsWith(ext)) ? name : `${name}${EXTENSIONS[kind][0]}`;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking right away can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
