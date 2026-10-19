/**
 * Excel Extraction E2E Tests
 * The guided, preview-first workbook flow in a real browser: preview a
 * workbook sheet by sheet; step 1 choose sheets; step 2 pick sections (names,
 * record counts, statuses, previews, Adjust selection with drag-to-select on
 * the sheet, validation); step 3 see how many datasets will be created, then
 * create them — with sheet and cell references kept and the workbook
 * untouched.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { workbookBytes } from "../src/test/workbooks";
import { card, openWorkspace, uploadFiles, type SampleFile } from "./helpers";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A monthly report: titles, a two-row merged header, a formula Total row, a note; plus a sheet with two tables and a hidden sheet. */
function reportWorkbook(): SampleFile {
  const bytes = workbookBytes([
    {
      name: "October Report",
      rows: [
        ["Monthly Vaccination Report"],
        ["Barangay Poblacion"],
        [],
        ["Owner", "Pet", "Doses", null],
        [null, null, "Rabies", "5-in-1"],
        ["Ana Cruz", "Bantay", 1, 0],
        ["Ben Reyes", "Choco", 1, 1],
        ["Cara Lim", "Ming", 0, 1],
        ["Total", null, 2, 2],
        [],
        ["Prepared by: J. Cruz"],
      ],
      merges: ["A1:D1", "C4:D4", "A4:A5", "B4:B5"],
      cells: { C9: { t: "n", v: 2, f: "SUM(C6:C8)" }, D9: { t: "n", v: 2, f: "SUM(D6:D8)" } },
    },
    {
      name: "Clinics",
      rows: [
        ["Clinic", "Town", null, "Vet", "Since"],
        ["Vet Plus", "Poblacion", null, "Dr. Santos", 2019],
        ["Pet Care", "San Isidro", null, "Dr. Reyes", 2021],
      ],
    },
    { name: "Lookup", rows: [["Code", "Label"], ["R", "Rabies"], ["F", "5-in-1"]], hidden: true },
  ]);
  return { name: "Vaccination Report.xlsx", mimeType: XLSX_MIME, buffer: Buffer.from(bytes) };
}

async function openGuided(page: Page) {
  await openWorkspace(page);
  await uploadFiles(page, [reportWorkbook()]);
  await page.getByRole("button", { name: "More actions for Vaccination Report.xlsx", exact: true }).click();
  await page.getByRole("menuitem", { name: "Extract data" }).click();
  await expect(page.getByRole("heading", { name: "Extract from Excel" })).toBeVisible();
  // Reading the workbook can take a few seconds on a busy test machine.
  await expect(page.getByRole("button", { name: "Next: pick sections" })).toBeVisible({ timeout: 30_000 });
}

const sheetToggle = (page: Page, name: string) => page.getByRole("checkbox", { name: new RegExp(`^${name}`) });
const section = (page: Page, name: string) => page.getByRole("region", { name });

/** Drags across the sheet grid from one cell to another, like selecting in Excel. */
async function dragSelect(page: Page, scope: Locator, from: string, to: string) {
  const first = scope.getByRole("cell", { name: new RegExp(`^Cell ${from}\\b`) });
  // Centre it so neither the page edge nor the sticky footer is under the pointer.
  await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const start = await first.boundingBox();
  const end = await scope.getByRole("cell", { name: new RegExp(`^Cell ${to}\\b`) }).boundingBox();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 6 });
  await page.mouse.up();
}

test("previews a workbook sheet by sheet, with hidden sheets marked", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [reportWorkbook()]);
  await card(page, "Vaccination Report.xlsx").click();
  const preview = page.getByRole("dialog");
  await expect(preview.getByRole("tab", { name: "October Report" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  await expect(preview.getByRole("tab", { name: "Lookup (hidden)" })).toBeVisible();
  await expect(preview.getByRole("cell", { name: "Monthly Vaccination Report" })).toBeVisible();
  await preview.getByRole("tab", { name: "Clinics" }).click();
  await expect(preview.getByRole("cell", { name: "Dr. Santos" })).toBeVisible();
});

test("guides from sheets to sections to a dataset, keeping sheet and cell references", async ({ page }) => {
  await openGuided(page);

  // Step 1: sheets with data are selected; the hidden one isn't.
  await expect(sheetToggle(page, "October Report")).toBeChecked();
  await expect(sheetToggle(page, "Clinics")).toBeChecked();
  await expect(sheetToggle(page, "Lookup")).not.toBeChecked();
  await expect(page.getByText("1 section found: Monthly Vaccination Report")).toBeVisible();
  await sheetToggle(page, "Clinics").uncheck();
  await page.getByRole("button", { name: "Next: pick sections" }).click();

  // Step 2: a named section with its records, a status with advice, and a preview — no cell ranges up front.
  const report = section(page, "Monthly Vaccination Report");
  await expect(report.getByText("3 records · 4 columns")).toBeVisible();
  await expect(report.getByText("Check before creating")).toBeVisible();
  await expect(report.getByText(/Column names combine 2 heading rows/)).toBeVisible();
  await expect(report.getByText("Left out the Total row at the bottom")).toBeVisible();
  await expect(report.getByRole("columnheader", { name: "Doses Rabies" })).toBeVisible();
  await expect(report.getByRole("textbox", { name: "Cells" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: what will be created.
  await expect(page.getByRole("heading", { name: "1 dataset will be created" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Dataset name" })).toHaveValue("Vaccination Report");
  await expect(page.getByText("3 records from October Report · Monthly Vaccination Report")).toBeVisible();
  await page.getByRole("button", { name: "Create dataset" }).click();

  await expect(page.getByRole("button", { name: "Doses Rabies column (Number)" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Dataset name" })).toHaveValue("Vaccination Report");
  await expect(page.getByRole("textbox", { name: "Owner, row 3" })).toHaveValue("Cara Lim");
  await expect(page.getByRole("button", { name: "View source of row 3: Vaccination Report.xlsx · October Report, cells A8:D8" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /row 4/ })).toHaveCount(0); // the Total row is not a record

  // The original workbook is unchanged and still opens.
  await page.goto("/");
  await card(page, "Vaccination Report.xlsx").click();
  await expect(page.getByRole("dialog").getByRole("cell", { name: "Total" })).toBeVisible({ timeout: 30_000 });
});

test("shows how many datasets will be created and lets sections stay separate or combine", async ({ page }) => {
  await openGuided(page);
  await sheetToggle(page, "October Report").uncheck();
  await page.getByRole("button", { name: "Next: pick sections" }).click();
  await expect(section(page, "Clinic and Town")).toBeVisible();
  await expect(section(page, "Vet and Since")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Different columns, so one dataset per section is suggested.
  await expect(page.getByRole("heading", { name: "2 datasets will be created" })).toBeVisible();
  const separate = page.getByRole("radio", { name: /One dataset per section/ });
  await expect(separate).toHaveAttribute("aria-checked", "true");
  await expect(separate).toContainText("Suggested");
  const names = page.getByRole("textbox", { name: "Dataset name" });
  await expect(names).toHaveCount(2);
  await expect(names.first()).toHaveValue("Vaccination Report – Clinic and Town");
  await page.getByRole("radio", { name: /Combine into one dataset/ }).click();
  await expect(page.getByRole("heading", { name: "1 dataset will be created" })).toBeVisible();
  await separate.click();
  await page.getByRole("button", { name: "Create 2 datasets" }).click();

  await expect(page).toHaveURL(/\/datasets$/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: /^Vaccination Report – / })).toHaveCount(2);
});

test("Adjust selection: change column names, reset, and drag across the sheet; selections are checked", async ({ page }) => {
  await openGuided(page);
  await sheetToggle(page, "October Report").uncheck();
  await page.getByRole("button", { name: "Next: pick sections" }).click();

  // Column names live in the Adjust selection panel.
  const vets = section(page, "Vet and Since");
  await vets.getByRole("button", { name: "Adjust selection" }).click();
  await vets.getByRole("combobox", { name: "Column names" }).selectOption("0");
  const unnamed = section(page, "Untitled section");
  await expect(unnamed.getByText("No column names", { exact: true })).toBeVisible();
  await expect(unnamed.getByRole("columnheader", { name: "Column D" })).toBeVisible();
  await unnamed.getByRole("button", { name: "Reset" }).click();
  await expect(vets.getByText("Ready", { exact: true })).toBeVisible();

  // A new section must have cells before continuing.
  await section(page, "Clinic and Town").getByRole("checkbox").uncheck();
  await vets.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Add a section by selecting cells" }).click();
  const added = section(page, "Untitled section");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Fix the highlighted section or untick it to continue.")).toBeVisible();
  await expect(added.getByText("Select the cells of this section first.")).toBeVisible();

  // Select it visually by dragging from A1 to B3.
  await dragSelect(page, added, "A1", "B3");
  const picked = section(page, "Clinic and Town (2)");
  await expect(picked.getByText("2 records · 2 columns")).toBeVisible();
  await expect(picked.getByRole("textbox", { name: "Cells" })).toHaveValue("A1:B3");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "1 dataset will be created" })).toBeVisible();
  await page.getByRole("button", { name: "Create dataset" }).click();
  await expect(page.getByRole("textbox", { name: "Town, row 2" })).toHaveValue("San Isidro", { timeout: 30_000 });
});
