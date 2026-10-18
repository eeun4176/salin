/**
 * File Preview
 * Full-screen viewer for a stored file, opened via the `?preview=<fileId>`
 * URL parameter. Shows images, PDFs (browser viewer, with an "Open" fallback
 * on phones), and the first rows of CSV files; Excel workbooks get a download
 * card until spreadsheet tools arrive in Phase 3.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Download, ExternalLink, FileWarning, LoaderCircle, X } from "lucide-react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FILE_KIND_META } from "@/components/brand/file-kinds";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { errorMessage } from "@/core/storage/errors";
import { getFileWithBlob } from "@/core/storage/repositories/file-repository";
import { formatBytes, formatDate } from "@/features/workspace/query";
import { PREVIEW_PARAM, useClosePreview } from "@/features/workspace/use-open-item";
import { downloadItem } from "@/features/workspace/workspace-actions";
import { fileToItem } from "@/features/workspace/mappers";
import { parseCsvPreview, type CsvPreview } from "@/lib/csv";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkspaceFile } from "@/types/domain";

const CSV_PREVIEW_BYTES = 2 * 1024 * 1024;

type Loaded = { url: string; csv: CsvPreview | null } | { error: string };

function CsvTable({ csv }: { csv: CsvPreview }) {
  const [header, ...rows] = csv.rows;
  if (!header) return <p className="p-6 text-sm text-salin-muted">This file is empty.</p>;
  return (
    <div className="h-full overflow-auto" data-lenis-prevent="">
      <table className="min-w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-salin-canvas text-salin-muted shadow-[0_1px_0_var(--color-salin-border)]">
          <tr>
            {header.map((cell, i) => (
              <th key={i} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-salin-border">
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className="max-w-xs truncate px-3 py-1.5 text-salin-text" title={cell}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {csv.truncated && <p className="px-3 py-3 text-xs text-salin-muted">Showing the first {rows.length} rows. Download the file to see everything.</p>}
    </div>
  );
}

function PreviewContent({ file }: { file: WorkspaceFile }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    getFileWithBlob(file.id)
      .then(async ({ blob }) => {
        const csv = file.kind === "csv" ? parseCsvPreview(await blob.slice(0, CSV_PREVIEW_BYTES).text()) : null;
        if (cancelled) return;
        url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: file.mimeType }));
        setLoaded({ url, csv });
      })
      .catch((error: unknown) => !cancelled && setLoaded({ error: errorMessage(error, "This file couldn't be opened.") }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id, file.kind, file.mimeType]);

  if (!loaded) {
    return (
      <div className="grid h-full place-items-center text-sm text-salin-muted">
        <span className="flex items-center gap-2">
          <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> Opening…
        </span>
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <FileWarning className="size-8 text-salin-muted" />
        <p className="mt-3 font-semibold text-salin-text">Can't open this file</p>
        <p className="mt-1 max-w-sm text-sm text-salin-muted">{loaded.error}</p>
      </div>
    );
  }

  if (file.kind === "png" || file.kind === "jpg" || file.kind === "webp") {
    return (
      <div className="grid h-full place-items-center overflow-auto bg-[#0E1511]/[0.04] p-3" data-lenis-prevent="">
        <img src={loaded.url} alt={file.name} className="max-h-full max-w-full rounded-lg object-contain shadow-sm" />
      </div>
    );
  }

  if (file.kind === "csv" && loaded.csv) return <CsvTable csv={loaded.csv} />;

  // Phones (and browsers without a built-in PDF viewer) get a card instead of a blank frame.
  const inlinePdf = file.kind === "pdf" && navigator.pdfViewerEnabled !== false;
  if (inlinePdf) return <iframe src={loaded.url} title={file.name} className="size-full border-0 bg-white" />;

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <FileTypeIcon kind={file.kind} className="size-16" />
      <p className="mt-4 font-semibold text-salin-text">{file.kind === "pdf" ? "Open this PDF in your viewer" : "No preview for Excel workbooks yet"}</p>
      <p className="mt-1 max-w-sm text-sm text-salin-muted">
        {file.kind === "pdf"
          ? "This browser can't show PDFs inside the app."
          : "Reading and editing spreadsheets arrives with the data tools. You can download the original now."}
      </p>
      {file.kind === "pdf" && (
        <a
          href={loaded.url}
          target="_blank"
          rel="noopener"
          className="press mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-[#019A53]"
        >
          <ExternalLink className="size-4" /> Open PDF
        </a>
      )}
    </div>
  );
}

export function FilePreview() {
  const [params] = useSearchParams();
  const previewId = params.get(PREVIEW_PARAM);
  const closePreview = useClosePreview();
  const status = useWorkspaceStore((s) => s.status);
  const file = useWorkspaceStore((s) => (previewId ? s.files.find((f) => f.id === previewId) : undefined));
  const open = previewId !== null && status === "ready";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closePreview()}>
      {open && (
        <DialogContent
          aria-describedby={file ? "preview-meta" : undefined}
          className="flex h-dvh max-h-none w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[88vh] sm:w-[calc(100%-3rem)] sm:max-w-5xl sm:rounded-2xl"
        >
          <header className="flex items-center gap-3 border-b border-salin-border px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:px-4">
            {file && <FileTypeIcon kind={file.kind} showLabel={false} className="size-9" />}
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[15px]">{file?.name ?? "File not found"}</DialogTitle>
              <DialogDescription id="preview-meta" className="mt-0 truncate text-xs">
                {file ? `${FILE_KIND_META[file.kind].name} · ${formatBytes(file.size)} · Modified ${formatDate(file.updatedAt)}` : "It may have been deleted."}
              </DialogDescription>
            </div>
            {file && (
              <button
                type="button"
                onClick={() => void downloadItem(fileToItem(file))}
                className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile"
              >
                <Download className="size-4" /> <span className="hidden sm:inline">Download</span>
              </button>
            )}
            <DialogClose aria-label="Close preview" className="grid size-9 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-text">
              <X className="size-5" />
            </DialogClose>
          </header>
          <div className="min-h-0 flex-1 bg-white">
            {file && file.deletedAt === null ? (
              <PreviewContent key={file.id} file={file} />
            ) : (
              <div className="grid h-full place-items-center px-6 text-center text-sm text-salin-muted">
                {file ? "This file is in Trash. Restore it to open it." : "This file isn't in your workspace anymore."}
              </div>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
