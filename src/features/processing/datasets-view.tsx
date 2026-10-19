/**
 * Datasets View (/datasets)
 * Datasets inside the workspace card (Workspace › Datasets): scans still
 * being read or reviewed (to continue), then every table extracted from the
 * user's documents — filtered by the search field and by review status,
 * sorted by last change, name or size. Each row shows its size, review
 * status, where it came from (file or scan) and last change, with a ⋮ menu.
 * Rows stack cleanly on phones. "New dataset" opens the document picker.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, CircleCheck, House, Plus, ScanText, Table2, TriangleAlert } from "lucide-react";

import { DatasetActions } from "@/features/processing/components/dataset-actions";
import { DocumentPickerDialog } from "@/features/processing/components/document-picker-dialog";
import { useDatasets } from "@/features/processing/hooks/use-datasets";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { useScans } from "@/features/ocr/hooks/use-scan";
import { scanUrl } from "@/features/ocr/ocr-actions";
import { formatDate } from "@/features/workspace/query";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import type { Dataset } from "@/types/processing";
import type { OcrDocument } from "@/types/ocr";

type StatusFilter = "all" | "needs_review" | "reviewed";
type SortKey = "updated" | "name" | "rows";

const SORTS: Record<SortKey, { label: string; compare: (a: Dataset, b: Dataset) => number }> = {
  updated: { label: "Last edited", compare: (a, b) => b.updatedAt - a.updatedAt },
  name: { label: "Name", compare: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) },
  rows: { label: "Most rows", compare: (a, b) => b.rowCount - a.rowCount },
};

const STAGE_LABEL: Record<OcrDocument["stage"], string> = { prepare: "Preparing pages", read: "Reading", review: "Ready to review", done: "Saved" };

function StatusBadge({ reviewed }: { reviewed: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        reviewed ? "bg-salin-primary-soft text-salin-primary-ink" : "bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
      )}
    >
      {reviewed ? <CircleCheck className="size-3" /> : <TriangleAlert className="size-3" />}
      {reviewed ? "Reviewed" : "Needs review"}
    </span>
  );
}

function DatasetRow({ dataset }: { dataset: Dataset }) {
  const fromScan = dataset.origin?.kind === "ocr";
  const Icon = fromScan ? ScanText : Table2;
  return (
    <li className="relative flex items-start gap-3 px-3 py-3 transition-colors hover:bg-salin-tile has-[a:focus-visible]:bg-salin-tile sm:items-center sm:px-4">
      <span aria-hidden="true" className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-salin-primary-soft text-salin-primary sm:mt-0">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to={datasetUrl(dataset.id)}
          className="line-clamp-2 text-sm font-semibold break-words text-salin-text outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
        >
          {dataset.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-salin-muted">
          <StatusBadge reviewed={dataset.status === "reviewed"} />
          <span>
            {dataset.rowCount.toLocaleString()} row{dataset.rowCount === 1 ? "" : "s"} · {dataset.columns.length} column{dataset.columns.length === 1 ? "" : "s"}
          </span>
          {fromScan && <span>· from a scan</span>}
          <span>· Edited {formatDate(dataset.updatedAt)}</span>
        </div>
      </div>
      <DatasetActions dataset={dataset} className="relative z-10 -mr-1 hover:bg-salin-surface" />
    </li>
  );
}

function ScansInProgress({ scans }: { scans: OcrDocument[] }) {
  if (scans.length === 0) return null;
  return (
    <section aria-labelledby="scans-heading" className="mt-5">
      <h3 id="scans-heading" className="text-sm font-semibold text-salin-text">
        Scans in progress <span className="font-normal text-salin-muted">({scans.length})</span>
      </h3>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {scans.map((scan) => (
          <li key={scan.id}>
            <Link to={scanUrl(scan.id)} className="press flex items-center gap-3 rounded-2xl bg-salin-tile px-3 py-2.5 hover:bg-salin-tile-hover">
              <ScanText aria-hidden="true" className="size-5 shrink-0 text-salin-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-salin-text">{scan.name}</span>
                <span className="block truncate text-xs text-salin-muted">
                  {STAGE_LABEL[scan.stage]} · {scan.fileIds.length} file{scan.fileIds.length === 1 ? "" : "s"} · {formatDate(scan.updatedAt)}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-salin-primary">
                Continue <ChevronRight className="size-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DatasetsView() {
  const state = useDatasets();
  const scans = useScans();
  const query = useUiStore((s) => s.query).trim().toLowerCase();
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("updated");

  const datasets = useMemo(() => (state.status === "ready" ? state.datasets : []), [state]);
  const counts = { all: datasets.length, needs_review: datasets.filter((d) => d.status === "needs_review").length, reviewed: datasets.filter((d) => d.status === "reviewed").length };
  const shown = datasets
    .filter((d) => (!query || d.name.toLowerCase().includes(query)) && (status === "all" || d.status === status))
    .sort(SORTS[sort].compare);
  const open = (scans ?? []).filter((s) => s.stage !== "done" && (!query || s.name.toLowerCase().includes(query)));

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mt-5 md:mt-6">
        <ol className="flex items-center gap-1 text-[13px]">
          <li>
            <Link to="/" className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-salin-muted hover:bg-salin-tile hover:text-salin-text">
              <House className="size-3.5" /> Workspace
            </Link>
          </li>
          <li className="flex items-center gap-1">
            <ChevronRight aria-hidden="true" className="size-3.5 text-salin-subtle" />
            <span aria-current="page" className="px-1.5 py-1 font-semibold text-salin-text">
              Datasets
            </span>
          </li>
        </ol>
      </nav>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-salin-text md:text-2xl">Datasets</h2>
          <p className="mt-0.5 text-xs text-salin-muted">Tables extracted from your documents and scans. They stay on this device.</p>
        </div>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="press inline-flex h-10 items-center gap-1.5 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgb(1_168_90/0.7)] hover:bg-salin-primary-strong"
        >
          <Plus className="size-4" /> New dataset
        </button>
      </div>

      <ScansInProgress scans={open} />

      {datasets.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div role="radiogroup" aria-label="Show" className="no-scrollbar -mx-1 flex max-w-full gap-1 overflow-x-auto px-1" data-lenis-prevent-horizontal="">
            {(["all", "needs_review", "reviewed"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={status === key}
                onClick={() => setStatus(key)}
                className={cn(
                  "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium ring-1 transition-colors",
                  status === key ? "bg-salin-text text-salin-surface ring-salin-text" : "text-salin-muted ring-salin-border hover:text-salin-text",
                )}
              >
                {key === "all" ? "All" : key === "needs_review" ? "Needs review" : "Reviewed"} <span className="opacity-70">{counts[key]}</span>
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-[13px] text-salin-muted">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-8 rounded-lg border border-salin-border bg-salin-surface px-2 text-[13px] text-salin-text outline-none focus:border-salin-primary">
              {(Object.keys(SORTS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORTS[key].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="mt-3">
        {state.status === "loading" ? (
          <p role="status" className="py-14 text-center text-sm text-salin-muted">
            Loading datasets…
          </p>
        ) : state.status === "error" ? (
          <p role="alert" className="py-14 text-center text-sm text-salin-muted">
            Datasets couldn't be loaded. Reload the page to try again.
          </p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
              <Table2 className="size-6" />
            </span>
            <p className="mt-4 font-semibold text-salin-text">{query || status !== "all" ? "No matches" : "No datasets yet"}</p>
            <p className="mt-1 max-w-sm text-sm text-salin-muted">
              {query || status !== "all"
                ? "No dataset matches your search or filter."
                : "Turn a PDF, Excel, CSV or text file into an editable table with New dataset or ⋮ → Extract data — or read a photo or scanned PDF with ⋮ → Read text."}
            </p>
          </div>
        ) : (
          <ul aria-label="Datasets" className="divide-y divide-salin-border overflow-hidden rounded-2xl ring-1 ring-salin-border">
            {shown.map((dataset) => (
              <DatasetRow key={dataset.id} dataset={dataset} />
            ))}
          </ul>
        )}
      </div>

      <DocumentPickerDialog open={picking} onOpenChange={setPicking} />
    </div>
  );
}
