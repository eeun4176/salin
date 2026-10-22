/**
 * Census Page (/census)
 * The paravet's census home: print blank working sheets, scan filled ones,
 * and see the records per barangay and census date — how many pets are
 * Validated (counted in the official report), Pending or Unreadable, with a
 * link back to the scan to fix each open one. "Export official workbook"
 * fills the City Veterinary Office's census workbook from validated records.
 */

import { useState } from "react";
import { Link } from "react-router";
import { Camera, CircleAlert, CircleCheck, CircleHelp, FileSpreadsheet, LoaderCircle, Printer, Table2 } from "lucide-react";

import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { PageFrame } from "@/components/layout/page-frame";
import type { RecordStatus } from "@/core/census/census-records";
import { exportOfficialWorkbook, useCensusRecords, type CensusSummary } from "@/features/census/census-actions";
import { scanUrl } from "@/features/ocr/ocr-actions";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { formatDate } from "@/features/workspace/query";
import { cn } from "@/lib/utils";

// Icon + word for each status, never colour alone.
const STATUS: Record<RecordStatus, { icon: typeof CircleCheck; className: string }> = {
  Validated: { icon: CircleCheck, className: "bg-salin-primary-soft text-salin-primary-ink" },
  Pending: { icon: CircleHelp, className: "bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300" },
  Unreadable: { icon: CircleAlert, className: "bg-destructive/10 text-destructive" },
};

function StatusCount({ status, count }: { status: RecordStatus; count: number }) {
  const { icon: Icon, className } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", className)}>
      <Icon aria-hidden="true" className="size-3.5" /> {count} {status}
    </span>
  );
}

function RecordsCard({ summary }: { summary: CensusSummary }) {
  const { dataset, counts, open } = summary;
  const [exporting, setExporting] = useState(false);
  const total = counts.Validated + counts.Pending + counts.Unreadable;

  return (
    <li className="rounded-2xl p-4 ring-1 ring-salin-border">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-salin-text">{dataset.name}</h3>
          <p className="mt-0.5 text-xs text-salin-muted">
            {total} pet{total === 1 ? "" : "s"} · last scan saved {formatDate(dataset.updatedAt)}
            {dataset.lastExportedAt ? ` · exported ${formatDate(dataset.lastExportedAt)}` : ""}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(["Validated", "Pending", "Unreadable"] as const).map((s) => (
              <StatusCount key={s} status={s} count={counts[s]} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={datasetUrl(dataset.id)} className={cn(secondaryButton, "h-10")}>
            <Table2 className="size-4" /> Records
          </Link>
          <button
            type="button"
            disabled={exporting || counts.Validated === 0}
            title={counts.Validated === 0 ? "Nothing is validated yet" : undefined}
            onClick={() => {
              setExporting(true);
              void exportOfficialWorkbook(dataset).finally(() => setExporting(false));
            }}
            className={cn(primaryButton, "h-10 disabled:opacity-50")}
          >
            {exporting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <FileSpreadsheet className="size-4" />} Export official workbook
          </button>
        </div>
      </div>

      {open.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-salin-text">
            {open.length} record{open.length === 1 ? "" : "s"} not counted yet — fix {open.length === 1 ? "it" : "them"} in the scan
          </summary>
          <ul className="mt-2 divide-y divide-salin-border rounded-xl ring-1 ring-salin-border">
            {open.map((r) => (
              <li key={`${r.sheet}-${r.pet}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <StatusCount status={r.status} count={1} />
                <span className="min-w-0 flex-1 text-salin-text">
                  Sheet {r.sheet}, pet {r.pet}
                  {r.owner ? ` · ${r.owner}` : ""}
                  {r.notes && <span className="block text-xs text-salin-muted">{r.notes}</span>}
                </span>
                {r.documentId && (
                  <Link to={scanUrl(r.documentId)} className="text-xs font-semibold text-salin-primary hover:underline">
                    Open scan
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function CensusPage() {
  const state = useCensusRecords();

  return (
    <PageFrame title="Census" description="Print working sheets, scan them after the field visit, and export the official census workbook.">
      <div className="flex flex-wrap gap-2">
        <Link to="/census/print" className={primaryButton}>
          <Printer className="size-4" /> Print forms
        </Link>
        <Link to="/scan" className={secondaryButton}>
          <Camera className="size-4" /> Scan filled sheets
        </Link>
      </div>
      <p className="mt-3 text-sm text-salin-muted">
        Only <strong className="font-semibold text-salin-text">Validated</strong> pets are counted in the official workbook. Pending and Unreadable ones are listed on a separate sheet until they're fixed.
      </p>

      <section aria-labelledby="records-heading" className="mt-6">
        <h2 id="records-heading" className="text-lg font-semibold text-salin-text">
          Census records
        </h2>
        {state.status === "loading" ? (
          <p role="status" className="py-10 text-center text-sm text-salin-muted">
            Loading census records…
          </p>
        ) : state.status === "error" ? (
          <p role="alert" className="py-10 text-center text-sm text-salin-muted">
            The census records couldn't be loaded. Reload the page to try again.
          </p>
        ) : state.summaries.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
              <FileSpreadsheet className="size-6" />
            </span>
            <p className="mt-4 font-semibold text-salin-text">No census records yet</p>
            <p className="mt-1 max-w-sm text-sm text-salin-muted">Print sheets for a barangay, fill them in the field, then scan them. Each barangay and census date gets its own records.</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {state.summaries.map((summary) => (
              <RecordsCard key={summary.dataset.id} summary={summary} />
            ))}
          </ul>
        )}
      </section>
    </PageFrame>
  );
}
