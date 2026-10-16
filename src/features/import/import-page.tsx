import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CheckCircle2, CloudUpload, FileUp, FolderInput, FolderUp, ShieldCheck, Sparkles, X } from "lucide-react";

import { PageFrame } from "@/components/layout/page-frame";
import { FILE_KIND_META } from "@/components/brand/file-kinds";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { useFilePicker, useQueueFiles } from "@/features/import/use-file-picker";
import { formatBytes } from "@/features/workspace/query";
import type { FileKind } from "@/features/workspace/types";
import { useIntakeStore } from "@/stores/intake-store";
import { cn } from "@/lib/utils";

const FORMATS: FileKind[] = ["pdf", "xlsx", "csv", "png", "jpg", "webp"];

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

/** Collects files from a drop, walking into dropped folders. */
async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  // Entries must be read synchronously, while the drop event is still live.
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0) return Array.from(dataTransfer.files);

  const files: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child);
    }
  };
  for (const entry of entries) await walk(entry);
  return files;
}

export function ImportPage() {
  const queue = useIntakeStore((s) => s.queue);
  const dequeue = useIntakeStore((s) => s.dequeue);
  const clearQueue = useIntakeStore((s) => s.clearQueue);
  const queueToAttachments = useIntakeStore((s) => s.queueToAttachments);
  const queueFiles = useQueueFiles();
  const { inputs, pickFiles, pickFolder } = useFilePicker(queueFiles);
  const navigate = useNavigate();
  const [dragging, setDragging] = useState(false);

  // The whole page is a drop target; the zone just shows it.
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void filesFromDrop(e.dataTransfer).then(queueFiles);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [queueFiles]);

  const totalBytes = queue.reduce((sum, f) => sum + f.size, 0);

  return (
    <PageFrame title="Import Files" description="Bring in documents, spreadsheets and images. Nothing is uploaded — files stay on this device.">
      {inputs}

      <div
        className={cn(
          "relative flex flex-col items-center rounded-3xl border-2 border-dashed px-5 py-10 text-center transition-[background-color,border-color,transform] duration-300 ease-out-soft md:py-14",
          dragging ? "scale-[1.01] border-salin-primary bg-salin-primary-soft motion-reduce:scale-100" : "border-[#CBD5CF] bg-salin-canvas",
        )}
      >
        <span
          className={cn(
            "grid size-16 place-items-center rounded-2xl bg-white text-salin-primary shadow-[0_8px_20px_-10px_rgb(1_168_90/0.5)] ring-1 ring-salin-border transition-transform duration-500 ease-spring motion-reduce:transition-none",
            dragging && "-translate-y-1.5",
          )}
        >
          <CloudUpload className="size-7" />
        </span>
        <p className="mt-5 text-lg font-semibold text-salin-text">{dragging ? "Drop to add files" : "Drag & drop files here"}</p>
        <p className="mt-1 text-sm text-salin-muted">
          <span className="hidden md:inline">Drop files or whole folders anywhere on this page, or browse.</span>
          <span className="md:hidden">Choose files or a folder from your device.</span>
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button type="button" onClick={pickFiles} className="press inline-flex h-11 items-center gap-2 rounded-xl bg-salin-primary px-5 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgb(1_168_90/0.6)] hover:bg-[#019A53]">
            <FileUp className="size-[18px]" /> Browse files
          </button>
          <button type="button" onClick={pickFolder} className="press inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile">
            <FolderUp className="size-[18px]" /> Upload a folder
          </button>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-1.5" aria-label="Supported formats: PDF, XLSX, CSV, PNG, JPG, WebP">
          {FORMATS.map((kind) => (
            <FileTypeIcon key={kind} kind={kind} className="size-9" />
          ))}
        </div>
        <p className="mt-2 text-xs text-salin-subtle">PDF, XLSX, CSV, PNG, JPG, WebP · up to 50 MB each</p>
      </div>

      {queue.length > 0 && (
        <section aria-labelledby="queue-heading" className="mt-7">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 id="queue-heading" className="font-semibold text-salin-text">Ready to process</h2>
              <p className="text-xs text-salin-muted">
                {queue.length} file{queue.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
              </p>
            </div>
            <button type="button" onClick={clearQueue} className="rounded-lg px-2 py-1 text-sm font-medium text-salin-muted hover:bg-salin-tile hover:text-salin-text">
              Clear all
            </button>
          </div>

          <ul className="mt-3 divide-y divide-salin-border rounded-2xl ring-1 ring-salin-border">
            {queue.map((file) => (
              <li key={file.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                {file.previewUrl ? (
                  <img src={file.previewUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-salin-border" />
                ) : (
                  <FileTypeIcon kind={file.kind} showLabel={false} className="size-10" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-salin-text" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-salin-muted">
                    {FILE_KIND_META[file.kind].name} · {formatBytes(file.size)}
                  </p>
                </div>
                <span className="hidden items-center gap-1 rounded-full bg-salin-primary-soft px-2 py-0.5 text-xs font-medium text-[#016A39] sm:inline-flex">
                  <CheckCircle2 className="size-3.5" /> Ready
                </span>
                <button
                  type="button"
                  onClick={() => dequeue(file.id)}
                  aria-label={`Remove ${file.name}`}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-salin-subtle hover:bg-salin-tile hover:text-salin-text"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              disabled
              title="Saving to folders arrives in Phase 2"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-salin-muted ring-1 ring-salin-border disabled:opacity-60"
            >
              <FolderInput className="size-[18px]" /> Save to Workspace
              <span className="rounded-md bg-salin-tile px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">Soon</span>
            </button>
            <button
              type="button"
              onClick={() => {
                queueToAttachments();
                navigate("/ai-studio");
              }}
              className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-salin-primary px-6 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgb(1_168_90/0.6)] hover:bg-[#019A53]"
            >
              <Sparkles className="size-[18px]" /> Ask Salin AI
            </button>
          </div>
        </section>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-salin-muted">
        <ShieldCheck className="size-4 text-salin-primary" /> Imported files are checked for type and size and never leave your device.
      </p>
    </PageFrame>
  );
}
