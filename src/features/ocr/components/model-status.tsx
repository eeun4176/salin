/**
 * Model Status
 * Shows whether this device has the text-recognition files: how big the
 * download is, its progress (with Cancel), "Ready — works offline", or a
 * failure with what to do (including offline recovery steps). Also shows
 * which profile will be used and why. Shared by Settings and the scan
 * screen's Read step.
 */

import { useEffect } from "react";
import { CircleCheck, CloudDownload, CloudOff, LoaderCircle, TriangleAlert } from "lucide-react";

import { OCR_PROFILES } from "@/core/ocr/models/capabilities";
import { formatBytes } from "@/features/workspace/query";
import { useOcrStore, useProfileChoice } from "@/stores/ocr-store";
import { cn } from "@/lib/utils";

export function ModelStatus({ compact = false }: { compact?: boolean }) {
  const model = useOcrStore((s) => s.model);
  const refresh = useOcrStore((s) => s.refresh);
  const download = useOcrStore((s) => s.download);
  const cancel = useOcrStore((s) => s.cancelDownload);
  const choice = useProfileChoice();
  const stored = useOcrStore((s) => s.storedBytes);

  useEffect(() => {
    void refresh();
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  const box = "rounded-2xl px-4 py-3 ring-1";
  return (
    <div className="space-y-2" aria-live="polite">
      {model.status === "checking" && (
        <p className={cn(box, "flex items-center gap-2 text-sm text-salin-muted ring-salin-border")}>
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> Checking the text-recognition files…
        </p>
      )}
      {model.status === "ready" && (
        <p className={cn(box, "flex items-start gap-2 bg-salin-primary-soft text-sm text-salin-primary-ink ring-transparent")}>
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">Text recognition is ready</span> — works offline. Files on this device: {formatBytes(stored || model.bytes)}.
          </span>
        </p>
      )}
      {model.status === "missing" && (
        <div className={cn(box, "flex flex-wrap items-center gap-3 ring-salin-border")}>
          <CloudDownload className="size-5 shrink-0 text-salin-primary" />
          <p className="min-w-0 flex-1 basis-48 text-sm text-salin-text">
            <span className="font-semibold">Download the text-recognition files once ({formatBytes(model.bytes)}).</span>{" "}
            <span className="text-salin-muted">They stay on this device so reading works offline. Your pages are never uploaded.</span>
          </p>
          <button type="button" onClick={() => void download()} className="press inline-flex h-10 items-center gap-2 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong">
            <CloudDownload className="size-4" /> Download {formatBytes(model.bytes)}
          </button>
        </div>
      )}
      {model.status === "downloading" && (
        <div className={cn(box, "ring-salin-border")}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-salin-text">
              Downloading {model.label}… {formatBytes(model.loaded)} of {formatBytes(model.total)}
            </span>
            <button type="button" onClick={cancel} className="shrink-0 text-sm font-semibold text-salin-primary hover:underline">
              Cancel
            </button>
          </div>
          <div role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((model.loaded / model.total) * 100)} className="mt-2 h-2 overflow-hidden rounded-full bg-salin-tile">
            <div className="h-full rounded-full bg-salin-primary transition-[width]" style={{ width: `${(model.loaded / model.total) * 100}%` }} />
          </div>
        </div>
      )}
      {model.status === "error" && (
        <div role="alert" className={cn(box, "flex flex-wrap items-start gap-3 bg-red-50 text-sm text-red-900 ring-transparent dark:bg-red-400/10 dark:text-red-200")}>
          {model.offline ? <CloudOff className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
          <p className="min-w-0 flex-1 basis-48">{model.message}</p>
          <button type="button" onClick={() => void download()} className="font-semibold underline-offset-2 hover:underline">
            Try again
          </button>
        </div>
      )}
      {model.status === "unsupported" && (
        <p role="alert" className={cn(box, "flex items-start gap-2 bg-amber-50 text-sm text-amber-900 ring-transparent dark:bg-amber-400/10 dark:text-amber-200")}>
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{model.message} You can still type the values while looking at the page.</span>
        </p>
      )}
      {!compact && model.status !== "unsupported" && (
        <p className="px-1 text-xs text-salin-muted">
          Profile: <span className="font-semibold text-salin-text">{OCR_PROFILES[choice.profile].label}</span> — {choice.reason}
        </p>
      )}
    </div>
  );
}
