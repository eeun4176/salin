/**
 * Read Step
 * Step 2 of reading a scan: choose a template (generic, the veterinary
 * forms, or a saved one) and the languages, make sure the recognition files
 * are on the device (download size and progress shown), then read every
 * page on the device with per-page progress, Cancel, and Retry for pages
 * that failed. When OCR can't run here (or the user prefers), values can be
 * typed by hand while looking at the page.
 */

import { useEffect, useState } from "react";
import { CircleCheck, CircleX, FileText, Keyboard, LoaderCircle, RotateCcw, ScanText, Square } from "lucide-react";

import { engineAssetFor, OCR_LANGUAGES } from "@/core/ocr/models/model-assets";
import { GENERIC_TEMPLATE_ID } from "@/core/ocr/templates/builtin-templates";
import type { DocumentTemplateDef } from "@/core/ocr/templates/template-schema";
import { getOcrDocumentOrThrow, getOcrPages, updateOcrDocument } from "@/core/storage/repositories/ocr.repository";
import { errorMessage } from "@/core/storage/errors";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { primaryButton as primary, secondaryButton as secondary } from "@/components/common/step-footer";
import { reviewItems } from "@/core/ocr/review/review-state";
import { ModelStatus } from "@/features/ocr/components/model-status";
import { allTemplates, buildExtraction, manualExtraction } from "@/features/ocr/ocr-actions";
import { cancelReading, isReading, readDocument, type ReadProgress } from "@/features/ocr/ocr-runner";
import { useOcrStore, useProfileChoice } from "@/stores/ocr-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";
import type { OcrDocument, OcrPage } from "@/types/ocr";

const STAGE_TEXT: Record<ReadProgress["stage"], string> = {
  preparing: "Preparing the image",
  starting: "Starting text recognition",
  reading: "Reading text",
  analysing: "Finding fields and tables",
};

function TemplateOption({ id, name, description, badge, checked, onChange }: { id: string; name: string; description: string; badge?: string; checked: boolean; onChange: (id: string) => void }) {
  return (
    <label className={cn("flex cursor-pointer gap-3 rounded-2xl p-3.5 ring-1 transition-colors", checked ? "bg-salin-primary-soft ring-salin-primary" : "ring-salin-border hover:bg-salin-tile")}>
      <input type="radio" name="template" value={id} checked={checked} onChange={() => onChange(id)} className="mt-0.5 size-4 shrink-0 accent-salin-primary" />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-salin-text">
          {name}
          {badge && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">{badge}</span>}
        </span>
        <span className="mt-0.5 block text-xs text-salin-muted">{description}</span>
      </span>
    </label>
  );
}

export function ReadStep({ doc, pages, onDone }: { doc: OcrDocument; pages: OcrPage[]; onDone: () => void }) {
  const [templates, setTemplates] = useState<DocumentTemplateDef[]>([]);
  const [progress, setProgress] = useState<ReadProgress | null>(null);
  const [reading, setReading] = useState(() => isReading(doc.id));
  const [fatal, setFatal] = useState<string | null>(null);
  const model = useOcrStore((s) => s.model);
  const caps = useOcrStore((s) => s.caps);
  const languages = useOcrStore((s) => s.languages);
  const setLanguages = useOcrStore((s) => s.setLanguages);
  const download = useOcrStore((s) => s.download);
  const profile = useProfileChoice().profile;

  useEffect(() => {
    void allTemplates().then(setTemplates);
  }, []);

  const failed = pages.filter((p) => p.state === "failed");
  const done = pages.filter((p) => p.state === "done");
  const unsupported = model.status === "unsupported";

  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const hasCorrections = doc.extraction ? reviewItems(doc.extraction).some((i) => i.value.edited || i.value.confirmed) : false;

  // Shown as chosen at once; saved (and synced back from the database) right after.
  const [chosen, setChosen] = useState(doc.templateId);
  const [synced, setSynced] = useState(doc.templateId);
  if (doc.templateId !== synced) {
    setSynced(doc.templateId);
    setChosen(doc.templateId);
  }

  /** Switches template; pages already read are mapped again right away (no re-reading needed). */
  async function applyTemplate(templateId: string) {
    setChosen(templateId);
    try {
      const read = pages.some((p) => p.state === "done");
      const extraction = read ? await buildExtraction({ ...doc, templateId }, pages) : null;
      await updateOcrDocument(doc.id, { templateId, extraction });
    } catch (e) {
      toast(errorMessage(e, "The choice couldn't be saved."));
    }
  }

  const setTemplate = (templateId: string) => (hasCorrections ? setPendingTemplate(templateId) : void applyTemplate(templateId));

  /** Back to the review that was already started (corrections kept). */
  async function finish() {
    await updateOcrDocument(doc.id, { stage: "review" });
    onDone();
  }

  async function read(pageIds?: string[]) {
    setFatal(null);
    if (model.status !== "ready") {
      const ok = await download();
      if (!ok) return;
    }
    const detected = caps ?? useOcrStore.getState().caps;
    if (!detected) return;
    setReading(true);
    await updateOcrDocument(doc.id, { stage: "read", languages }).catch(() => undefined);
    const outcome = await readDocument(doc.id, { config: { profile, languages, core: engineAssetFor(detected) }, pageIds, onProgress: setProgress });
    setReading(false);
    setProgress(null);
    if (outcome.fatal) {
      setFatal(outcome.fatal);
      return;
    }
    if (outcome.cancelled) {
      toast("Reading stopped. Pages already read are kept.");
      return;
    }
    const [fresh, latest] = await Promise.all([getOcrPages(doc.id), getOcrDocumentOrThrow(doc.id)]);
    if (fresh.some((p) => p.state === "done")) {
      const extraction = await buildExtraction(latest, fresh);
      await updateOcrDocument(doc.id, { extraction, stage: "review" });
      if (outcome.failed === 0) onDone();
      else toast(`${outcome.failed} page${outcome.failed === 1 ? "" : "s"} couldn't be read. Retry, or continue with the rest.`);
    }
  }

  async function typeByHand() {
    const extraction = await manualExtraction(doc, pages);
    await updateOcrDocument(doc.id, { extraction, stage: "review" });
    onDone();
  }

  const options = [
    { id: GENERIC_TEMPLATE_ID, name: "Any document (generic)", description: "Finds labelled fields, tables and text on any page." },
    ...templates.map((t) => ({ id: t.id, name: t.name, description: t.description || (t.builtIn ? "" : "Your saved template."), badge: t.experimental ? "Experimental" : !t.builtIn ? "Saved" : undefined })),
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="template-heading">
        <h3 id="template-heading" className="text-sm font-semibold text-salin-text">
          What kind of document is this?
        </h3>
        <div role="radiogroup" aria-labelledby="template-heading" className="mt-3 grid gap-2">
          {options.map((o) => (
            <TemplateOption key={o.id} {...o} checked={chosen === o.id} onChange={setTemplate} />
          ))}
        </div>
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-salin-text">Languages on the page</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {OCR_LANGUAGES.map((l) => (
              <label key={l.code} className={cn("inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1", languages.includes(l.code) ? "bg-salin-primary-soft ring-salin-primary" : "ring-salin-border")}>
                <input
                  type="checkbox"
                  checked={languages.includes(l.code)}
                  disabled={l.required || reading}
                  onChange={(e) => setLanguages(e.target.checked ? [...languages, l.code] : languages.filter((c) => c !== l.code))}
                  className="size-4 accent-salin-primary"
                />
                {l.label}
                {l.required && <span className="text-xs text-salin-muted">(always)</span>}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="read-heading" className="space-y-4">
        <h3 id="read-heading" className="text-sm font-semibold text-salin-text">
          Read the {pages.length === 1 ? "page" : `${pages.length} pages`}
        </h3>
        <ModelStatus />
        {fatal && (
          <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-400/10 dark:text-red-200">
            {fatal}
          </p>
        )}

        <ol aria-label="Pages" className="divide-y divide-salin-border rounded-2xl ring-1 ring-salin-border">
          {pages.map((p, i) => {
            const active = progress?.pageId === p.id;
            return (
              <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                <FileText className="size-4 shrink-0 text-salin-muted" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-salin-text">Page {i + 1}</span>
                  <span className="block text-xs text-salin-muted">
                    {active
                      ? `${STAGE_TEXT[progress.stage]}${progress.detail && progress.stage === "starting" ? ` — ${progress.detail}` : ""}…`
                      : p.state === "done" && p.result
                        ? p.result.status === "blank"
                          ? "Blank page"
                          : `Read · ${Math.round(p.result.confidence)}% confidence · ${(p.result.durationMs / 1000).toFixed(1)} s${p.result.autoRotated ? ` · turned ${p.result.autoRotated}°` : ""}${p.marks?.autoDenoised ? " · speckles removed" : ""}`
                        : p.state === "failed"
                          ? p.error
                          : p.state === "cancelled"
                            ? "Stopped"
                            : "Not read yet"}
                  </span>
                </span>
                {active ? (
                  <LoaderCircle aria-label="Reading" className="size-4 animate-spin text-salin-primary motion-reduce:animate-none" />
                ) : p.state === "done" ? (
                  <CircleCheck aria-label="Read" className="size-4 text-salin-primary" />
                ) : p.state === "failed" ? (
                  <CircleX aria-label="Failed" className="size-4 text-destructive" />
                ) : null}
              </li>
            );
          })}
        </ol>

        {reading && progress && (
          <div role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)} className="h-2 overflow-hidden rounded-full bg-salin-tile">
            <div className="h-full rounded-full bg-salin-primary transition-[width]" style={{ width: `${progress.fraction * 100}%` }} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {reading ? (
            <button type="button" onClick={() => cancelReading(doc.id)} className={secondary}>
              <Square className="size-4" /> Stop reading
            </button>
          ) : (
            <>
              {!unsupported && (
                <button type="button" onClick={() => void read()} disabled={model.status === "downloading" || model.status === "checking"} className={primary}>
                  <ScanText className="size-4" /> {done.length ? "Read again" : `Read ${pages.length === 1 ? "page" : `${pages.length} pages`}`}
                </button>
              )}
              {failed.length > 0 && !unsupported && (
                <button type="button" onClick={() => void read(failed.map((p) => p.id))} className={secondary}>
                  <RotateCcw className="size-4" /> Retry {failed.length} failed
                </button>
              )}
              {done.length > 0 && doc.extraction && (
                <button type="button" onClick={() => void finish()} className={secondary}>
                  Continue to review
                </button>
              )}
              <button type="button" onClick={() => void typeByHand()} className={cn(secondary, unsupported && primary)}>
                <Keyboard className="size-4" /> Type values myself
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-salin-muted">Everything happens on this device — the pages are never sent anywhere.</p>
      </section>

      <ConfirmDialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => !open && setPendingTemplate(null)}
        title="Use a different template?"
        description="The pages will be matched to the new template again. Values you corrected or confirmed in Review will be replaced."
        confirmLabel="Switch template"
        onConfirm={() => applyTemplate(pendingTemplate!)}
      />
    </div>
  );
}
