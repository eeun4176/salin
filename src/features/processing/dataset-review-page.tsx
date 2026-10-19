/**
 * Dataset Review Page (/datasets/:datasetId)
 * The lightweight review step after extraction: the dataset name, where the
 * data came from, an autosave indicator, Export (CSV / Excel / JSON) and
 * "Mark as reviewed", a note when cells need attention (with a filter to just
 * those rows), any notes from reading the files, and the editable table.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Check, ChevronDown, CircleAlert, Download, LoaderCircle, RotateCcw } from "lucide-react";

import { PageFrame } from "@/components/layout/page-frame";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExportFormat } from "@/core/processing/dataset-export";
import { listExtractionsForBlobs } from "@/core/storage/repositories/processing.repository";
import { DatasetTable } from "@/features/processing/components/dataset-table";
import { useDatasetReview, type DatasetReview, type SaveState } from "@/features/processing/hooks/use-dataset-review";
import { downloadDataset, EXPORT_FORMATS } from "@/features/processing/processing-actions";
import { usePreviewFile } from "@/features/workspace/use-open-item";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const secondaryButton =
  "press inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";

function SaveIndicator({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save.status === "error") {
    const conflict = save.message.includes("changed somewhere else");
    return (
      <span role="alert" className="inline-flex items-center gap-1.5 text-destructive">
        <CircleAlert className="size-3.5" /> {save.message}
        <button type="button" onClick={conflict ? () => window.location.reload() : onRetry} className="font-semibold underline">
          {conflict ? "Reload" : "Try again"}
        </button>
      </span>
    );
  }
  return (
    <span role="status" className="inline-flex items-center gap-1.5">
      {save.status === "saved" ? (
        <>
          <Check className="size-3.5 text-salin-primary" /> All changes saved
        </>
      ) : (
        <>
          <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> Saving…
        </>
      )}
    </span>
  );
}

function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={cn(secondaryButton, "data-[state=open]:ring-salin-primary")}>
        <Download className="size-4" /> Export <ChevronDown className="size-3.5 text-salin-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 rounded-xl p-1.5">
        {EXPORT_FORMATS.map(({ format, label }) => (
          <DropdownMenuItem key={format} className="py-2" onSelect={() => onExport(format)}>
            {label} <span className="ml-auto text-xs text-salin-subtle">.{format}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Parser notes ("Page 3 had no selectable text") for the dataset's source files. */
function useExtractionNotes(sourceFileIds: string[] | undefined) {
  const files = useWorkspaceStore((s) => s.files);
  const blobIds = useMemo(
    () => files.filter((f) => sourceFileIds?.includes(f.id)).map((f) => f.blobId),
    [files, sourceFileIds],
  );
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    listExtractionsForBlobs(blobIds)
      .then((docs) => active && setNotes(docs.flatMap((d) => d.warnings)))
      .catch(() => active && setNotes([]));
    return () => {
      active = false;
    };
  }, [blobIds]);
  return notes;
}

function ReviewHeader({ review, sourceNames, onViewSource }: { review: DatasetReview; sourceNames: Map<string, string>; onViewSource: (id: string) => void }) {
  const { dataset, draft, issues, save, nameError } = review;
  const reviewed = dataset?.status === "reviewed";
  const [busy, setBusy] = useState(false);

  async function exportAs(format: ExportFormat) {
    await review.flush();
    await downloadDataset(review.datasetId, { name: draft.name.trim() || "Dataset", content: draft }, format);
  }

  async function toggleReviewed() {
    setBusy(true);
    try {
      await review.setReviewed(!reviewed);
    } catch {
      toast("The review status couldn't be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-72">
        <input
          aria-label="Dataset name"
          aria-invalid={nameError ? true : undefined}
          value={draft.name}
          maxLength={255}
          onChange={(e) => review.rename(e.target.value)}
          className="-mx-2 w-[calc(100%+1rem)] rounded-lg bg-transparent px-2 py-1 text-xl font-semibold tracking-[-0.01em] text-salin-text outline-none hover:bg-salin-tile focus:bg-salin-surface focus:ring-2 focus:ring-salin-primary"
        />
        {nameError && <p className="mt-1 text-xs text-destructive">{nameError}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-salin-muted">
          <span>
            {draft.rows.length.toLocaleString()} row{draft.rows.length === 1 ? "" : "s"} · {draft.columns.length} column{draft.columns.length === 1 ? "" : "s"}
          </span>
          {dataset && dataset.sourceFileIds.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>from</span>
              {dataset.sourceFileIds.map((id, i) => (
                <span key={id}>
                  {sourceNames.has(id) ? (
                    <button type="button" onClick={() => onViewSource(id)} className="font-medium text-salin-primary hover:underline">
                      {sourceNames.get(id)}
                    </button>
                  ) : (
                    <span>a deleted document</span>
                  )}
                  {i < dataset.sourceFileIds.length - 1 && ","}
                </span>
              ))}
            </>
          )}
          <span aria-hidden="true">·</span>
          <SaveIndicator save={save} onRetry={() => void review.flush()} />
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <ExportMenu onExport={(format) => void exportAs(format)} />
        <button
          type="button"
          aria-pressed={reviewed}
          disabled={busy || (!reviewed && issues.length > 0)}
          title={!reviewed && issues.length > 0 ? "Fix the highlighted cells first" : undefined}
          onClick={() => void toggleReviewed()}
          className={cn(
            "press inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50",
            reviewed ? "bg-salin-primary-soft text-salin-primary-ink hover:bg-salin-primary-soft/70" : "bg-salin-primary text-white hover:bg-salin-primary-strong",
          )}
        >
          <Check className="size-4" /> {reviewed ? "Reviewed" : "Mark as reviewed"}
        </button>
      </div>
    </div>
  );
}

export function DatasetReviewPage() {
  const { datasetId = "" } = useParams();
  const review = useDatasetReview(datasetId);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const files = useWorkspaceStore((s) => s.files);
  const sourceNames = useMemo(() => new Map(files.filter((f) => f.deletedAt === null).map((f) => [f.id, f.name])), [files]);
  const previewFile = usePreviewFile();
  const onViewSource = useCallback((fileId: string) => (sourceNames.has(fileId) ? previewFile(fileId) : toast("That document was deleted.")), [previewFile, sourceNames]);
  const notes = useExtractionNotes(review.dataset?.sourceFileIds);
  const issueCount = review.issues.length;

  const frame = { title: "Review data", back: { to: "/datasets", label: "Datasets" } };

  if (review.load.status !== "ready") {
    return (
      <PageFrame {...frame}>
        {review.load.status === "loading" ? (
          <p role="status" className="py-12 text-center text-sm text-salin-muted">
            Opening dataset…
          </p>
        ) : (
          <div role="alert" className="py-12 text-center">
            <p className="font-semibold text-salin-text">Can't open this dataset</p>
            <p className="mt-1 text-sm text-salin-muted">{review.load.message}</p>
            <Link to="/datasets" className="mt-4 inline-block text-sm font-semibold text-salin-primary hover:underline">
              Back to datasets
            </Link>
          </div>
        )}
      </PageFrame>
    );
  }

  return (
    <PageFrame {...frame} description="Fix anything that looks off, then export.">
      <ReviewHeader review={review} sourceNames={sourceNames} onViewSource={onViewSource} />

      {issueCount > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          <CircleAlert className="size-4 shrink-0" />
          <span className="flex-1">
            {issueCount.toLocaleString()} cell{issueCount === 1 ? " needs" : "s need"} a look — empty required values or values that don't match the column type.
          </span>
          <button type="button" aria-pressed={issuesOnly} onClick={() => setIssuesOnly(!issuesOnly)} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
            {issuesOnly ? (
              <>
                <RotateCcw className="size-3.5" /> Show all rows
              </>
            ) : (
              "Show only these rows"
            )}
          </button>
        </div>
      ) : null}

      {notes.length > 0 && (
        <details className="mt-3 text-sm text-salin-muted">
          <summary className="cursor-pointer font-medium text-salin-text">
            {notes.length} note{notes.length === 1 ? "" : "s"} from reading the {notes.length === 1 ? "file" : "files"}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4">
        <DatasetTable review={review} issuesOnly={issuesOnly && issueCount > 0} sourceNames={sourceNames} onViewSource={onViewSource} />
      </div>
    </PageFrame>
  );
}
