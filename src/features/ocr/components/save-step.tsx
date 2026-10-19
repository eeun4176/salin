/**
 * Save Step
 * Step 4 of reading a scan: how many datasets will be created (forms,
 * each record table, and totals), with editable names and record counts,
 * then creating them in the dataset editor. Unchecked optional values are
 * carried over as they are, to fix later; every row keeps its source page
 * and region. Once saved, links straight to the new datasets.
 */

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, CircleCheck, LoaderCircle, Table2 } from "lucide-react";

import { primaryButton, secondaryButton, StepFooter } from "@/components/common/step-footer";
import { extractionToDatasets } from "@/core/ocr/review/to-dataset";
import { stateCounts } from "@/core/ocr/review/review-state";
import { validateName } from "@/core/storage/names";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { createScanDatasets } from "@/features/ocr/ocr-actions";
import { toast } from "@/stores/toast-store";
import type { OcrDocument, OcrPage } from "@/types/ocr";

export function SaveStep({ doc, pages, onBack }: { doc: OcrDocument; pages: OcrPage[]; onBack: () => void }) {
  const navigate = useNavigate();
  const [names, setNames] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const drafts = useMemo(
    () =>
      doc.extraction
        ? extractionToDatasets(
            doc.extraction,
            doc.id,
            doc.name,
            pages.map((p, i) => ({ page: i + 1, fileId: p.fileId, pdfPage: p.pdfPage, width: p.width || 1, height: p.height || 1 })),
          )
        : [],
    [doc, pages],
  );
  const counts = doc.extraction ? stateCounts(doc.extraction) : null;
  const unchecked = counts ? counts.needs_review + counts.unreadable : 0;
  const nameOf = (i: number) => names[i] ?? drafts[i].name;
  const errors = drafts.map((_, i) => validateName(nameOf(i), []));
  const duplicate = new Set(drafts.map((_, i) => nameOf(i).trim().toLowerCase())).size !== drafts.length;

  async function create() {
    setTried(true);
    if (errors.some(Boolean) || duplicate || drafts.length === 0) return;
    setBusy(true);
    const ids = await createScanDatasets(doc.id, Object.fromEntries(drafts.map((_, i) => [i, nameOf(i).trim()])));
    setBusy(false);
    if (ids.length === 1) navigate(datasetUrl(ids[0]));
    else if (ids.length > 1) {
      toast(`Created ${ids.length} datasets from “${doc.name}”.`);
      navigate("/datasets");
    }
  }

  if (doc.stage === "done" && doc.datasetIds.length) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
          <CircleCheck className="size-7" />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-salin-text">Saved as {doc.datasetIds.length === 1 ? "a dataset" : `${doc.datasetIds.length} datasets`}</h3>
        <p className="mt-1 max-w-md text-sm text-salin-muted">Open it to edit, check against the page, and export. You can come back here to review the scan again and save a new version.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {doc.datasetIds.map((id, i) => (
            <Link key={id} to={datasetUrl(id)} className={primaryButton}>
              <Table2 className="size-4" /> Open dataset{doc.datasetIds.length > 1 ? ` ${i + 1}` : ""}
            </Link>
          ))}
          <button type="button" onClick={onBack} className={secondaryButton}>
            Review again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-salin-text">
        {drafts.length === 0 ? "Nothing to save yet" : `${drafts.length} dataset${drafts.length === 1 ? "" : "s"} will be created`}
      </h3>
      <p className="mt-1 text-sm text-salin-muted">
        {drafts.length === 0
          ? "No values were read or typed. Go back to review and fill in what's on the page."
          : "They open in the dataset editor, where you can check each row against the page and export to CSV, Excel or JSON."}
      </p>
      <ul className="mt-4 space-y-3">
        {drafts.map((draft, i) => (
          <li key={i} className="rounded-2xl p-4 ring-1 ring-salin-border">
            <label className="grid gap-1 text-xs font-medium text-salin-muted">
              Dataset name
              <input
                value={nameOf(i)}
                onChange={(e) => setNames({ ...names, [i]: e.target.value })}
                aria-invalid={(tried && Boolean(errors[i])) || undefined}
                className="h-10 rounded-xl border border-salin-border bg-salin-surface px-3 text-sm text-salin-text outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15 aria-invalid:border-destructive"
              />
            </label>
            {tried && errors[i] && <p className="mt-1 text-xs text-destructive">{errors[i]}</p>}
            <p className="mt-2 text-sm text-salin-muted">
              {draft.content.rows.length.toLocaleString()} record{draft.content.rows.length === 1 ? "" : "s"} · {draft.content.columns.length} column{draft.content.columns.length === 1 ? "" : "s"}:{" "}
              {draft.content.columns
                .slice(0, 5)
                .map((c) => c.name)
                .join(", ")}
              {draft.content.columns.length > 5 ? "…" : ""}
            </p>
          </li>
        ))}
      </ul>
      {tried && duplicate && <p className="mt-2 text-sm text-destructive">Give each dataset a different name.</p>}
      {unchecked > 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          {unchecked} optional value{unchecked === 1 ? " wasn't" : "s weren't"} checked. They're saved as read — the dataset will be marked “Needs review”.
        </p>
      )}
      <p className="mt-3 text-xs text-salin-muted">The original photos and PDFs stay unchanged in your workspace.</p>

      <StepFooter>
        <button type="button" onClick={onBack} className={secondaryButton}>
          <ArrowLeft className="size-4" /> Back
        </button>
        <button type="button" onClick={() => void create()} disabled={busy || drafts.length === 0} className={primaryButton}>
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          {drafts.length > 1 ? `Create ${drafts.length} datasets` : "Create dataset"}
        </button>
      </StepFooter>
    </div>
  );
}
