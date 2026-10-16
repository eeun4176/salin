import { create } from "zustand";

import type { FileKind } from "@/features/workspace/types";

export interface IntakeFile {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: FileKind;
  source: "scan" | "import";
  /** Object URL for image previews; revoked when the file is discarded. */
  previewUrl: string | null;
}

const EXTENSION_KINDS: Record<string, FileKind> = {
  pdf: "pdf",
  xlsx: "xlsx",
  csv: "csv",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  webp: "webp",
};

/** `accept` attribute for every supported import format (docs 5.2). */
export const ACCEPT_ATTR =
  ".pdf,.xlsx,.csv,.png,.jpg,.jpeg,.webp,application/pdf,text/csv,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function detectKind(name: string): FileKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_KINDS[ext] ?? null;
}

export type IntakeResult = { ok: IntakeFile[]; rejected: { name: string; reason: string }[] };

/** Validates type and size up front — imported files are untrusted input (docs 11). */
export function toIntakeFiles(files: Iterable<File>, source: IntakeFile["source"]): IntakeResult {
  const result: IntakeResult = { ok: [], rejected: [] };
  for (const file of files) {
    const kind = detectKind(file.name);
    if (!kind) {
      result.rejected.push({ name: file.name, reason: "Unsupported file type" });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      result.rejected.push({ name: file.name, reason: "Larger than 50 MB" });
      continue;
    }
    const isImage = kind === "png" || kind === "jpg" || kind === "webp";
    result.ok.push({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      kind,
      source,
      previewUrl: isImage ? URL.createObjectURL(file) : null,
    });
  }
  return result;
}

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

const revoke = (file: IntakeFile | undefined) => {
  if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
};

export const useIntakeStore = create<IntakeState>()((set, get) => ({
  queue: [],
  attachments: [],
  enqueue: (files) => set((s) => ({ queue: [...s.queue, ...files] })),
  dequeue: (id) =>
    set((s) => {
      revoke(s.queue.find((f) => f.id === id));
      return { queue: s.queue.filter((f) => f.id !== id) };
    }),
  clearQueue: () =>
    set((s) => {
      s.queue.forEach(revoke);
      return { queue: [] };
    }),
  queueToAttachments: () => set((s) => ({ attachments: [...s.attachments, ...s.queue], queue: [] })),
  attach: (files) => set((s) => ({ attachments: [...s.attachments, ...files] })),
  detach: (id) =>
    set((s) => {
      revoke(s.attachments.find((f) => f.id === id));
      return { attachments: s.attachments.filter((f) => f.id !== id) };
    }),
  takeAttachments: () => {
    const taken = get().attachments;
    set({ attachments: [] });
    return taken;
  },
}));
