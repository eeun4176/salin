/**
 * Table Drafts Tests
 * The plain-language layer of the guided Excel extraction: descriptive
 * section names, review statuses with advice, which sections and sheets start
 * selected (empty, title-only and non-tabular regions don't), validation of
 * selected sections, and how datasets are grouped and named.
 */

import { describe, expect, it } from "vitest";

import { readWorkbook, type WorkbookModel } from "@/core/processing/excel/workbook-reader";
import { workbookBytes, type TestSheet } from "@/test/workbooks";

import {
  datasetGroups,
  evaluateDraft,
  initialDrafts,
  initialSheets,
  manualDraft,
  reviewStatus,
  sameColumns,
  sectionName,
  selectionProblem,
  type TableDraft,
} from "./table-drafts";

async function book(sheets: TestSheet[]) {
  return readWorkbook(new Blob([workbookBytes(sheets) as Uint8Array<ArrayBuffer>]), "book.xlsx");
}

function evaluateAll(workbook: WorkbookModel, drafts: TableDraft[]) {
  return drafts.map((d) => evaluateDraft(workbook.sheets.find((s) => s.name === d.sheet)!, d));
}

const draft = (patch: Partial<TableDraft>): TableDraft => ({ ...manualDraft("S"), range: "A1:B2", ...patch });

describe("guided extraction drafts", () => {
  it("names sections from their title or column names", async () => {
    const workbook = await book([
      {
        name: "Report",
        rows: [["Clinics"], ["Clinic", "Town"], ["Vet Plus", "Poblacion"], ["Pet Care", "San Isidro"], [], [], ["Owner", "Pet", "Doses", "Date"], ["Ana", "Bantay", 1, "2026-10-01"], ["Ben", "Choco", 2, "2026-10-02"]],
      },
    ]);
    const drafts = initialDrafts(workbook);
    const evaluated = evaluateAll(workbook, drafts);
    expect(drafts.map((d, i) => sectionName(d, evaluated[i]))).toEqual(["Clinics", "Owner, Pet and 2 more"]);
  });

  it("gives actionable statuses and leaves out non-tabular regions", async () => {
    const workbook = await book([
      { name: "Data", rows: [["Name", "Age"], ["Ana", 3], ["Ben", 4]] },
      { name: "Headings", rows: [["Name", "Age", "Town"]] },
      { name: "List", rows: [["Item"], ["Apples"], ["Bread"], ["Milk"]] },
      { name: "Raw", rows: [[1, 2], [3, 4]] },
      { name: "Hidden", rows: [["Code", "Label"], ["R", "Rabies"], ["F", "5-in-1"]], hidden: true },
    ]);
    const drafts = initialDrafts(workbook);
    const statuses = evaluateAll(workbook, drafts).map((e) => reviewStatus(e));
    expect(drafts.map((d, i) => [d.sheet, statuses[i].kind, statuses[i].label, d.include])).toEqual([
      ["Data", "ready", "Ready", true],
      ["Headings", "skip", "Title or headings only", false],
      ["List", "skip", "Looks like a list or notes", false],
      ["Raw", "skip", "No column names", false],
      ["Hidden", "ready", "Ready", true],
    ]);
    expect(statuses[3].advice[0]).toMatch(/choose the row that holds them/);
    // Hidden sheets and sheets with nothing worth extracting start unselected.
    expect([...initialSheets(workbook, drafts)]).toEqual(["Data"]);
  });

  it("asks for a check, with advice, when something needs a look", async () => {
    const workbook = await book([{ name: "One", rows: [["Name", "Age"], ["Ana", 3]] }]);
    const [d] = initialDrafts(workbook);
    const status = reviewStatus(evaluateAll(workbook, [d])[0]);
    expect(status).toMatchObject({ kind: "check", label: "Check before creating" });
    expect(status.advice).toEqual(["Only 1 record. If the table is bigger, widen the selection under Adjust selection."]);
  });

  it("validates selected sections before continuing", async () => {
    const workbook = await book([{ name: "S", rows: [["Name", "Age"], ["Ana", 3]] }]);
    const [sheet] = workbook.sheets;
    const check = (d: TableDraft) => selectionProblem(d, evaluateDraft(sheet, d));
    expect(check(manualDraft("S"))).toBe("Select the cells of this section first.");
    expect(check(draft({ range: "nope" }))).toBe("Enter a range like A2:G11.");
    expect(check(draft({ range: "A1:B1" }))).toMatch(/no records/);
    expect(check(draft({ range: "A1:B2" }))).toBeNull();
  });

  it("suggests combining only sections with the same columns", async () => {
    const workbook = await book([
      { name: "A", rows: [["Name", "Age"], ["Ana", 3], ["Ben", 4]] },
      { name: "B", rows: [["name", "age"], ["Cara", 5], ["Dino", 6]] },
      { name: "C", rows: [["Clinic", "Town"], ["Vet", "Poblacion"], ["Care", "Isidro"]] },
    ]);
    const evaluated = evaluateAll(workbook, initialDrafts(workbook));
    expect(sameColumns([evaluated[0], evaluated[1]])).toBe(true);
    expect(sameColumns([evaluated[0], evaluated[2]])).toBe(false);
  });

  it("names datasets per section without characters names can't hold", () => {
    const drafts = [draft({ key: "a" }), draft({ key: "b", sheet: "Clinics" }), draft({ key: "c", sheet: "Clinics", range: "D1:E3" })];
    const labels: Record<string, string> = { a: "Report: October", b: "Clinic and Town", c: "Clinic and Town" };
    expect(datasetGroups("Census.xlsx", drafts, "separate", (d) => labels[d.key]).map((g) => g.name)).toEqual([
      "Census – Report_ October",
      "Census – Clinic and Town",
      "Census – Clinic and Town (2)",
    ]);
    const [combined] = datasetGroups("Census.xlsx", drafts, "combine", (d) => labels[d.key]);
    expect(combined).toEqual({
      name: "Census",
      tables: [
        { sheet: "S", range: "A1:B2", headerRows: 1 },
        { sheet: "Clinics", range: "A1:B2", headerRows: 1 },
        { sheet: "Clinics", range: "D1:E3", headerRows: 1 },
      ],
    });
  });
});
