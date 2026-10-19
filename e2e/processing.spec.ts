/**
 * Data Tools E2E Tests
 * The Phase 3 workflow in a real browser: extract CSV, Excel, PDF and text
 * files into datasets; review and edit them (types, issues, rows, name);
 * autosave and reopen after a reload; export CSV / Excel / JSON; combine
 * documents from the Datasets page; fail safely on damaged or unsupported
 * files; and do all of it offline.
 */

import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

import { card, downloadBytes, downloadText, itemAction, openWorkspace, sample, uploadFiles, waitForOfflineReady } from "./helpers";

async function expectReview(page: Page, name: string) {
  // Extraction runs on the device; on a busy test machine it can take a while.
  await expect(page).toHaveURL(/\/datasets\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Dataset name" })).toHaveValue(name);
}

async function exportAs(page: Page, label: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click();
  return download;
}

const saved = (page: Page) => expect(page.getByText("All changes saved")).toBeVisible();

test("a CSV becomes a typed, editable dataset that survives a reload and exports to CSV, Excel and JSON", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [sample.csv("Pets.csv", "Name,Visits,Last visit,Vaccinated\nAna,3,10/18/2026,yes\nBen,12,10/19/2026,no")]);
  await itemAction(page, "Pets.csv", "Extract data");
  await expectReview(page, "Pets");

  // Types were detected and values converted.
  await expect(page.getByRole("button", { name: "Visits column (Number)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Last visit column (Date)" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Vaccinated, row 1" })).toHaveValue("yes");
  await expect(page.getByRole("textbox", { name: "Last visit, row 1" })).toHaveValue("2026-10-18");

  // A wrong value is flagged and blocks "Mark as reviewed" until fixed.
  const visits = page.getByRole("textbox", { name: "Visits, row 2" });
  await visits.fill("twelve");
  await visits.press("Enter");
  await expect(page.getByText("1 cell needs a look")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as reviewed" })).toBeDisabled();
  await visits.fill("12");
  await visits.press("Enter");
  await expect(page.getByText(/needs? a look/)).toBeHidden();

  await page.getByRole("textbox", { name: "Name, row 1" }).fill("Ana Cruz");
  await page.getByRole("textbox", { name: "Name, row 1" }).press("Enter");
  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByRole("textbox", { name: "Name, row 3" }).fill("Cara");
  await page.getByRole("textbox", { name: "Name, row 3" }).press("Enter");
  await page.getByRole("textbox", { name: "Dataset name" }).fill("Pet visits");
  await saved(page);

  await page.reload();
  await expectReview(page, "Pet visits");
  await expect(page.getByRole("textbox", { name: "Name, row 1" })).toHaveValue("Ana Cruz");
  await expect(page.getByRole("textbox", { name: "Name, row 3" })).toHaveValue("Cara");
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(page.getByRole("button", { name: "Reviewed" })).toHaveAttribute("aria-pressed", "true");

  const csv = await exportAs(page, "CSV");
  expect(csv.suggestedFilename()).toBe("Pet visits.csv");
  expect((await downloadText(csv)).trimStart().split("\r\n")).toEqual([
    "Name,Visits,Last visit,Vaccinated",
    "Ana Cruz,3,2026-10-18,true",
    "Ben,12,2026-10-19,false",
    "Cara,,,",
  ]);

  const xlsx = await exportAs(page, "Excel");
  const book = XLSX.read(await downloadBytes(xlsx));
  expect(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 })).toEqual([
    ["Name", "Visits", "Last visit", "Vaccinated"],
    ["Ana Cruz", 3, "2026-10-18", true],
    ["Ben", 12, "2026-10-19", false],
    ["Cara"],
  ]);

  const json = JSON.parse(await downloadText(await exportAs(page, "JSON")));
  expect(json.rows[0]).toEqual({ values: { Name: "Ana Cruz", Visits: 3, "Last visit": "2026-10-18", Vaccinated: true }, source: { file: "Pets.csv", page: null, sheet: null, row: 2, range: null } });

  await page.getByRole("link", { name: "Datasets" }).click();
  await expect(page.getByRole("link", { name: "Pet visits" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Pet visits" }).getByText("Reviewed", { exact: true })).toBeVisible();
});

test("Excel workbooks and text PDFs are read on the device, with links back to the source", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [
    sample.xlsx("Census.xlsx", { "Barangay A": [["Household", "Members"], ["Cruz", 4]], "Barangay B": [["Household", "Members"], ["Reyes", 6]] }),
    sample.textPdf("Form.pdf", [["Census Form 2026", "Household: Cruz"], ["Signed"]]),
  ]);

  // Extract from the file preview; a workbook goes through the guided steps first.
  await card(page, "Census.xlsx").click();
  await page.getByRole("dialog").getByRole("button", { name: "Extract data" }).click();
  await expect(page.getByRole("heading", { name: "Extract from Excel" })).toBeVisible();
  await page.getByRole("button", { name: "Next: pick sections" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Next sheet" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  // Same columns on both sheets, so they're combined by default.
  await page.getByRole("button", { name: "Create dataset" }).click();
  await expectReview(page, "Census");
  await expect(page.getByRole("textbox", { name: "Household, row 2" })).toHaveValue("Reyes");
  await expect(page.getByRole("button", { name: "Members column (Number)" })).toBeVisible();

  await page.getByRole("button", { name: "View source of row 2: Census.xlsx · Barangay B, cells A2:B2" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Census.xlsx" })).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto("/");
  await itemAction(page, "Form.pdf", "Extract data");
  await expectReview(page, "Form");
  await expect(page.getByRole("textbox", { name: "Text, row 1" })).toHaveValue("Census Form 2026");
  await expect(page.getByRole("textbox", { name: "Text, row 2" })).toHaveValue("Household: Cruz");
  await expect(page.getByRole("textbox", { name: "Text, row 3" })).toHaveValue("Signed");
});

test("New dataset combines documents, and deleting a dataset can be undone", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [sample.txt("a.txt", "Line one\nLine two"), sample.txt("b.txt", "Line three")]);

  await page.getByRole("link", { name: /^Datasets/ }).click();
  await expect(page.getByText("No datasets yet")).toBeVisible();
  await page.getByRole("button", { name: "New dataset" }).click();
  const picker = page.getByRole("dialog");
  // Rows are combined in the order the documents are ticked.
  await picker.getByRole("checkbox", { name: /^a.txt/ }).check();
  await picker.getByRole("checkbox", { name: /^b.txt/ }).check();
  await picker.getByRole("button", { name: "Combine 2 documents" }).click();

  await expectReview(page, "a + 1 more");
  await expect(page.getByRole("textbox", { name: "Text, row 3" })).toHaveValue("Line three");

  await page.getByRole("link", { name: "Datasets" }).click();
  await page.getByRole("button", { name: "More actions for a + 1 more" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("No datasets yet")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("link", { name: "a + 1 more" })).toBeVisible();
});

test("damaged and unsupported files fail safely and the original is kept", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [
    { name: "Broken.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("not a workbook") },
    sample.png("Photo.png"),
  ]);

  await itemAction(page, "Broken.xlsx", "Extract data");
  await expect(page.getByText("Can't open this workbook")).toBeVisible();
  await expect(page.getByText(/"Broken.xlsx" isn't a readable Excel workbook/)).toBeVisible();
  await page.getByRole("link", { name: "Back to workspace" }).click();
  await expect(card(page, "Broken.xlsx")).toBeVisible();
  await page.reload();
  await expect(card(page, "Broken.xlsx")).toBeVisible();

  // Images are read with OCR (Read text), not table extraction.
  await page.getByRole("button", { name: "More actions for Photo.png", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Read text (OCR)" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Extract data" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/datasets");
  await expect(page.getByText("No datasets yet")).toBeVisible();
});

test("the whole workflow works offline: import, extract a PDF, edit, reload and export", async ({ page, context }) => {
  await openWorkspace(page);
  await waitForOfflineReady(page);
  await context.setOffline(true);
  await page.reload();

  await uploadFiles(page, [sample.textPdf("Offline form.pdf", [["Name: Lin", "Barangay: Poblacion"]])]);
  await itemAction(page, "Offline form.pdf", "Extract data");
  await expectReview(page, "Offline form");
  await expect(page.getByRole("textbox", { name: "Text, row 1" })).toHaveValue("Name: Lin");

  await page.getByRole("textbox", { name: "Text, row 2" }).fill("Barangay: Poblacion Norte");
  await page.getByRole("textbox", { name: "Text, row 2" }).press("Enter");
  await saved(page);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Text, row 2" })).toHaveValue("Barangay: Poblacion Norte");

  const json = JSON.parse(await downloadText(await exportAs(page, "JSON")));
  expect(json.rows.map((r: { values: { Text: string } }) => r.values.Text)).toEqual(["Name: Lin", "Barangay: Poblacion Norte"]);
  await context.setOffline(false);
});
