/**
 * Census Repository Tests
 * The first sheet makes the barangay-and-date dataset, later scans add to
 * it, a re-scanned sheet is reported (and replaces its rows when saved
 * again), and the scan is linked to the dataset.
 */

import { describe, expect, it } from "vitest";

import { censusExtraction } from "@/core/census/census-extraction";
import { censusGroups } from "@/core/census/census-records";
import { readFlatSheet, SHEET_SCALE } from "@/core/census/omr/read-sheet";
import { createOcrDocument, getOcrDocumentOrThrow } from "@/core/storage/repositories/ocr.repository";
import { getDatasetWithRows } from "@/core/storage/repositories/dataset.repository";
import { drawSheet } from "@/test/census-fixtures";

import { findScannedSheets, listCensusDatasets, saveCensusGroups } from "./census.repository";

const pages = [{ page: 1, fileId: "f1", pdfPage: null, width: 216 * SHEET_SCALE, height: 330 * SHEET_SCALE }];

function groupsFor(sheetNumber: number) {
  const read = readFlatSheet(drawSheet({ code: { version: 1, continuation: false, barangay: 0, censusDate: "2026-10-22", sheetNumber }, answers: { "pet0.type": "CAT", "pet0.sex": "FEMALE" } }))!;
  return censusGroups(censusExtraction([{ page: 1, read, lines: [] }]), "doc", pages);
}

describe("census repository", () => {
  it("gathers sheets into one dataset per barangay and date, and spots re-scans", async () => {
    const doc = await createOcrDocument({ name: "Census scan", pages: [{ fileId: "f1", pdfPage: null }] });

    const [first] = await saveCensusGroups(doc.id, groupsFor(1));
    const [second] = await saveCensusGroups(doc.id, groupsFor(2));
    expect(second).toBe(first);
    const [dataset] = await listCensusDatasets();
    expect(dataset).toMatchObject({ name: "Census · Poblacion · Oct 22, 2026", rowCount: 2, origin: { kind: "census", barangay: "Poblacion", censusDate: "2026-10-22" } });
    expect((await getOcrDocumentOrThrow(doc.id)).datasetIds).toEqual([first]);

    expect(await findScannedSheets(groupsFor(2))).toEqual([{ sheet: 2, datasetName: dataset.name, updatedAt: expect.any(Number) }]);
    expect(await findScannedSheets(groupsFor(3))).toEqual([]);
    await saveCensusGroups(doc.id, groupsFor(2));
    expect((await getDatasetWithRows(first)).rows).toHaveLength(2);
  });
});
