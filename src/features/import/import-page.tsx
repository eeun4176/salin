/**
 * Import Page (/import)
 * Drag-and-drop or browse for files and whole folders, review the queue,
 * then Extract data (the files are saved to the workspace and read: photos
 * and PDFs with text recognition, spreadsheets and text as data), save
 * everything into a chosen workspace folder (folder structure is kept), or
 * hand the files to Ask Salin AI.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CheckCircle2, CloudUpload, FileUp, FolderInput, FolderUp, LoaderCircle, ShieldCheck, Sparkles, Table2, X } from "lucide-react";

import { PageFrame } from "@/components/layout/page-frame";
import { FILE_KIND_META } from "@/components/brand/file-kinds";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { errorMessage } from "@/core/storage/errors";
import { importFiles } from "@/core/storage/repositories/file-repository";
import { useFilePicker, useQueueFiles } from "@/features/import/use-file-picker";
import { OCR_KINDS, scanUrl, startScanFromIntake } from "@/features/ocr/ocr-actions";
import { chooseTablesUrl, datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { extractData } from "@/features/processing/processing-actions";
import { FolderPickerDialog } from "@/features/workspace/components/folder-picker-dialog";
import { formatBytes } from "@/features/workspace/query";
import type { FileKind } from "@/features/workspace/types";
import { folderUrl } from "@/features/workspace/use-open-item";
import { saveIntakeFiles } from "@/features/workspace/workspace-actions";
import { useIntakeStore, type PickedFile } from "@/stores/intake-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

const FORMATS: FileKind[] = ["pdf", "xlsx", "csv", "txt", "png", "jpg", "webp"];

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

/**
 * Collects files from a drop, walking into dropped folders and remembering
 * each file's folder path. Entries the browser can't read are counted and
 * skipped instead of failing the drop.
 */
async function filesFromDrop(dataTransfer: DataTransfer): Promise<{ files: PickedFile[]; unreadable: number }> {
  // Entries must be read synchronously, while the drop event is still live.
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0) {
    return { files: Array.from(dataTransfer.files, (file) => ({ file, folderPath: "" })), unreadable: 0 };
  }

  const files: PickedFile[] = [];
  let unreadable = 0;
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
      // fullPath is "/Folder/sub/name.pdf"; keep "Folder/sub".
      const folderPath = entry.fullPath.split("/").filter(Boolean).slice(0, -1).join("/");
      if (file) files.push({ file, folderPath });
      else unreadable += 1;
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[] | null>((resolve) => reader.readEntries(resolve, () => resolve(null)));
      if (batch === null) unreadable += 1;
      if (!batch?.length) break;
      for (const child of batch) await walk(child);
    }
  };
  for (const entry of entries) await walk(entry);
  return { files, unreadable };
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
  const [choosingFolder, setChoosingFolder] = useState(false);

  const [extracting, setExtracting] = useState(false);

  /** Saves the files to the workspace, then reads them: photos and PDFs with text recognition, the rest as data. */
  async function extract() {
    const intake = useIntakeStore.getState().queue;
    const scannable = intake.filter((f) => OCR_KINDS.has(f.kind)).length;
    if (scannable && scannable < intake.length) {
      toast("Extract photos and PDFs separately from spreadsheets and text files — remove one kind from the list.");
      return;
    }
    setExtracting(true);
    try {
      if (scannable) {
        const id = await startScanFromIntake(intake, null);
        if (id) {
          clearQueue();
          navigate(scanUrl(id));
        }
        return;
      }
      const { files } = await importFiles(
        intake.map((f) => ({ blob: f.file, name: f.name, kind: f.kind, mimeType: f.file.type, dirPath: f.folderPath, source: f.source })),
        null,
      );
      clearQueue();
      // Decided here: the workspace list may not show the new files yet.
      if (files.length === 1 && files[0].kind === "xlsx") navigate(chooseTablesUrl(files[0].id));
      else void extractData(files.map((f) => f.id), (id) => navigate(datasetUrl(id)));
    } catch (error) {
      toast(errorMessage(error, "The files couldn't be saved. Please try again."));
    } finally {
      setExtracting(false);
    }
  }

  async function saveTo(folderId: string | null) {
    const files = useIntakeStore.getState().queue;
    const saved = await saveIntakeFiles(files, folderId, { onOpen: () => navigate(folderUrl(folderId)) });
    if (saved === null) return;
    setChoosingFolder(false);
    clearQueue();
  }

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
      void filesFromDrop(e.dataTransfer).then(({ files, unreadable }) => {
        if (files.length) queueFiles(files);
        if (unreadable) toast(`Couldn't read ${unreadable} dropped item${unreadable === 1 ? "" : "s"}. Try Browse files instead.`);
      });
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
          dragging ? "scale-[1.01] border-salin-primary bg-salin-primary-soft motion-reduce:scale-100" : "border-salin-border-strong bg-salin-canvas",
        )}
      >
        <span
          className={cn(
            "grid size-16 place-items-center rounded-2xl bg-salin-surface text-salin-primary shadow-[0_8px_20px_-10px_rgb(1_168_90/0.5)] ring-1 ring-salin-border transition-transform duration-500 ease-spring motion-reduce:transition-none",
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
          <button type="button" onClick={pickFiles} className="press inline-flex h-11 items-center gap-2 rounded-xl bg-salin-primary px-5 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgb(1_168_90/0.6)] hover:bg-salin-primary-strong">
            <FileUp className="size-[18px]" /> Browse files
          </button>
          <button type="button" onClick={pickFolder} className="press inline-flex h-11 items-center gap-2 rounded-xl bg-salin-surface px-5 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile">
            <FolderUp className="size-[18px]" /> Upload a folder
          </button>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-1.5" aria-label="Supported formats: PDF, XLSX, CSV, TXT, PNG, JPG, WebP">
          {FORMATS.map((kind) => (
            <FileTypeIcon key={kind} kind={kind} className="size-9" />
          ))}
        </div>
        <p className="mt-2 text-xs text-salin-subtle">PDF, XLSX, CSV, TXT, PNG, JPG, WebP · up to 50 MB each</p>
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
                    {file.folderPath && <span className="hidden sm:inline"> · in {file.folderPath}</span>}
                  </p>
                </div>
                <span className="hidden items-center gap-1 rounded-full bg-salin-primary-soft px-2 py-0.5 text-xs font-medium text-salin-primary-ink sm:inline-flex">
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
              onClick={() => setChoosingFolder(true)}
              className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile"
            >
              <FolderInput className="size-[18px]" /> Save to Workspace
            </button>
            <button
              type="button"
              onClick={() => {
                queueToAttachments();
                navigate("/ai-studio");
              }}
              className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile"
            >
              <Sparkles className="size-[18px]" /> Ask Salin AI
            </button>
            <button
              type="button"
              onClick={() => void extract()}
              disabled={extracting}
              className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-salin-primary px-6 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgb(1_168_90/0.6)] hover:bg-salin-primary-strong disabled:opacity-50"
            >
              {extracting ? <LoaderCircle className="size-[18px] animate-spin" /> : <Table2 className="size-[18px]" />} Extract data
            </button>
          </div>
        </section>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-salin-muted">
        <ShieldCheck className="size-4 text-salin-primary" /> Imported files are checked for type and size and never leave your device.
      </p>
      <FolderPickerDialog
        open={choosingFolder}
        onOpenChange={setChoosingFolder}
        title={`Save ${queue.length} file${queue.length === 1 ? "" : "s"} to…`}
        confirmLabel="Save here"
        onConfirm={saveTo}
      />
    </PageFrame>
  );
}
