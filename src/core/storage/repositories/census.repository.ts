/**
 * Census Repository
 * Saves reviewed census sheets into their barangay-and-date dataset (made
 * on first use), in one transaction with linking the scan to it; finds
 * sheets that were already scanned (so the same paper isn't counted twice);
 * and lists every census dataset with its rows.
 */

import { db } from "@/core/storage/database";
import { censusDatasetName, mergeCensusContent, sheetNumbersIn, type CensusGroup } from "@/core/census/census-records";
import { getOcrDocumentOrThrow } from "@/core/storage/repositories/ocr.repository";
import { createDataset, getDatasetRows, listDatasets, replaceDatasetContent } from "@/core/storage/repositories/dataset.repository";
import type { Dataset, DatasetContent } from "@/types/processing";

export type CensusDataset = Dataset & { origin: { kind: "census"; barangay: string; censusDate: string } };

const isCensus = (dataset: Dataset): dataset is CensusDataset => dataset.origin?.kind === "census";

export async function listCensusDatasets(): Promise<CensusDataset[]> {
  return (await listDatasets()).filter(isCensus);
}

async function findCensusDataset(barangay: string, censusDate: string) {
  return (await listCensusDatasets()).find((d) => d.origin.barangay === barangay && d.origin.censusDate === censusDate);
}

async function contentOf(dataset: Dataset): Promise<DatasetContent> {
  return { columns: dataset.columns, rows: (await getDatasetRows(dataset.id)).map((r) => ({ values: r.values, source: r.source })) };
}

/** A census dataset's columns and rows. */
export const censusContent = contentOf;

/** Sheets in these groups that are already in their census dataset, with when it last changed. */
export async function findScannedSheets(groups: CensusGroup[]): Promise<{ sheet: number; datasetName: string; updatedAt: number }[]> {
  const found: { sheet: number; datasetName: string; updatedAt: number }[] = [];
  for (const group of groups) {
    const dataset = await findCensusDataset(group.barangay, group.censusDate);
    if (!dataset) continue;
    const scanned = sheetNumbersIn(await contentOf(dataset));
    for (const sheet of group.sheetNumbers) if (scanned.has(sheet)) found.push({ sheet, datasetName: dataset.name, updatedAt: dataset.updatedAt });
  }
  return found;
}

/** Adds the groups' records to their census datasets (replacing re-scanned sheets) and links them to the scan. Resolves to the dataset ids. */
export async function saveCensusGroups(documentId: string, groups: CensusGroup[]): Promise<string[]> {
  return db.transaction("rw", [db.ocrDocuments, db.datasets, db.datasetRows], async () => {
    const doc = await getOcrDocumentOrThrow(documentId);
    const ids: string[] = [];
    for (const group of groups) {
      const dataset = await findCensusDataset(group.barangay, group.censusDate);
      if (dataset) {
        await replaceDatasetContent(dataset.id, mergeCensusContent(await contentOf(dataset), group.content), dataset.version);
        await db.datasets.update(dataset.id, { sourceFileIds: [...new Set([...dataset.sourceFileIds, ...group.sourceFileIds])], status: "needs_review" });
        ids.push(dataset.id);
      } else {
        const created = await createDataset({
          name: censusDatasetName(group.barangay, group.censusDate),
          sourceFileIds: group.sourceFileIds,
          content: mergeCensusContent(null, group.content),
          origin: { kind: "census", barangay: group.barangay, censusDate: group.censusDate },
        });
        ids.push(created.id);
      }
    }
    await db.ocrDocuments.update(documentId, { datasetIds: [...new Set([...doc.datasetIds, ...ids])], stage: "done", updatedAt: Date.now() });
    return ids;
  });
}
