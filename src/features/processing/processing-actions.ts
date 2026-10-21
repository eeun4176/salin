/**
 * Processing Actions
 * The write side of the data tools UI. `extractData` turns workspace files
 * into a dataset with a progress toast (with Cancel, and Retry on failure;
 * a scanned PDF goes on to text recognition by itself);
 * `extractTables` does the same for tables confirmed in an Excel workbook;
 * the others export, rename and delete datasets (delete has Undo). Uses one
 * processing service for the whole app, so a job keeps running while the
 * user moves between screens.
 */

import type { ExportFormat, ExportInput } from "@/core/processing/dataset-export";
import { createProcessingService, type ProcessingResult } from "@/core/processing/processing.service";
import { errorMessage } from "@/core/storage/errors";
import * as datasets from "@/core/storage/repositories/dataset.repository";
import type { JobOptions, ProcessingJob, TableSelection } from "@/types/processing";
import { downloadBlob } from "@/lib/download";
import { toast, useToastStore } from "@/stores/toast-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const service = createProcessingService();

/** Export choices shown in menus. Kept here so menus don't pull the exporter (SheetJS, Papa Parse) into the main bundle. */
export const EXPORT_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "Excel" },
  { format: "json", label: "JSON" },
];

/** Called with the new dataset's id once extraction succeeds (usually: open it). */
export type OnDatasetReady = (datasetId: string) => void;

function describe(fileIds: string[]) {
  if (fileIds.length > 1) return `${fileIds.length} documents`;
  const file = useWorkspaceStore.getState().files.find((f) => f.id === fileIds[0]);
  return file ? `“${file.name}”` : "the document";
}

type Run = (onProgress: (update: { progress: number }) => void) => Promise<ProcessingResult>;

/**
 * Runs a job behind a live progress toast ("… 45%", with Cancel) and reports
 * failures. Resolves to the new dataset's id, or `null` if it didn't finish.
 * A successful Retry (from the failure toast) calls `onReady`.
 */
async function runWithProgress(job: ProcessingJob, onReady: OnDatasetReady, run: Run): Promise<string | null> {
  const label = describe(job.sourceFileIds);
  const toasts = useToastStore.getState();
  const toastId = toast(`Extracting data from ${label}…`, { label: "Cancel", onClick: () => void service.cancel(job.id) }, { duration: null });
  let shown = -1;
  const onProgress = ({ progress }: { progress: number }) => {
    const percent = Math.floor(progress * 100);
    if (percent === shown) return;
    shown = percent;
    toasts.update(toastId, `Extracting data from ${label}… ${percent}%`);
  };

  let result: ProcessingResult;
  try {
    result = await run(onProgress);
  } catch (error) {
    console.error(error);
    toast(errorMessage(error, "The data couldn't be extracted. Please try again."));
    return null;
  } finally {
    toasts.dismiss(toastId);
  }

  const { job: done, dataset } = result;
  if (dataset) return dataset.id;
  if (done.status === "cancelled") {
    toast("Extraction cancelled.");
    return null;
  }
  // Retrying can't help when the file type or its content is the problem.
  const retryable = done.error?.code !== "unsupported-file" && done.error?.code !== "no-content";
  // A scanned PDF (no text layer) is read with OCR instead.
  const files = useWorkspaceStore.getState().files;
  const scanned = done.error?.code === "no-content" && done.sourceFileIds.every((id) => files.find((f) => f.id === id)?.kind === "pdf");
  if (scanned) {
    toast("This PDF is a scan, so it's read with text recognition instead.");
    void readWithOcr(done.sourceFileIds);
    return null;
  }
  toast(done.error?.message ?? "The data couldn't be extracted.", retryable ? { label: "Retry", onClick: () => void retry(done, onReady) } : undefined, { duration: 8000 });
  return null;
}

/** Opens the Read text (OCR) workflow for scanned PDFs. Loaded on demand (the router imports this module). */
async function readWithOcr(fileIds: string[]) {
  const [{ router }, { scanUrl, startScan }] = await Promise.all([import("@/app/router"), import("@/features/ocr/ocr-actions")]);
  const files = useWorkspaceStore.getState().files.filter((f) => fileIds.includes(f.id));
  const id = await startScan(files);
  if (id) await router.navigate(scanUrl(id));
}

async function retry(job: ProcessingJob, onReady: OnDatasetReady) {
  const id = await runWithProgress(job, onReady, (onProgress) => service.retry(job.id, { onProgress }));
  if (id) onReady(id);
}

async function queueAndRun(fileIds: string[], options: JobOptions, onReady: OnDatasetReady) {
  let job: ProcessingJob;
  try {
    job = await service.queue(fileIds, options);
  } catch (error) {
    toast(errorMessage(error, "The data couldn't be extracted. Please try again."));
    return null;
  }
  return runWithProgress(job, onReady, (onProgress) => service.run(job.id, { onProgress }));
}

/**
 * Turns workspace files into one dataset, entirely on this device. Files are
 * combined in the given order. Calls `onReady` with the dataset id when done.
 */
export async function extractData(fileIds: string[], onReady: OnDatasetReady): Promise<string | null> {
  const id = await queueAndRun(fileIds, {}, onReady);
  if (id) onReady(id);
  return id;
}

/** One dataset to make from a workbook: its name and the confirmed tables it combines. */
export interface TableGroup {
  name: string;
  tables: TableSelection[];
}

/**
 * Extracts the tables the user confirmed in an Excel workbook, one dataset per
 * group. Calls `onDone` with the ids of the datasets that were made.
 */
export async function extractTables(fileId: string, groups: TableGroup[], onDone: (datasetIds: string[]) => void) {
  const ids: string[] = [];
  for (const group of groups) {
    const id = await queueAndRun([fileId], { datasetName: group.name, tables: { [fileId]: group.tables } }, (retried) => onDone([retried]));
    if (id) ids.push(id);
  }
  if (ids.length) onDone(ids);
}

/* ------------------------------------------------------------------
   Datasets
------------------------------------------------------------------- */

function sourceNames() {
  return new Map(useWorkspaceStore.getState().files.map((f) => [f.id, f.name]));
}

/** Downloads a dataset as CSV, Excel or JSON. The exporter loads on first use. */
export async function downloadDataset(datasetId: string, input: Omit<ExportInput, "sourceNames">, format: ExportFormat) {
  try {
    const { exportDataset } = await import("@/core/processing/dataset-export");
    const blob = exportDataset({ ...input, sourceNames: sourceNames() }, format);
    downloadBlob(blob, `${input.name}.${format}`);
    await datasets.markDatasetExported(datasetId);
  } catch (error) {
    console.error(error);
    toast(errorMessage(error, "The export couldn't be created. Please try again."));
  }
}

/** Exports a saved dataset straight from IndexedDB (from the Datasets list). */
export async function downloadSavedDataset(datasetId: string, format: ExportFormat) {
  try {
    const { dataset, rows } = await datasets.getDatasetWithRows(datasetId);
    await downloadDataset(datasetId, { name: dataset.name, content: { columns: dataset.columns, rows } }, format);
  } catch (error) {
    toast(errorMessage(error, "The export couldn't be created. Please try again."));
  }
}

/** Throws on invalid names so the name dialog can show the message inline. */
export function renameDataset(datasetId: string, name: string) {
  return datasets.renameDataset(datasetId, name);
}

export async function deleteDataset(datasetId: string) {
  try {
    const snapshot = await datasets.deleteDataset(datasetId);
    toast(`Deleted “${snapshot.dataset.name}”.`, {
      label: "Undo",
      onClick: () => void datasets.restoreDataset(snapshot).catch((error) => toast(errorMessage(error))),
    });
    return true;
  } catch (error) {
    toast(errorMessage(error));
    return false;
  }
}
