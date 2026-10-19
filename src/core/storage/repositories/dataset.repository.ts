/**
 * Dataset Repository
 * Every write to the `datasets` and `datasetRows` tables: saving a structured
 * dataset (record + all rows in one transaction, validated first), reading it
 * back in row order, renaming, review status, saving review edits and
 * replacing its content (both with a version check), marking it exported, and deleting it with its rows (with
 * a snapshot so the delete can be undone).
 */

import Dexie from "dexie";

import { assertValidContent } from "@/core/processing/dataset-validator";
import { db } from "@/core/storage/database";
import { WorkspaceError } from "@/core/storage/errors";
import { normalizeName, validateName } from "@/core/storage/names";
import type { Dataset, DatasetColumn, DatasetContent, DatasetOrigin, DatasetRow, DatasetStatus } from "@/types/processing";

export interface NewDataset {
  name: string;
  sourceFileIds: string[];
  jobId?: string | null;
  content: DatasetContent;
  origin?: DatasetOrigin;
}

function invalid(message: string): never {
  throw new WorkspaceError("validation", message);
}

function checkedName(raw: string) {
  const error = validateName(raw, []);
  if (error) invalid(error);
  return normalizeName(raw);
}

function toRows(datasetId: string, content: DatasetContent): DatasetRow[] {
  return content.rows.map((row, position) => ({
    id: crypto.randomUUID(),
    datasetId,
    position,
    values: row.values,
    source: row.source,
  }));
}

export async function getDatasetOrThrow(id: string) {
  const dataset = await db.datasets.get(id);
  if (!dataset) throw new WorkspaceError("not-found", "That dataset no longer exists.");
  return dataset;
}

export function getDataset(id: string) {
  return db.datasets.get(id);
}

/** All rows of a dataset, in order. */
export function getDatasetRows(datasetId: string): Promise<DatasetRow[]> {
  return db.datasetRows
    .where("[datasetId+position]")
    .between([datasetId, Dexie.minKey], [datasetId, Dexie.maxKey])
    .toArray();
}

/** A dataset and its rows, read from one consistent snapshot. */
export function getDatasetWithRows(id: string) {
  return db.transaction("r", db.datasets, db.datasetRows, async () => ({
    dataset: await getDatasetOrThrow(id),
    rows: await getDatasetRows(id),
  }));
}

/** Every dataset, most recently changed first. */
export async function listDatasets() {
  return (await db.datasets.orderBy("updatedAt").toArray()).reverse();
}

/** Datasets built (at least partly) from `fileId`. */
export function listDatasetsForFile(fileId: string) {
  return db.datasets.where("sourceFileIds").equals(fileId).toArray();
}

/** Validates and saves a dataset with all of its rows. Nothing is saved if anything fails. */
export async function createDataset(input: NewDataset): Promise<Dataset> {
  const name = checkedName(input.name);
  assertValidContent(input.content.columns, input.content.rows);

  return db.transaction("rw", db.datasets, db.datasetRows, async () => {
    const now = Date.now();
    const dataset: Dataset = {
      id: crypto.randomUUID(),
      name,
      sourceFileIds: [...new Set(input.sourceFileIds)],
      jobId: input.jobId ?? null,
      columns: input.content.columns,
      rowCount: input.content.rows.length,
      status: "needs_review",
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastExportedAt: null,
      ...(input.origin ? { origin: input.origin } : {}),
    };
    await db.datasets.add(dataset);
    await db.datasetRows.bulkAdd(toRows(dataset.id, input.content));
    return dataset;
  });
}

export async function renameDataset(id: string, raw: string) {
  const name = checkedName(raw);
  await db.transaction("rw", db.datasets, async () => {
    await getDatasetOrThrow(id);
    await db.datasets.update(id, { name, updatedAt: Date.now() });
  });
}

export function setDatasetStatus(id: string, status: DatasetStatus) {
  return db.transaction("rw", db.datasets, async () => {
    await getDatasetOrThrow(id);
    await db.datasets.update(id, { status, updatedAt: Date.now() });
  });
}

/**
 * Replaces all columns and rows. Pass the `version` you loaded as
 * `expectedVersion`; if the dataset changed since (another tab saved first),
 * nothing is written and a validation error explains why.
 */
export async function replaceDatasetContent(id: string, content: DatasetContent, expectedVersion?: number): Promise<Dataset> {
  assertValidContent(content.columns, content.rows);
  return db.transaction("rw", db.datasets, db.datasetRows, async () => {
    const dataset = await getDatasetOrThrow(id);
    if (expectedVersion !== undefined && dataset.version !== expectedVersion) {
      invalid("This dataset was changed somewhere else. Reload it, then make your changes again.");
    }
    const updated: Dataset = {
      ...dataset,
      columns: content.columns,
      rowCount: content.rows.length,
      version: dataset.version + 1,
      updatedAt: Date.now(),
    };
    await db.datasetRows.where("datasetId").equals(id).delete();
    await db.datasetRows.bulkAdd(toRows(id, content));
    await db.datasets.put(updated);
    return updated;
  });
}

function assertVersion(dataset: Dataset, expectedVersion: number) {
  if (dataset.version !== expectedVersion) {
    invalid("This dataset was changed somewhere else. Reload it, then make your changes again.");
  }
}

export interface DatasetEdits {
  name: string;
  columns: DatasetColumn[];
  /** Every row, in order. Ids are kept; positions are reassigned from the order. */
  rows: DatasetRow[];
  /**
   * Ids of the only rows whose values changed. Omit when rows were added,
   * removed or reordered (or every row changed) to rewrite all of them.
   */
  changedRowIds?: string[];
}

/**
 * Saves edits from the review screen. Cell edits rewrite only the rows that
 * changed, so autosave stays quick on large tables. Fails without writing if
 * the dataset changed since `expectedVersion` (e.g. edited in another tab).
 */
export async function saveDatasetEdits(id: string, edits: DatasetEdits, expectedVersion: number): Promise<Dataset> {
  const name = checkedName(edits.name);
  const changed = edits.changedRowIds ? new Set(edits.changedRowIds) : null;
  const rows = edits.rows.map((row, position) => ({ ...row, datasetId: id, position }));
  const toWrite = changed ? rows.filter((row) => changed.has(row.id)) : rows;
  assertValidContent(edits.columns, toWrite);

  return db.transaction("rw", db.datasets, db.datasetRows, async () => {
    const dataset = await getDatasetOrThrow(id);
    assertVersion(dataset, expectedVersion);
    if (!changed) await db.datasetRows.where("datasetId").equals(id).delete();
    await db.datasetRows.bulkPut(toWrite);
    const updated: Dataset = {
      ...dataset,
      name,
      columns: edits.columns,
      rowCount: rows.length,
      version: dataset.version + 1,
      updatedAt: Date.now(),
    };
    await db.datasets.put(updated);
    return updated;
  });
}

export function markDatasetExported(id: string) {
  return db.transaction("rw", db.datasets, async () => {
    await getDatasetOrThrow(id);
    await db.datasets.update(id, { lastExportedAt: Date.now() });
  });
}

export interface DatasetSnapshot {
  dataset: Dataset;
  rows: DatasetRow[];
}

/**
 * Deletes a dataset and its rows. Jobs that produced it forget the link.
 * Returns what was deleted, so `restoreDataset` can undo it.
 */
export function deleteDataset(id: string): Promise<DatasetSnapshot> {
  return db.transaction("rw", db.datasets, db.datasetRows, db.processingJobs, async () => {
    const dataset = await getDatasetOrThrow(id);
    const rows = await getDatasetRows(id);
    await db.datasetRows.where("datasetId").equals(id).delete();
    await db.datasets.delete(id);
    await db.processingJobs.where("datasetId").equals(id).modify({ datasetId: null });
    return { dataset, rows };
  });
}

/** Puts back a dataset removed by `deleteDataset` (Undo). */
export function restoreDataset({ dataset, rows }: DatasetSnapshot) {
  return db.transaction("rw", db.datasets, db.datasetRows, async () => {
    await db.datasets.add(dataset);
    await db.datasetRows.bulkAdd(rows);
  });
}
