/**
 * OCR Source Dialog
 * Opened from "View source" on a dataset row that was read from a scan:
 * shows the scanned page (as it was read) with the row's region
 * highlighted, so the value can be checked against the original without
 * running recognition again. Links to the scan for a full review. If the
 * scan was deleted, says so and offers the original file instead.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ScanText, X } from "lucide-react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { denormalize } from "@/core/ocr/layout/geometry";
import { getOcrDocumentOrThrow, getOcrPages } from "@/core/storage/repositories/ocr.repository";
import { PageViewer } from "@/features/ocr/components/page-viewer";
import { useObjectUrl } from "@/features/ocr/hooks/use-scan";
import { scanUrl } from "@/features/ocr/ocr-actions";
import { ensureProcessed } from "@/features/ocr/ocr-runner";
import type { OcrDocument, OcrPage } from "@/types/ocr";
import type { OcrSourceReference } from "@/types/processing";

type Loaded = { status: "loading" } | { status: "missing" } | { status: "ready"; doc: OcrDocument; page: OcrPage; image: Blob | null };

export function OcrSourceDialog({ source, onClose, onOpenFile }: { source: OcrSourceReference | null; onClose: () => void; onOpenFile: () => void }) {
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded } | null>(null);
  const key = source ? `${source.documentId}#${source.page}` : "";

  useEffect(() => {
    if (!source) return;
    let active = true;
    (async () => {
      try {
        const doc = await getOcrDocumentOrThrow(source.documentId);
        const page = (await getOcrPages(source.documentId))[source.page - 1];
        if (!page) throw new Error("Page missing");
        const image = await ensureProcessed(page).catch(() => null);
        if (active) setLoaded({ key, value: { status: "ready", doc, page, image } });
      } catch {
        if (active) setLoaded({ key, value: { status: "missing" } });
      }
    })();
    return () => {
      active = false;
    };
  }, [source, key]);

  const state: Loaded = loaded?.key === key ? loaded.value : { status: "loading" };
  const url = useObjectUrl(state.status === "ready" ? state.image : null, state.status === "ready" ? `${state.page.id}:${state.page.processedKey}` : undefined);

  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      {source && (
        <DialogContent className="flex h-dvh max-h-none w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[88vh] sm:w-[calc(100%-3rem)] sm:max-w-3xl sm:rounded-2xl">
          <header className="flex items-center gap-3 border-b border-salin-border px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:px-4">
            <ScanText className="size-5 shrink-0 text-salin-primary" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[15px]">{state.status === "ready" ? state.doc.name : "Scanned page"}</DialogTitle>
              <DialogDescription className="mt-0 truncate text-xs">Page {source.page} · the highlighted area is where this row was read</DialogDescription>
            </div>
            {state.status === "ready" && (
              <Link to={scanUrl(state.doc.id)} className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile">
                Open scan
              </Link>
            )}
            <DialogClose aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-text">
              <X className="size-5" />
            </DialogClose>
          </header>
          <div className="min-h-0 flex-1 bg-salin-surface p-2 sm:p-3">
            {state.status === "loading" && <p className="py-16 text-center text-sm text-salin-muted">Opening page…</p>}
            {state.status === "missing" && (
              <div className="py-16 text-center">
                <p className="font-semibold text-salin-text">The scan was deleted</p>
                <p className="mt-1 text-sm text-salin-muted">The row is kept, but the scanned page isn't available any more.</p>
                <button type="button" onClick={onOpenFile} className="mt-4 text-sm font-semibold text-salin-primary hover:underline">
                  Open the original file instead
                </button>
              </div>
            )}
            {state.status === "ready" && (
              <PageViewer
                src={url}
                width={state.page.width || 1000}
                height={state.page.height || 1400}
                label={`Scanned page ${source.page}`}
                highlight={source.region && state.page.width ? denormalize(source.region, state.page.width, state.page.height) : null}
                className="h-full"
              />
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
