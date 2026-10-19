/**
 * Dataset Repository Tests
 * Saving datasets with their rows (validated, all-or-nothing), reading rows
 * in order, renaming, version-checked review edits and content replacement,
 * and deletion with undo.
 */

import { describe, expect, it, vi } from "vitest";

import { db } from "@/core/storage/database";
import { content } from "@/test/fixtures";

import {
  createDataset,
  deleteDataset,
  getDatasetRows,
  restoreDataset,
  saveDatasetEdits,
  getDatasetWithRows,
  listDatasetsForFile,
  renameDataset,
  replaceDatasetContent,
  setDatasetStatus,
} from "./dataset.repository";

const census = () =>
  createDataset({
    name: "  Census 2026 ",
    sourceFileIds: ["f1", "f2", "f1"],
    content: content(["Name", "Pet"], [["Ana", "Bantay"], ["Ben", "Mingming"], ["Cara", "Choco"]]),
  });

describe("dataset repository", () => {
  it("saves a dataset with its rows in order", async () => {
    const dataset = await census();
    expect(dataset).toMatchObject({ name: "Census 2026", sourceFileIds: ["f1", "f2"], rowCount: 3, status: "needs_review", version: 1 });

    const { rows } = await getDatasetWithRows(dataset.id);
    const name = dataset.columns[0].id;
    expect(rows.map((r) => [r.position, r.values[name]])).toEqual([
      [0, "Ana"],
      [1, "Ben"],
      [2, "Cara"],
    ]);
    expect((await listDatasetsForFile("f2")).map((d) => d.id)).toEqual([dataset.id]);
  });

  it("rejects invalid names and content without writing anything", async () => {
    await expect(createDataset({ name: "a/b", sourceFileIds: [], content: content(["A"]) })).rejects.toThrow();
    await expect(createDataset({ name: "Empty", sourceFileIds: [], content: content([]) })).rejects.toThrow("at least one column");
    expect(await db.datasets.count()).toBe(0);
  });

  it("rolls back the dataset record when saving rows fails", async () => {
    vi.spyOn(db.datasetRows, "bulkAdd").mockImplementation(() => {
      throw new Error("storage full");
    });
    await expect(census()).rejects.toThrow("storage full");
    expect(await db.datasets.count()).toBe(0);
  });

  it("renames and updates review status", async () => {
    const dataset = await census();
    await renameDataset(dataset.id, "Pets");
    await setDatasetStatus(dataset.id, "reviewed");
    expect(await db.datasets.get(dataset.id)).toMatchObject({ name: "Pets", status: "reviewed" });
    await expect(renameDataset(dataset.id, "")).rejects.toThrow();
  });

  it("replaces content and refuses stale versions", async () => {
    const dataset = await census();
    const next = content(["Owner"], [["Dino"]]);
    const updated = await replaceDatasetContent(dataset.id, next, 1);
    expect(updated).toMatchObject({ version: 2, rowCount: 1, columns: next.columns });
    expect((await getDatasetRows(dataset.id)).map((r) => r.values[next.columns[0].id])).toEqual(["Dino"]);

    await expect(replaceDatasetContent(dataset.id, content(["X"]), 1)).rejects.toThrow("changed somewhere else");
    expect((await db.datasets.get(dataset.id))?.version).toBe(2);
    expect(await db.datasetRows.count()).toBe(1);
  });

  it("saves review edits, rewriting only changed rows when nothing structural changed", async () => {
    const dataset = await census();
    const rows = await getDatasetRows(dataset.id);
    const name = dataset.columns[0].id;
    const edited = rows.map((r, i) => (i === 1 ? { ...r, values: { ...r.values, [name]: "Benjie" } } : r));
    const put = vi.spyOn(db.datasetRows, "bulkPut");

    const saved = await saveDatasetEdits(dataset.id, { name: "Pets", columns: dataset.columns, rows: edited, changedRowIds: [rows[1].id] }, 1);
    expect(saved).toMatchObject({ name: "Pets", version: 2, rowCount: 3 });
    expect(put.mock.calls[0][0]).toHaveLength(1);
    expect((await getDatasetRows(dataset.id)).map((r) => r.values[name])).toEqual(["Ana", "Benjie", "Cara"]);

    // Structural edit: drop the first row and add one; positions are renumbered.
    const added = { id: "new-row", datasetId: dataset.id, position: 99, values: { [name]: "Dino" }, source: null };
    await saveDatasetEdits(dataset.id, { name: "Pets", columns: dataset.columns, rows: [...edited.slice(1), added] }, 2);
    expect((await getDatasetRows(dataset.id)).map((r) => [r.position, r.values[name]])).toEqual([
      [0, "Benjie"],
      [1, "Cara"],
      [2, "Dino"],
    ]);

    await expect(saveDatasetEdits(dataset.id, { name: "Pets", columns: dataset.columns, rows: edited }, 2)).rejects.toThrow("changed somewhere else");
    await expect(saveDatasetEdits(dataset.id, { name: "a/b", columns: dataset.columns, rows: edited }, 3)).rejects.toThrow();
    expect(await db.datasetRows.count()).toBe(3);
  });

  it("deletes the dataset with its rows", async () => {
    const keep = await census();
    const remove = await census();
    await deleteDataset(remove.id);
    expect(await db.datasets.count()).toBe(1);
    expect(await db.datasetRows.where("datasetId").equals(remove.id).count()).toBe(0);
    expect(await db.datasetRows.where("datasetId").equals(keep.id).count()).toBe(3);
    await expect(deleteDataset(remove.id)).rejects.toThrow("no longer exists");
  });

  it("undoes a delete exactly", async () => {
    const dataset = await census();
    const rows = await getDatasetRows(dataset.id);
    await restoreDataset(await deleteDataset(dataset.id));
    expect(await db.datasets.get(dataset.id)).toEqual(dataset);
    expect(await getDatasetRows(dataset.id)).toEqual(rows);
  });
});
