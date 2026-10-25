/**
 * Dataset Detail Pane
 * The dashboard's right pane on Datasets (760px and wider): the dataset
 * picked in the list (the `?dataset=` URL parameter) as an editable table —
 * click a cell to fix it; changes autosave — beside a live chart of its
 * number columns, with Export (Excel, CSV, JSON)
 * and a link to the full review screen for Transform, Ask and the rest.
 * Phones open datasets on the full review screen instead.
 */

import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CircleCheck, Maximize2, ScanText, Table2, TriangleAlert, X } from "lucide-react";

import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { OcrSourceDialog } from "@/features/ocr/components/ocr-source-dialog";
import { DatasetChart } from "@/features/processing/components/dataset-chart";
import { DatasetTable } from "@/features/processing/components/dataset-table";
import { ExportMenu, SaveIndicator } from "@/features/processing/dataset-review-page";
import { useDatasetReview } from "@/features/processing/hooks/use-dataset-review";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { downloadDataset } from "@/features/processing/processing-actions";
import { usePreviewFile } from "@/features/workspace/use-open-item";
import { toast } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SourceReference } from "@/types/processing";

export const DATASET_PARAM = "dataset";

const toolButton = "press grid size-9 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-text";

function DatasetDetailView({ datasetId, onClose }: { datasetId: string; onClose: () => void }) {
  const review = useDatasetReview(datasetId);
  const files = useWorkspaceStore((s) => s.files);
  const sourceNames = useMemo(() => new Map(files.filter((f) => f.deletedAt === null).map((f) => [f.id, f.name])), [files]);
  const previewFile = usePreviewFile();
  const [ocrSource, setOcrSource] = useState<SourceReference | null>(null);
  const onViewSource = useCallback(
    (source: SourceReference) => (source.ocr ? setOcrSource(source) : sourceNames.has(source.fileId) ? previewFile(source.fileId) : toast("That document was deleted.")),
    [previewFile, sourceNames],
  );
  const { dataset, draft } = review;

  if (review.load.status === "loading") return <LoadingSkeleton label="Opening dataset" rows={4} className="p-4" />;
  if (review.load.status !== "ready") {
    return (
      <p role={review.load.status === "error" ? "alert" : "status"} className="grid h-full place-items-center px-6 text-center text-sm text-salin-muted">
        {review.load.status === "error" ? review.load.message : "Opening dataset…"}
      </p>
    );
  }

  const reviewed = dataset?.status === "reviewed";
  return (
    <div className="flex h-full flex-col motion-safe:animate-detail-in">
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-salin-border px-3">
        <button type="button" aria-label="Close dataset" onClick={onClose} className={toolButton}>
          <X className="size-5" />
        </button>
        <span className="flex-1" />
        <Link to={datasetUrl(datasetId)} className="press inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-salin-text hover:bg-salin-tile">
          <Maximize2 className="size-4" /> Open full review
        </Link>
      </div>

      <div className="shrink-0 px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className={reviewed ? "inline-flex items-center gap-1 rounded-full bg-salin-primary-soft px-2 py-0.5 text-salin-primary-ink" : "inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"}>
            {reviewed ? <CircleCheck className="size-3" /> : <TriangleAlert className="size-3" />} {reviewed ? "Reviewed" : "Needs review"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-salin-tile px-2 py-0.5 text-salin-muted">
            {dataset?.origin?.kind === "ocr" ? <ScanText className="size-3" /> : <Table2 className="size-3" />} {dataset?.origin?.kind === "ocr" ? "From a scan" : "Dataset"}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-[-0.01em] break-words text-salin-text">{draft.name}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-salin-muted">
              <span>
                {draft.rows.length.toLocaleString()} row{draft.rows.length === 1 ? "" : "s"} · {draft.columns.length} column{draft.columns.length === 1 ? "" : "s"}
              </span>
              <span aria-hidden="true">·</span>
              <SaveIndicator save={review.save} onRetry={() => void review.flush()} />
            </p>
          </div>
          <ExportMenu
            onExport={(format) =>
              void review.flush().then(() => downloadDataset(datasetId, { name: draft.name.trim() || "Dataset", content: draft }, format))
            }
          />
        </div>
      </div>

      <div className="@container min-h-0 flex-1 overflow-auto px-6 pb-6" data-lenis-prevent="">
        <div className="grid items-start gap-4 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            <DatasetTable review={review} issuesOnly={false} sourceNames={sourceNames} onViewSource={onViewSource} />
          </div>
          <DatasetChart columns={draft.columns} rows={draft.rows} className="@3xl:sticky @3xl:top-0" />
        </div>
      </div>

      <OcrSourceDialog
        source={ocrSource?.ocr ?? null}
        onClose={() => setOcrSource(null)}
        onOpenFile={() => {
          const fileId = ocrSource?.fileId;
          setOcrSource(null);
          if (fileId) previewFile(fileId);
        }}
      />
    </div>
  );
}

/** The right-hand pane on Datasets: the picked dataset, keyed so each new pick slides in. */
export function DatasetDetail() {
  const [params, setParams] = useSearchParams();
  const datasetId = params.get(DATASET_PARAM);
  const close = () =>
    setParams((next) => {
      next.delete(DATASET_PARAM);
      return next;
    });

  return (
    <section aria-label="Dataset details" className="sticky top-0 h-dvh min-w-0 bg-salin-surface">
      {datasetId ? (
        <DatasetDetailView key={datasetId} datasetId={datasetId} onClose={close} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
            <Table2 className="size-6" />
          </span>
          <p className="mt-4 font-semibold text-salin-text">Select a dataset</p>
          <p className="mt-1 max-w-xs text-sm text-salin-muted">Pick one from the list to see and edit its table here, then export it to Excel.</p>
        </div>
      )}
    </section>
  );
}
