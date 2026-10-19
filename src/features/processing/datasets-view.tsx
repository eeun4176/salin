/**
 * Datasets View (/datasets)
 * The Datasets tab of the workspace card: every table extracted from the
 * user's documents (filtered by the search field), each showing its size,
 * review status and last change, with a ⋮ menu. "New dataset" opens the
 * document picker; the empty state explains how to make the first one.
 */

import { useState } from "react";
import { Link } from "react-router";
import { CircleCheck, Plus, Table2, TriangleAlert } from "lucide-react";

import { DatasetActions } from "@/features/processing/components/dataset-actions";
import { DocumentPickerDialog } from "@/features/processing/components/document-picker-dialog";
import { useDatasets } from "@/features/processing/hooks/use-datasets";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { formatDate } from "@/features/workspace/query";
import { useUiStore } from "@/stores/ui-store";
import type { Dataset } from "@/types/processing";

function DatasetRow({ dataset }: { dataset: Dataset }) {
  const reviewed = dataset.status === "reviewed";
  return (
    <li className="group relative flex items-center gap-3 rounded-2xl bg-salin-tile py-2.5 pr-1.5 pl-3 transition-colors hover:bg-salin-tile-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-salin-primary">
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-salin-surface text-salin-primary">
        <Table2 className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link to={datasetUrl(dataset.id)} className="block truncate text-sm font-semibold text-salin-text outline-none after:absolute after:inset-0 after:rounded-2xl">
          {dataset.name}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-salin-muted">
          <span>
            {dataset.rowCount.toLocaleString()} rows · {dataset.columns.length} columns
          </span>
          <span aria-hidden="true">·</span>
          <span className={reviewed ? "inline-flex items-center gap-1 text-salin-primary-ink" : "inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"}>
            {reviewed ? <CircleCheck className="size-3" /> : <TriangleAlert className="size-3" />}
            {reviewed ? "Reviewed" : "Needs review"}
          </span>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <span className="hidden sm:inline">Edited {formatDate(dataset.updatedAt)}</span>
        </p>
      </div>
      <DatasetActions dataset={dataset} className="relative" />
    </li>
  );
}

export function DatasetsView() {
  const state = useDatasets();
  const query = useUiStore((s) => s.query).trim().toLowerCase();
  const [picking, setPicking] = useState(false);

  const datasets = state.status === "ready" ? state.datasets : [];
  const shown = query ? datasets.filter((d) => d.name.toLowerCase().includes(query)) : datasets;

  return (
    <div className="mt-5 md:mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-salin-text md:text-2xl">Datasets</h2>
          <p className="mt-0.5 text-xs text-salin-muted">Tables extracted from your documents. They stay on this device.</p>
        </div>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="press inline-flex h-10 items-center gap-1.5 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgb(1_168_90/0.7)] hover:bg-salin-primary-strong"
        >
          <Plus className="size-4" /> New dataset
        </button>
      </div>

      <div className="mt-5">
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
            <p className="mt-4 font-semibold text-salin-text">{query ? "No matches" : "No datasets yet"}</p>
            <p className="mt-1 max-w-sm text-sm text-salin-muted">
              {query
                ? "No dataset name matches your search."
                : "Turn a PDF, Excel, CSV or text file into an editable table. Use New dataset, or ⋮ → Extract data on any file."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
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
