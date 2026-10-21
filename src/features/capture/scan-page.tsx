/**
 * Scan Page (/scan)
 * Camera capture for paper documents: live viewfinder with a page frame;
 * each shot is shown for Retake or Use photo; pages can also come from the
 * phone's own camera app (when the browser camera is blocked or missing) or
 * be uploaded (JPG, PNG, WebP, PDF — wrong types and files over 50 MB are
 * refused with a reason). Then: Read text (on-device OCR into a dataset),
 * save the pages into a workspace folder, or send them to Ask Salin AI.
 * Cancel leaves without saving anything.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { Camera, CameraOff, Check, FolderInput, Images, LoaderCircle, RotateCcw, ScanText, Sparkles, SwitchCamera, X } from "lucide-react";

import { PageFrame } from "@/components/layout/page-frame";
import { CAMERA_ERROR_COPY, useCamera } from "@/features/capture/use-camera";
import { scanUrl, startScanFromIntake } from "@/features/ocr/ocr-actions";
import { FolderPickerDialog } from "@/features/workspace/components/folder-picker-dialog";
import { folderUrl } from "@/features/workspace/use-open-item";
import { saveIntakeFiles } from "@/features/workspace/workspace-actions";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { toIntakeFiles, useIntakeStore, type IntakeFile } from "@/stores/intake-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

const TIPS = [
  "Lay the page flat on a contrasting surface.",
  "Use even light and avoid shadows or glare.",
  "Fit all four corners inside the frame.",
  "Printed forms work best — handwriting is harder to read.",
];

function scanFileName(index: number) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `Scan ${stamp} p${index}.jpg`;
}

/** Green corner brackets marking where the page should sit. */
function DocumentFrame({ animate }: { animate: boolean }) {
  const corner = "absolute size-9 border-salin-primary";
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-[10%] inset-y-[8%] overflow-hidden rounded-xl">
      <span className={cn(corner, "top-0 left-0 rounded-tl-xl border-t-[3px] border-l-[3px]")} />
      <span className={cn(corner, "top-0 right-0 rounded-tr-xl border-t-[3px] border-r-[3px]")} />
      <span className={cn(corner, "bottom-0 left-0 rounded-bl-xl border-b-[3px] border-l-[3px]")} />
      <span className={cn(corner, "right-0 bottom-0 rounded-br-xl border-r-[3px] border-b-[3px]")} />
      {animate && (
        <div className="absolute inset-0 animate-scan motion-reduce:hidden">
          <div className="h-0.5 w-full bg-[linear-gradient(90deg,transparent,#3BE08F,transparent)] shadow-[0_0_14px_2px_rgb(1_168_90/0.55)]" />
        </div>
      )}
    </div>
  );
}

export function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const { status, flip, retry } = useCamera(videoRef);
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const attach = useIntakeStore((s) => s.attach);

  const [pages, setPages] = useState<IntakeFile[]>([]);
  /** A photo just taken, waiting for Retake or Use photo. */
  const [shot, setShot] = useState<IntakeFile | null>(null);
  const [reading, setReading] = useState(false);
  const nativeRef = useRef<HTMLInputElement>(null);
  const [flashes, setFlashes] = useState(0);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const pagesRef = useRef<IntakeFile[]>([]);
  const handedOff = useRef(false);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // Free preview URLs if the user leaves without sending the pages anywhere.
  useEffect(
    () => () => {
      if (!handedOff.current) pagesRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    },
    [],
  );

  const live = status.state === "live";

  function capture() {
    const video = videoRef.current;
    if (!video || !live || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (!reduced) setFlashes((n) => n + 1);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], scanFileName(pagesRef.current.length + 1), { type: "image/jpeg" });
        const { ok } = toIntakeFiles([file], "scan");
        setShot(ok[0] ?? null);
      },
      "image/jpeg",
      0.92,
    );
  }

  function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const { ok, rejected } = toIntakeFiles(files, "scan");
    const usable = ok.filter((f) => f.kind === "png" || f.kind === "jpg" || f.kind === "webp" || f.kind === "pdf");
    const wrongType = ok.filter((f) => !usable.includes(f));
    wrongType.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    setPages((p) => [...p, ...usable]);
    const skipped = [...rejected, ...wrongType.map((f) => ({ name: f.name, reason: "Not a photo or PDF" }))];
    if (skipped.length) toast(`Skipped ${skipped.map((r) => `${r.name} (${r.reason.toLowerCase()})`).join(", ")}. Use JPG, PNG, WebP or PDF under 50 MB.`);
  }

  /** A photo from the phone's camera app: checked like a live capture. */
  function onNativeCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const { ok, rejected } = toIntakeFiles([file], "scan");
    if (rejected.length) toast(`That photo can't be used (${rejected[0].reason.toLowerCase()}).`);
    setShot(ok[0] ?? null);
  }

  function keepShot() {
    if (!shot) return;
    setPages((p) => [...p, shot]);
    setShot(null);
  }

  function retake() {
    if (shot?.previewUrl) URL.revokeObjectURL(shot.previewUrl);
    setShot(null);
  }

  function cancel() {
    retake();
    pages.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    setPages([]);
    handedOff.current = true;
    navigate("/");
  }

  async function readText() {
    setReading(true);
    const id = await startScanFromIntake(pages, null);
    setReading(false);
    if (!id) return;
    handedOff.current = true;
    pages.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    navigate(scanUrl(id));
  }

  function removePage(id: string) {
    setPages((p) => {
      const page = p.find((x) => x.id === id);
      if (page?.previewUrl) URL.revokeObjectURL(page.previewUrl);
      return p.filter((x) => x.id !== id);
    });
  }

  function askAi() {
    handedOff.current = true;
    attach(pages);
    navigate("/ai-studio");
  }

  async function saveTo(folderId: string | null) {
    const saved = await saveIntakeFiles(pages, folderId, { onOpen: () => navigate(folderUrl(folderId)) });
    if (saved === null) return;
    setChoosingFolder(false);
    pages.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    setPages([]);
  }

  const errorCopy = status.state === "error" ? CAMERA_ERROR_COPY[status.error] : null;
  const canRetry = status.state === "error" && status.error !== "insecure" && status.error !== "unsupported";

  return (
    <PageFrame title="Scan Document" description="Capture paper forms with your camera. Pages stay on this device.">
      <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf,.jpg,.jpeg,.png,.webp" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onUpload} />
      <input ref={nativeRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onNativeCapture} />

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_17.5rem]">
        {/* Camera */}
        <div>
          <div className="relative mx-auto aspect-[3/4] max-h-[68vh] overflow-hidden rounded-3xl bg-[#0E1511] sm:aspect-[4/3] md:max-h-none">
            <video ref={videoRef} playsInline muted className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", live ? "opacity-100" : "opacity-0")} />

            {live && (
              <>
                <DocumentFrame animate={!reduced} />
                <p className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white backdrop-blur">
                  Fit the whole page inside the frame
                </p>
              </>
            )}

            {status.state === "starting" && (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/80">
                <span className="flex items-center gap-2">
                  <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> Starting camera…
                </span>
              </div>
            )}

            {errorCopy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
                <span className="grid size-14 place-items-center rounded-2xl bg-white/10">
                  <CameraOff className="size-6" />
                </span>
                <p className="mt-4 font-semibold">{errorCopy.title}</p>
                <p className="mt-1 max-w-xs text-sm text-white/70">{errorCopy.body}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {canRetry && (
                    <button type="button" onClick={retry} className="press inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold ring-1 ring-white/20 hover:bg-white/15">
                      <RotateCcw className="size-4" /> Try again
                    </button>
                  )}
                  <button type="button" onClick={() => nativeRef.current?.click()} className="press inline-flex h-10 items-center gap-2 rounded-xl bg-salin-primary px-4 text-sm font-semibold hover:bg-salin-primary-strong">
                    <Camera className="size-4" /> Use the camera app
                  </button>
                  <button type="button" onClick={() => uploadRef.current?.click()} className="press inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold ring-1 ring-white/20 hover:bg-white/15">
                    <Images className="size-4" /> Upload a photo or PDF
                  </button>
                </div>
              </div>
            )}

            {flashes > 0 && <div key={flashes} aria-hidden="true" className="pointer-events-none absolute inset-0 animate-flash bg-white opacity-0" />}

            {shot && (
              <div role="dialog" aria-label="Check the photo" className="absolute inset-0 flex flex-col bg-[#0E1511]">
                {shot.previewUrl && <img src={shot.previewUrl} alt="Photo just taken" className="min-h-0 flex-1 object-contain" />}
                <div className="flex items-center justify-center gap-3 p-3">
                  <button type="button" onClick={retake} className="press inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/15">
                    <RotateCcw className="size-4" /> Retake
                  </button>
                  <button type="button" onClick={keepShot} className="press inline-flex h-11 items-center gap-2 rounded-xl bg-salin-primary px-5 text-sm font-semibold text-white hover:bg-salin-primary-strong">
                    <Check className="size-4" /> Use photo
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="mt-5 flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              aria-label="Upload photos or PDFs from your device"
              className="press grid size-12 place-items-center rounded-full bg-salin-tile text-salin-text hover:bg-salin-tile-hover"
            >
              <Images className="size-5" />
            </button>
            <button
              type="button"
              onClick={capture}
              disabled={!live}
              aria-label="Capture page"
              className="press grid size-[74px] place-items-center rounded-full bg-white shadow-[0_0_0_4px_var(--color-salin-primary),0_10px_24px_-8px_rgb(1_168_90/0.6)] disabled:opacity-40"
            >
              <span className="size-[58px] rounded-full bg-[linear-gradient(150deg,#22C878,#01A85A_55%,#018A4A)]" />
            </button>
            <button
              type="button"
              onClick={flip}
              disabled={status.state === "error" && !canRetry}
              aria-label="Switch camera"
              className="press grid size-12 place-items-center rounded-full bg-salin-tile text-salin-text hover:bg-salin-tile-hover disabled:opacity-40"
            >
              <SwitchCamera className="size-5" />
            </button>
          </div>
        </div>

        {/* Pages + next step */}
        <aside className="flex flex-col gap-5">
          <section aria-labelledby="pages-heading" className="rounded-2xl bg-salin-tile p-4">
            <div className="flex items-center justify-between">
              <h2 id="pages-heading" className="text-sm font-semibold">
                Pages <span className="text-salin-muted">({pages.length})</span>
              </h2>
              {pages.length > 0 && <span className="text-xs text-salin-muted">Saved on this device only</span>}
            </div>
            {pages.length === 0 ? (
              <p className="mt-2 text-sm text-salin-muted">Captured pages appear here. Add as many as the document has.</p>
            ) : (
              <ul className="mt-3 grid grid-cols-3 gap-2">
                {pages.map((page, i) => (
                  <li key={page.id} className="group relative aspect-[3/4] overflow-hidden rounded-lg bg-white ring-1 ring-salin-border">
                    {page.previewUrl ? (
                      <img src={page.previewUrl} alt={`Page ${i + 1}`} className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-[10px] font-semibold text-salin-muted">PDF</span>
                    )}
                    <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 text-[10px] font-semibold text-white">{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removePage(page.id)}
                      aria-label={`Remove page ${i + 1}`}
                      className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/55 text-white hover:bg-black/70"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={pages.length === 0 || reading}
              onClick={() => void readText()}
              className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-salin-primary text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgb(1_168_90/0.6)] hover:bg-salin-primary-strong disabled:opacity-45 disabled:shadow-none"
            >
              {reading ? <LoaderCircle className="size-[18px] animate-spin" /> : <ScanText className="size-[18px]" />} Extract data
            </button>
            <button
              type="button"
              disabled={pages.length === 0}
              onClick={askAi}
              className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-45"
            >
              <Sparkles className="size-[18px]" /> Ask Salin AI
            </button>
            <button
              type="button"
              disabled={pages.length === 0}
              onClick={() => setChoosingFolder(true)}
              className="press inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-45"
            >
              <FolderInput className="size-[18px]" /> Save to Workspace
            </button>
            <button type="button" onClick={cancel} className="press inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-salin-muted hover:bg-salin-tile hover:text-salin-text">
              <X className="size-4" /> Cancel
            </button>
          </div>

          <section aria-labelledby="tips-heading">
            <h2 id="tips-heading" className="text-sm font-semibold">For best results</h2>
            <ul className="mt-2 space-y-2 text-sm text-salin-muted">
              {TIPS.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-salin-primary" />
                  {tip}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <FolderPickerDialog
        open={choosingFolder}
        onOpenChange={setChoosingFolder}
        title={`Save ${pages.length} page${pages.length === 1 ? "" : "s"} to…`}
        confirmLabel="Save here"
        onConfirm={saveTo}
      />
    </PageFrame>
  );
}
