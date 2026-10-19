/**
 * Prepare Step
 * Step 1 of reading a scan: every page in a strip (add more photos or PDFs,
 * reorder, remove) and an editor for the selected page — crop with corner
 * handles (perspective correction), find the page edges automatically,
 * rotate, zoom, reset, and clean-up switches (shadows, contrast, noise,
 * black-and-white, straighten) — with a preview of exactly what will be
 * read. The original photo or PDF is never changed.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, Camera, LoaderCircle, Plus, RotateCcw, RotateCw, ScanLine, Trash2, Undo2, Wand2 } from "lucide-react";

import { detectPageEdges, previewImage } from "@/core/ocr/imaging/imaging-client";
import { DEFAULT_EDITS } from "@/core/ocr/imaging/pipeline";
import { errorMessage } from "@/core/storage/errors";
import { importFiles } from "@/core/storage/repositories/file-repository";
import { addOcrPages, moveOcrPage, removeOcrPage, updateOcrPage, type NewPage } from "@/core/storage/repositories/ocr.repository";
import { CropEditor } from "@/features/ocr/components/crop-editor";
import { PageViewer } from "@/features/ocr/components/page-viewer";
import { useObjectUrl } from "@/features/ocr/hooks/use-scan";
import { MAX_SCAN_PAGES } from "@/features/ocr/ocr-actions";
import { pageSource, pdfPageCount } from "@/features/ocr/page-sources";
import { toast } from "@/stores/toast-store";
import { toIntakeFiles } from "@/stores/intake-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import type { Enhancements, OcrDocument, OcrPage, PageEdits, QuarterTurn } from "@/types/ocr";

const ENHANCEMENTS: { key: keyof Enhancements; label: string; hint: string }[] = [
  { key: "shadows", label: "Fix shadows & lighting", hint: "Evens out dark corners and uneven light." },
  { key: "contrast", label: "Boost contrast", hint: "Makes faint print darker." },
  { key: "denoise", label: "Reduce noise", hint: "Removes specks from low-light photos." },
  { key: "blackAndWhite", label: "Black & white", hint: "Pure black text on white. Can help faint print." },
];

/** Pages whose edges were already looked for automatically (once per page per visit). */
const autoDetected = new Set<string>();

function PageThumb({ page, index, selected, onSelect }: { page: OcrPage; index: number; selected: boolean; onSelect: () => void }) {
  const [source, setSource] = useState<Blob | null>(null);
  const url = useObjectUrl(page.processed ?? source, page.processed ? `${page.id}:${page.processedKey}` : `${page.id}:source`);
  useEffect(() => {
    if (page.processed || page.pdfPage !== null) return;
    let active = true;
    pageSource(page).then((blob) => active && setSource(blob), () => undefined);
    return () => {
      active = false;
    };
  }, [page]);
  const badge = page.state === "failed" ? "bg-red-600" : page.state === "done" ? "bg-salin-primary" : "bg-black/55";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Page ${index + 1}${page.state === "done" ? ", read" : page.state === "failed" ? ", failed" : ""}`}
      className={cn(
        "relative aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-salin-border transition-shadow sm:w-[72px]",
        selected && "ring-[3px] ring-salin-primary",
      )}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-[10px] text-salin-muted">{page.pdfPage ? `PDF p.${page.pdfPage}` : "…"}</span>}
      <span className={cn("absolute bottom-1 left-1 rounded px-1.5 text-[10px] font-semibold text-white", badge)}>{index + 1}</span>
    </button>
  );
}

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-salin-tile">
      <span>
        <span className="block text-sm font-medium text-salin-text">{label}</span>
        <span className="block text-xs text-salin-muted">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-5 shrink-0 accent-salin-primary" />
    </label>
  );
}

function PageEditor({ page, index, count }: { page: OcrPage; index: number; count: number }) {
  const [edits, setEdits] = useState<PageEdits>(page.edits);
  const [source, setSource] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"adjust" | "preview">("adjust");
  const [base, setBase] = useState<{ blob: Blob; width: number; height: number } | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; width: number; height: number; skew: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Each new image gets a new key, so its URL is made once.
  const [versions, setVersions] = useState({ base: 0, preview: 0 });
  const baseUrl = useObjectUrl(base?.blob, `base-${versions.base}`);
  const previewUrl = useObjectUrl(preview?.blob, `preview-${versions.preview}`);

  // Keep local edits in step with the stored page (another tab, or an automatic turn while reading).
  const stored = JSON.stringify(page.edits);
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    setEdits(page.edits);
  }

  useEffect(() => {
    let active = true;
    pageSource(page).then(
      (blob) => active && setSource(blob),
      (e: unknown) => active && setError(e instanceof Error && e.name === "PdfOpenError" ? e.message : errorMessage(e, "This page couldn't be opened. The file may be damaged.")),
    );
    return () => {
      active = false;
    };
    // The source only depends on which file/page this is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // The whole photo, turned: what the crop handles sit on.
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    previewImage(source, { rotation: edits.rotation, crop: null, deskew: false, enhance: { shadows: false, contrast: false, denoise: false, blackAndWhite: false } }, controller.signal).then(
      (result) => {
        setBase(result);
        setVersions((v) => ({ ...v, base: v.base + 1 }));
      },
      (e: unknown) => !controller.signal.aborted && setError(errorMessage(e, e instanceof Error ? e.message : "This page couldn't be opened.")),
    );
    return () => controller.abort();
  }, [source, edits.rotation]);

  // Exactly what will be read (crop, perspective, clean-up, straightening).
  const editsKey = JSON.stringify(edits);
  useEffect(() => {
    if (!source || view !== "preview") return;
    const controller = new AbortController();
    void Promise.resolve().then(() => !controller.signal.aborted && setBusy(true));
    previewImage(source, JSON.parse(editsKey) as PageEdits, controller.signal)
      .then(
        (result) => {
          setPreview(result);
          setVersions((v) => ({ ...v, preview: v.preview + 1 }));
        },
        () => undefined,
      )
      .finally(() => !controller.signal.aborted && setBusy(false));
    return () => controller.abort();
  }, [source, editsKey, view]);

  // Photos: look for the page edges once, automatically.
  useEffect(() => {
    if (!source || page.pdfPage !== null || autoDetected.has(page.id) || page.edits.crop || page.state !== "pending") return;
    autoDetected.add(page.id);
    detectPageEdges(source, page.edits.rotation).then(
      (quad) => {
        if (!quad) return;
        setEdits((e) => ({ ...e, crop: quad }));
        void updateOcrPage(page.id, { edits: { ...page.edits, crop: quad } });
        setNote("Page edges found automatically — drag the corners if they're off.");
      },
      () => undefined,
    );
  }, [source, page]);

  const save = (next: PageEdits) => {
    setEdits(next);
    void updateOcrPage(page.id, { edits: next }).catch((e: unknown) => toast(errorMessage(e, "The change couldn't be saved.")));
  };

  const turn = (delta: number) => save({ ...edits, rotation: ((((edits.rotation + delta) % 360) + 360) % 360) as QuarterTurn, crop: null });

  async function detect() {
    if (!source) return;
    setNote(null);
    const quad = await detectPageEdges(source, edits.rotation).catch(() => null);
    if (quad) {
      save({ ...edits, crop: quad });
      setNote("Page edges found — drag the corners to fine-tune.");
    } else {
      setNote("No clear page edge was found. Drag the corners onto the page's corners yourself.");
    }
  }

  async function remove() {
    try {
      await removeOcrPage(page.id);
    } catch (e) {
      toast(errorMessage(e, "The page couldn't be removed."));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Page view" className="inline-flex rounded-xl bg-salin-tile p-1">
            {(["adjust", "preview"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn("h-8 rounded-lg px-3 text-sm font-medium", view === v ? "bg-salin-surface text-salin-text shadow-sm" : "text-salin-muted hover:text-salin-text")}
              >
                {v === "adjust" ? "Crop & rotate" : "Preview for reading"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <IconButton label="Rotate left" onClick={() => turn(-90)} icon={RotateCcw} />
            <IconButton label="Rotate right" onClick={() => turn(90)} icon={RotateCw} />
            <IconButton label="Find page edges" onClick={() => void detect()} icon={ScanLine} disabled={!source} />
            <IconButton label="Reset changes" onClick={() => save(structuredClone(DEFAULT_EDITS))} icon={Undo2} />
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-salin-tile p-2 ring-1 ring-salin-border sm:p-3">
          {error ? (
            <p role="alert" className="py-16 text-center text-sm text-destructive">
              {error}
            </p>
          ) : view === "adjust" ? (
            base && baseUrl ? (
              <div className="mx-auto max-h-[70vh] max-w-xl overflow-auto" data-lenis-prevent="">
                <CropEditor src={baseUrl} width={base.width} height={base.height} crop={edits.crop} onChange={(crop, done) => (done ? save({ ...edits, crop }) : setEdits({ ...edits, crop }))} />
              </div>
            ) : (
              <Loading text="Opening page…" />
            )
          ) : preview && previewUrl ? (
            <div className="relative">
              <PageViewer src={previewUrl} width={preview.width} height={preview.height} label={`Page ${index + 1} as it will be read`} className="mx-auto h-[min(70vh,44rem)] max-w-xl" />
              {busy && <LoaderCircle aria-label="Updating preview" className="absolute top-3 right-3 size-5 animate-spin text-salin-primary" />}
            </div>
          ) : (
            <Loading text="Preparing preview…" />
          )}
        </div>
        {note && <p className="mt-2 text-sm text-salin-muted">{note}</p>}
        {view === "preview" && preview && preview.skew !== 0 && <p className="mt-2 text-sm text-salin-muted">Straightened by {Math.abs(preview.skew).toFixed(1)}°.</p>}
      </div>

      <aside className="space-y-4">
        <section aria-labelledby="cleanup-heading" className="rounded-2xl ring-1 ring-salin-border">
          <h3 id="cleanup-heading" className="flex items-center gap-2 px-3 pt-3 text-sm font-semibold text-salin-text">
            <Wand2 className="size-4 text-salin-primary" /> Clean-up
          </h3>
          <div className="p-1">
            <Switch checked={edits.deskew} onChange={(v) => save({ ...edits, deskew: v })} label="Straighten text" hint="Fixes slightly tilted photos." />
            {ENHANCEMENTS.map((e) => (
              <Switch key={e.key} checked={edits.enhance[e.key]} onChange={(v) => save({ ...edits, enhance: { ...edits.enhance, [e.key]: v } })} label={e.label} hint={e.hint} />
            ))}
          </div>
        </section>
        <section aria-label="Page order" className="flex flex-wrap gap-2">
          <button type="button" disabled={index === 0} onClick={() => void moveOcrPage(page.id, -1)} className={smallButton}>
            <ArrowLeft className="size-4" /> Move earlier
          </button>
          <button type="button" disabled={index === count - 1} onClick={() => void moveOcrPage(page.id, 1)} className={smallButton}>
            Move later <ArrowRight className="size-4" />
          </button>
          <button type="button" disabled={count === 1} onClick={() => void remove()} className={cn(smallButton, "text-destructive")}>
            <Trash2 className="size-4" /> Remove page
          </button>
        </section>
        <p className="text-xs text-salin-muted">
          Changes only affect how the page is read. The original {page.pdfPage ? "PDF" : "photo"} in your workspace stays as it is.
        </p>
      </aside>
    </div>
  );
}

const smallButton = "press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-40";

function IconButton({ label, onClick, icon: Icon, disabled }: { label: string; onClick: () => void; icon: typeof RotateCw; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="press grid size-9 place-items-center rounded-xl text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-40">
      <Icon className="size-4" />
    </button>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-salin-muted">
      <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> {text}
    </p>
  );
}

/** Adds photos or PDFs to the scan (saved to the workspace first, next to the scan's first file). */
function AddPages({ doc, pageCount }: { doc: OcrDocument; pageCount: number }) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const folderId = useWorkspaceStore((s) => s.files.find((f) => f.id === doc.fileIds[0])?.folderId ?? null);

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    const { ok, rejected } = toIntakeFiles(picked, "scan");
    const usable = ok.filter((f) => ["png", "jpg", "webp", "pdf"].includes(f.kind));
    const skipped = rejected.length + ok.length - usable.length;
    if (skipped) toast(`Skipped ${skipped} file${skipped === 1 ? "" : "s"}: use JPG, PNG, WebP or PDF under 50 MB.`);
    if (!usable.length) return;
    try {
      // Count PDF pages before saving, so a damaged PDF isn't saved for nothing.
      const counts = await Promise.all(usable.map((f) => (f.kind === "pdf" ? pdfPageCount(f.file) : Promise.resolve(1))));
      if (pageCount + counts.reduce((a, b) => a + b, 0) > MAX_SCAN_PAGES) {
        toast(`A scan can have up to ${MAX_SCAN_PAGES} pages. Split the document and scan it in parts.`);
        return;
      }
      const { files } = await importFiles(
        usable.map((f) => ({ blob: f.file, name: f.name, kind: f.kind, mimeType: f.file.type, dirPath: "", source: "scan" as const })),
        folderId,
      );
      // Saved in the order they were picked.
      const pages = files.flatMap((file, i): NewPage[] => (file.kind === "pdf" ? Array.from({ length: counts[i] }, (_, n) => ({ fileId: file.id, pdfPage: n + 1 })) : [{ fileId: file.id, pdfPage: null }]));
      await addOcrPages(doc.id, pages);
    } catch (e) {
      toast(e instanceof Error && e.name === "PdfOpenError" ? e.message : errorMessage(e, "The pages couldn't be added."));
    } finally {
      ok.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    }
  }

  return (
    <>
      <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.jpg,.jpeg,.png,.webp" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFiles(e)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFiles(e)} />
      <button type="button" onClick={() => uploadRef.current?.click()} className="grid aspect-[3/4] w-16 shrink-0 place-items-center rounded-lg border-2 border-dashed border-salin-border-strong text-salin-muted hover:border-salin-primary hover:text-salin-primary sm:w-[72px]">
        <span className="flex flex-col items-center gap-0.5 text-[10px] font-semibold">
          <Plus className="size-5" /> Add pages
        </span>
      </button>
      <button type="button" onClick={() => cameraRef.current?.click()} className="grid aspect-[3/4] w-16 shrink-0 place-items-center rounded-lg border-2 border-dashed border-salin-border-strong text-salin-muted hover:border-salin-primary hover:text-salin-primary sm:w-[72px]">
        <span className="flex flex-col items-center gap-0.5 text-[10px] font-semibold">
          <Camera className="size-5" /> Take photo
        </span>
      </button>
    </>
  );
}

export function PrepareStep({ doc, pages, selected, onSelect }: { doc: OcrDocument; pages: OcrPage[]; selected: number; onSelect: (index: number) => void }) {
  const index = Math.min(selected, pages.length - 1);
  const page = pages[index];
  return (
    <div>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2" data-lenis-prevent-horizontal="" role="group" aria-label="Pages">
        {pages.map((p, i) => (
          <PageThumb key={p.id} page={p} index={i} selected={i === index} onSelect={() => onSelect(i)} />
        ))}
        <AddPages doc={doc} pageCount={pages.length} />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-salin-text">
        Page {index + 1} of {pages.length}
      </h3>
      <div className="mt-3">{page && <PageEditor key={page.id} page={page} index={index} count={pages.length} />}</div>
    </div>
  );
}
