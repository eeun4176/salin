/**
 * Intake Store
 * Files the user has picked but not yet saved: the Import screen's queue and
 * the AI Studio composer's attachments. Also validates incoming files (type,
 * size) and remembers each file's folder path from folder uploads so the
 * structure can be recreated when it is saved to the workspace.
 */

import { create } from "zustand";

import type { FileKind } from "@/types/domain";

export interface IntakeFile {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: FileKind;
  source: "scan" | "import";
  /** Folder path inside an uploaded folder ("Census/Batch 1"), or "" for a loose file. */
  folderPath: string;
  /** Object URL for image previews; revoked when the file is discarded. */
  previewUrl: string | null;
}

/** A file plus where it sat inside an uploaded or dropped folder. */
export interface PickedFile {
  file: File;
  folderPath: string;
}

const EXTENSION_KINDS: Record<string, FileKind> = {
  pdf: "pdf",
  xlsx: "xlsx",
  csv: "csv",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
};

/** What each way in takes: imports (workspace, Import, AI Studio) take all five kinds; scans take photos and PDFs of paper forms. */
const SOURCE_KINDS: Record<IntakeFile["source"], { kinds: FileKind[]; reason: string }> = {
  import: { kinds: ["pdf", "xlsx", "csv", "png", "jpg"], reason: "Use a PDF, XLSX, CSV, PNG or JPG file" },
  scan: { kinds: ["png", "jpg", "pdf"], reason: "Not a photo or PDF" },
};

/** `accept` attribute for imports: PDF, XLSX, CSV, PNG and JPG. */
export const ACCEPT_ATTR = ".pdf,.xlsx,.csv,.png,.jpg,.jpeg,application/pdf,text/csv,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** `accept` attribute for scans: JPG, PNG and PDF. */
export const SCAN_ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Operating-system clutter inside uploaded folders; skipped without a warning.
const SYSTEM_FILES = new Set(["thumbs.db", "desktop.ini"]);

export function detectKind(name: string): FileKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_KINDS[ext] ?? null;
}

/** Folder path from an `<input webkitdirectory>` file ("Census/Batch 1/a.pdf" → "Census/Batch 1"). */
export function folderPathOf(file: File) {
  const relative = file.webkitRelativePath ?? "";
  const cut = relative.lastIndexOf("/");
  return cut === -1 ? "" : relative.slice(0, cut);
}

export type IntakeResult = { ok: IntakeFile[]; rejected: { name: string; reason: string }[] };

/** Validates type and size up front — imported files are untrusted input (docs 11). */
export function toIntakeFiles(files: Iterable<File | PickedFile>, source: IntakeFile["source"]): IntakeResult {
  const result: IntakeResult = { ok: [], rejected: [] };
  for (const entry of files) {
    const { file, folderPath } = entry instanceof File ? { file: entry, folderPath: folderPathOf(entry) } : entry;
    if (file.name.startsWith(".") || SYSTEM_FILES.has(file.name.toLowerCase())) continue;
    const kind = detectKind(file.name);
    if (!kind || !SOURCE_KINDS[source].kinds.includes(kind)) {
      result.rejected.push({ name: file.name, reason: SOURCE_KINDS[source].reason });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      result.rejected.push({ name: file.name, reason: "Larger than 50 MB" });
      continue;
    }
    const isImage = kind === "png" || kind === "jpg";
    result.ok.push({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      kind,
      source,
      folderPath,
      previewUrl: isImage ? URL.createObjectURL(file) : null,
    });
  }
  return result;
}

export const revokePreview = (file: IntakeFile | undefined) => {
  if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
};

interface IntakeState {
  /** Files waiting on the Import screen. */
  queue: IntakeFile[];
  /** Files attached to the AI Studio composer. */
  attachments: IntakeFile[];
  enqueue: (files: IntakeFile[]) => void;
  dequeue: (id: string) => void;
  clearQueue: () => void;
  /** Moves every queued file into the AI Studio composer. */
  queueToAttachments: () => void;
  attach: (files: IntakeFile[]) => void;
  detach: (id: string) => void;
  /** Hands attachments over to a sent message (previews stay alive with the message). */
  takeAttachments: () => IntakeFile[];
}

export const useIntakeStore = create<IntakeState>()((set, get) => ({
  queue: [],
  attachments: [],
  enqueue: (files) => set((s) => ({ queue: [...s.queue, ...files] })),
  dequeue: (id) =>
    set((s) => {
      revokePreview(s.queue.find((f) => f.id === id));
      return { queue: s.queue.filter((f) => f.id !== id) };
    }),
  clearQueue: () =>
    set((s) => {
      s.queue.forEach(revokePreview);
      return { queue: [] };
    }),
  queueToAttachments: () => set((s) => ({ attachments: [...s.attachments, ...s.queue], queue: [] })),
  attach: (files) => set((s) => ({ attachments: [...s.attachments, ...files] })),
  detach: (id) =>
    set((s) => {
      revokePreview(s.attachments.find((f) => f.id === id));
      return { attachments: s.attachments.filter((f) => f.id !== id) };
    }),
  takeAttachments: () => {
    const taken = get().attachments;
    set({ attachments: [] });
    return taken;
  },
}));
