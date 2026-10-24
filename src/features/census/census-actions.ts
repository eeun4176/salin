/**
 * Census Actions
 * What the Census screens do: a live list of the census records (one dataset
 * per barangay and census date) with how many pets are Validated, Pending
 * or Unreadable and which scans to reopen for the open ones; and exporting
 * the office's official workbook filled from them, or sending them to City Vet
 * (queued in the outbox, so it works offline).
 */

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { censusChanges, planCensusSubmission, type CensusSendPlan } from "@/core/census/admin-submission";
import { COLUMN, type RecordStatus } from "@/core/census/census-records";
import type { CensusRecord } from "@/core/census/summary-workbook";
import { errorMessage } from "@/core/storage/errors";
import { censusContent, listCensusDatasets, type CensusDataset } from "@/core/storage/repositories/census.repository";
import { markDatasetExported, markDatasetSent } from "@/core/storage/repositories/dataset.repository";
import { downloadBlob } from "@/lib/download";
import { queueChange } from "@/stores/sync-store";
import { toast } from "@/stores/toast-store";
import type { DatasetContent } from "@/types/processing";

import templateUrl from "@/assets/census/census-form-template.xlsx?url";

export interface OpenRecord {
  sheet: number;
  pet: number;
  owner: string;
  status: RecordStatus;
  notes: string;
  /** The scan to reopen to fix it. */
  documentId: string | null;
}

export interface CensusSummary {
  dataset: CensusDataset;
  counts: Record<RecordStatus, number>;
  open: OpenRecord[];
}

function records(content: DatasetContent): CensusRecord[] {
  return content.rows.map((row) => Object.fromEntries(content.columns.map((c) => [c.name, row.values[c.id] ?? null])));
}

async function summarise(dataset: CensusDataset): Promise<CensusSummary> {
  const content = await censusContent(dataset);
  const counts: Record<RecordStatus, number> = { Validated: 0, Pending: 0, Unreadable: 0 };
  const open: OpenRecord[] = [];
  records(content).forEach((r, i) => {
    const status = (r[COLUMN.status] as RecordStatus) ?? "Pending";
    counts[status] = (counts[status] ?? 0) + 1;
    if (status !== "Validated") {
      open.push({
        sheet: Number(r[COLUMN.sheet]),
        pet: Number(r[COLUMN.pet]),
        owner: String(r[COLUMN.owner] ?? ""),
        status,
        notes: String(r[COLUMN.notes] ?? ""),
        documentId: content.rows[i].source?.ocr?.documentId ?? null,
      });
    }
  });
  return { dataset, counts, open };
}

type State = { status: "loading" } | { status: "ready"; summaries: CensusSummary[] } | { status: "error" };

export function useCensusRecords(): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const subscription = liveQuery(async () => Promise.all((await listCensusDatasets()).map(summarise))).subscribe({
      next: (summaries) => setState({ status: "ready", summaries }),
      error: (error) => {
        console.error(error);
        setState({ status: "error" });
      },
    });
    return () => subscription.unsubscribe();
  }, []);
  return state;
}

/** Downloads the office's census workbook filled from this barangay's validated records. */
export async function exportOfficialWorkbook(dataset: CensusDataset) {
  try {
    const [{ buildCensusWorkbook }, template, content] = await Promise.all([
      import("@/core/census/summary-workbook"),
      fetch(templateUrl).then((r) => {
        if (!r.ok) throw new Error("The census workbook template couldn't be loaded. Open Salin online once so it's saved for offline use.");
        return r.arrayBuffer();
      }),
      censusContent(dataset),
    ]);
    const bytes = buildCensusWorkbook(new Uint8Array(template), { barangay: dataset.origin.barangay, censusDate: dataset.origin.censusDate, records: records(content) });
    const name = `Census - ${dataset.origin.barangay} - ${dataset.origin.censusDate}.xlsx`;
    downloadBlob(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
    await markDatasetExported(dataset.id).catch(() => undefined);
  } catch (error) {
    toast(errorMessage(error, error instanceof Error ? error.message : "The workbook couldn't be made."));
  }
}

/** What "Send to City Vet" would send for this census (its Validated records). */
export async function censusSendPlan(dataset: CensusDataset): Promise<CensusSendPlan> {
  const { barangay, censusDate } = dataset.origin;
  return planCensusSubmission({ name: dataset.name, barangay, censusDate }, records(await censusContent(dataset)));
}

/** Queues the plan's submissions for City Vet: sent now when online, or when the signal comes back. */
export async function sendCensus(dataset: CensusDataset, plan: CensusSendPlan) {
  for (const change of censusChanges(plan)) await queueChange(change);
  await markDatasetSent(dataset.id);
}
