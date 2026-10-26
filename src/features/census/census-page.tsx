/**
 * Census Page (/census)
 * The paravet's census home: print blank working sheets, scan filled ones,
 * and see the records per barangay and census date — how many pets are
 * Validated (counted in the official report), Pending or Unreadable, with a
 * link back to the scan to fix each open one. "Export official workbook"
 * fills the City Veterinary Office's census workbook from validated records;
 * "Send to City Vet" previews and queues the same records as an e-Kapon
 * census submission (paravets, for their own barangay). From 760px wide it
 * follows the workspace: the census list in its own pane, and the census
 * picked there (`?record=`) opens in the detail pane beside it.
 */

import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Camera, CircleAlert, CircleCheck, CircleHelp, ClipboardList, FileSpreadsheet, LoaderCircle, Printer, Send, Table2, X } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { MoreDetails } from "@/components/common/more-details";
import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { PageFrame } from "@/components/layout/page-frame";
import type { CensusSendPlan } from "@/core/census/admin-submission";
import type { RecordStatus } from "@/core/census/census-records";
import { censusSendPlan, exportOfficialWorkbook, sendCensus, useCensusRecords, type CensusSummary } from "@/features/census/census-actions";
import { PaneDivider } from "@/features/home/home-layout";
import { useDesktopLayout } from "@/hooks/use-desktop-layout";
import { useOnline } from "@/hooks/use-online";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/stores/toast-store";
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

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function SendPreview({ plan, sentAt }: { plan: CensusSendPlan; sentAt: number | null | undefined }) {
  return (
    <div className="space-y-2">
      <p>
        {plural(plan.owners, "owner")} and {plural(plan.pets, "Validated pet")} go to the City Veterinary Office for review
        {plan.parts.length > 1 ? `, in ${plan.parts.length} parts` : ""}. Your scans and photos stay on this device.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        {plan.held > 0 && <li>{plural(plan.held, "pet")} still Pending or Unreadable won't be sent. Fix them first to include them.</li>}
        {plan.noAddress > 0 && <li>{plural(plan.noAddress, "owner")} with no address: the barangay is sent as the address.</li>}
        {plan.droppedContacts > 0 && <li>{plural(plan.droppedContacts, "contact number")} that isn't a mobile number won't be sent.</li>}
        {sentAt && <li>You already sent this census on {formatDate(sentAt)}. Sending again makes another submission for City Vet to review.</li>}
      </ul>
    </div>
  );
}

const RECORD_PARAM = "record";
const DESCRIPTION = "Print working sheets, scan them after the field visit, and export the official census workbook.";
const toolButton = "press grid size-9 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-text";

/** One census: its counts, actions and the records not counted yet (open from the start in the detail pane). */
function RecordsCard({ summary, detailed = false }: { summary: CensusSummary; detailed?: boolean }) {
  const { dataset, counts, open } = summary;
  const [exporting, setExporting] = useState(false);
  const [plan, setPlan] = useState<CensusSendPlan | null>(null);
  const session = useAuthStore((state) => state.session);
  const online = useOnline();
  const total = counts.Validated + counts.Pending + counts.Unreadable;
  // e-Kapon files a census under the paravet's own barangay, so only that barangay's census may go.
  const cannotSend =
    session?.role !== "Paravet"
      ? "Only paravet accounts send census records"
      : session.barangay?.toLowerCase() !== dataset.origin.barangay.toLowerCase()
        ? `Your account is for ${session.barangay ?? "no barangay"}`
        : counts.Validated === 0
          ? "Nothing is validated yet"
          : null;

  return (
    <div className={detailed ? undefined : "rounded-2xl p-4 ring-1 ring-salin-border"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn("font-semibold text-salin-text", detailed && "text-xl tracking-[-0.02em]")}>{dataset.name}</h3>
          <p className="mt-0.5 text-xs text-salin-muted">
            {total} pet{total === 1 ? "" : "s"} · last scan saved {formatDate(dataset.updatedAt)}
            {dataset.lastExportedAt ? ` · exported ${formatDate(dataset.lastExportedAt)}` : ""}
            {dataset.lastSentAt ? ` · sent to City Vet ${formatDate(dataset.lastSentAt)}` : ""}
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
          <button
            type="button"
            disabled={Boolean(cannotSend)}
            title={cannotSend ?? undefined}
            onClick={() => void censusSendPlan(dataset).then(setPlan, () => toast("The census records couldn't be read. Try again."))}
            className={cn(secondaryButton, "h-10 disabled:opacity-50")}
          >
            <Send className="size-4" /> Send to City Vet
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={plan !== null}
        onOpenChange={(next) => !next && setPlan(null)}
        title="Send census to City Vet?"
        description={plan && <SendPreview plan={plan} sentAt={dataset.lastSentAt} />}
        confirmLabel="Send"
        onConfirm={async () => {
          if (!plan) return;
          try {
            await sendCensus(dataset, plan);
            toast(online ? "Census queued for City Vet. It's sending now." : "Census saved to send. It goes to City Vet when you're back online.");
          } catch (error) {
            toast(error instanceof Error ? error.message : "The census couldn't be saved to send. Try again.");
          }
        }}
      />

      {open.length > 0 && (
        <details open={detailed || undefined} className="mt-3 text-sm">
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
    </div>
  );
}

/** A census in the desktop list; picking it opens it in the detail pane. */
function RecordRow({ summary, active }: { summary: CensusSummary; active: boolean }) {
  const { dataset, counts } = summary;
  return (
    <Link
      to={{ search: `?${RECORD_PARAM}=${dataset.id}` }}
      replace
      aria-current={active ? "true" : undefined}
      className={cn("block rounded-2xl p-3.5 ring-1", active ? "bg-salin-primary/10 ring-salin-primary/40" : "ring-salin-border hover:bg-salin-tile")}
    >
      <span className="block truncate font-semibold text-salin-text">{dataset.name}</span>
      <span className="mt-0.5 block text-xs text-salin-muted">
        {plural(counts.Validated + counts.Pending + counts.Unreadable, "pet")} · last scan saved {formatDate(dataset.updatedAt)}
      </span>
      <span className="mt-2 flex flex-wrap gap-1.5">
        {(["Validated", "Pending", "Unreadable"] as const).map((s) => (
          <StatusCount key={s} status={s} count={counts[s]} />
        ))}
      </span>
    </Link>
  );
}

function CensusActions() {
  return (
    <>
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
    </>
  );
}

/** Loading, failed or empty: what the records list shows before there's a census to list. */
function RecordsPlaceholder({ status }: { status: "loading" | "error" | "ready" }) {
  if (status === "loading") return <LoadingSkeleton label="Loading census records" className="mt-3" />;
  if (status === "error") {
    return (
      <p role="alert" className="py-10 text-center text-sm text-salin-muted">
        The census records couldn't be loaded. Reload the page to try again.
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
        <FileSpreadsheet className="size-6" />
      </span>
      <p className="mt-4 font-semibold text-salin-text">No census records yet</p>
      <p className="mt-1 max-w-sm text-sm text-salin-muted">Print sheets for a barangay, fill them in the field, then scan them. Each barangay and census date gets its own records.</p>
    </div>
  );
}

export function CensusPage() {
  const state = useCensusRecords();
  const desktop = useDesktopLayout();
  const [params, setParams] = useSearchParams();
  const [listWidth, setListWidth] = useState(360);
  const summaries = state.status === "ready" ? state.summaries : [];
  const selected = summaries.find((summary) => summary.dataset.id === params.get(RECORD_PARAM));
  const heading = (
    <h2 id="records-heading" className={desktop ? "text-sm font-semibold text-salin-text" : "text-lg font-semibold text-salin-text"}>
      Census records
    </h2>
  );

  if (!desktop) {
    return (
      <PageFrame title="Census" description={DESCRIPTION}>
        <CensusActions />
        <section aria-labelledby="records-heading" className="mt-6">
          {heading}
          {summaries.length ? (
            <ul className="mt-3 space-y-3">
              {summaries.map((summary) => (
                <li key={summary.dataset.id}>
                  <RecordsCard summary={summary} />
                </li>
              ))}
            </ul>
          ) : (
            <RecordsPlaceholder status={state.status} />
          )}
        </section>
      </PageFrame>
    );
  }

  return (
    <div className="grid min-h-dvh" style={{ gridTemplateColumns: `${listWidth}px 6px minmax(0,1fr)` }}>
      <main id="main" className="sticky top-0 h-dvh overflow-y-auto bg-salin-surface px-4 pt-6 pb-8" data-lenis-prevent="">
        <div className="relative mb-4">
          <h1 className="text-2xl leading-tight font-bold tracking-[-0.03em] text-salin-text">
            Census
            <MoreDetails>{DESCRIPTION}</MoreDetails>
          </h1>
        </div>
        <CensusActions />
        <section aria-labelledby="records-heading" className="mt-6">
          {heading}
          {summaries.length ? (
            <ul className="mt-3 space-y-2">
              {summaries.map((summary) => (
                <li key={summary.dataset.id}>
                  <RecordRow summary={summary} active={summary === selected} />
                </li>
              ))}
            </ul>
          ) : (
            <RecordsPlaceholder status={state.status} />
          )}
        </section>
      </main>
      <PaneDivider width={listWidth} onResize={setListWidth} />
      <section aria-label="Census details" className="sticky top-0 h-dvh min-w-0 overflow-y-auto bg-salin-surface" data-lenis-prevent="">
        {selected ? (
          <div key={selected.dataset.id} className="motion-safe:animate-detail-in">
            <div className="flex h-[60px] items-center border-b border-salin-border px-3">
              <button type="button" aria-label="Close census" onClick={() => setParams({}, { replace: true })} className={toolButton}>
                <X className="size-5" />
              </button>
            </div>
            <div className="p-6">
              <RecordsCard summary={selected} detailed />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
              <ClipboardList className="size-6" />
            </span>
            <p className="mt-4 font-semibold text-salin-text">Select a census</p>
            <p className="mt-1 max-w-xs text-sm text-salin-muted">Pick one from the list to see its counts, export the official workbook or send it to City Vet.</p>
          </div>
        )}
      </section>
    </div>
  );
}
