/**
 * Workspace E2E Tests
 * Real-browser checks of the Phase 2 workspace: imports persist across
 * reloads, folder uploads keep their structure, nested folders with
 * breadcrumbs, rename/move/copy/favorite/trash/restore/delete, preview and
 * download of originals, and a full backup → wipe → restore cycle.
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { card, createFolder, detailPane, downloadText, itemAction, openWorkspace, sample, uploadFiles } from "./helpers";

test("imported files are saved and still there after a reload", async ({ page }) => {
  await openWorkspace(page);
  await expect(page.getByText("Your workspace is empty")).toBeVisible();

  await uploadFiles(page, [sample.pdf(), sample.csv(), sample.png()]);
  await page.reload();

  for (const name of ["Census Form.pdf", "Vaccination Log.csv", "Receipt.png"]) {
    await expect(card(page, name)).toBeVisible();
  }
  await page.getByRole("link", { name: "Recents" }).first().click();
  await expect(page.getByText("No recent files")).toBeHidden();
});

test("uploading a folder recreates its structure", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "salin-e2e-"));
  await mkdir(join(root, "Census", "Batch 1"), { recursive: true });
  await writeFile(join(root, "Census", "summary.csv"), "a,b\n1,2");
  await writeFile(join(root, "Census", "Batch 1", "form.pdf"), "%PDF-1.4");
  await writeFile(join(root, "Census", "Batch 1", "notes.txt"), "Text files are supported.");

  await openWorkspace(page);
  await page.getByTestId("folder-input").setInputFiles(join(root, "Census"));
  await expect(page.getByText(/Saved 3 files to Workspace/)).toBeVisible();

  await card(page, "Census").click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Census");
  await expect(card(page, "summary.csv")).toBeVisible();
  await card(page, "Batch 1").click();
  await expect(card(page, "form.pdf")).toBeVisible();
  await expect(card(page, "notes.txt")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Census");
});

test("nested folders: create, open, move, rename, copy, trash, restore and delete", async ({ page }) => {
  await openWorkspace(page);
  await createFolder(page, "Census");

  // Duplicate names in the same folder are refused inline.
  await page.getByTestId("section-menu").click();
  await page.getByRole("menuitem", { name: "New Folder" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("census");
  await expect(page.getByRole("alert")).toHaveText("An item with this name is already in this folder.");
  await page.getByRole("button", { name: "Cancel" }).click();

  await card(page, "Census").click();
  await expect(page).toHaveURL(/\/folders\//);
  await createFolder(page, "Batch 1");
  await uploadFiles(page, [sample.pdf("form.pdf")]);

  // Move the file up to the top level with the folder picker.
  await itemAction(page, "form.pdf", "Move to…");
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: "Workspace" }).click();
  await picker.getByRole("button", { name: "Move here" }).click();
  await expect(card(page, "form.pdf")).toBeHidden();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Workspace" }).click();
  await expect(card(page, "form.pdf")).toBeVisible();

  await itemAction(page, "Census", "Rename");
  await page.getByRole("textbox", { name: "Name" }).fill("Census 2026");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(card(page, "Census 2026")).toBeVisible();

  await itemAction(page, "Census 2026", "Make a copy");
  await expect(card(page, "Copy of Census 2026")).toBeVisible();

  await itemAction(page, "Census 2026", "Add to Favorites");
  await page.getByRole("link", { name: "Favorites" }).first().click();
  await expect(card(page, "Census 2026")).toBeVisible();

  await page.getByRole("link", { name: "Workspace" }).first().click();
  await itemAction(page, "Census 2026", "Move to trash");
  await expect(card(page, "Census 2026")).toBeHidden();
  await page.getByRole("link", { name: "Trash" }).first().click();
  await expect(card(page, "Census 2026")).toBeVisible();

  await itemAction(page, "Census 2026", "Restore");
  await page.getByRole("link", { name: "Workspace" }).first().click();
  await expect(card(page, "Census 2026")).toBeVisible();

  await itemAction(page, "Copy of Census 2026", "Move to trash");
  await page.getByRole("link", { name: "Trash" }).first().click();
  await itemAction(page, "Copy of Census 2026", "Delete forever");
  await page.getByRole("dialog").getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByText("Trash is empty")).toBeVisible();

  await page.reload();
  await page.getByRole("link", { name: "Workspace" }).first().click();
  await expect(card(page, "Census 2026")).toBeVisible();
  await expect(card(page, "Copy of Census 2026")).toBeHidden();
});

test("files open in a preview and download as the original bytes", async ({ page }) => {
  const csv = sample.csv();
  await openWorkspace(page);
  await uploadFiles(page, [csv, sample.png()]);

  await card(page, "Vaccination Log.csv").click();
  const preview = detailPane(page);
  await expect(preview.getByRole("cell", { name: "Bantay" })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), preview.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe("Vaccination Log.csv");
  expect(await downloadText(download)).toBe(csv.buffer.toString());

  // Back closes the preview (it's part of browser history).
  await page.goBack();
  await expect(preview.getByText("Select a document")).toBeVisible();

  await card(page, "Receipt.png").click();
  await expect(preview.getByRole("img", { name: "Receipt.png" })).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();

  // Opening a file puts it in Recents.
  await page.getByRole("link", { name: "Recents" }).first().click();
  await expect(card(page, "Vaccination Log.csv")).toBeVisible();
});

test("backup, delete everything, then restore the full workspace", async ({ page }) => {
  await openWorkspace(page);
  await createFolder(page, "Pet Registration");
  await card(page, "Pet Registration").click();
  await uploadFiles(page, [sample.csv("dogs.csv", "Name\nBantay")]);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Workspace" }).click();
  await uploadFiles(page, [sample.pdf()]);

  await page.getByRole("button", { name: "Backup and restore" }).click();
  const [backup] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Back up workspace" }).click()]);
  expect(backup.suggestedFilename()).toMatch(/^salin-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const backupPath = await backup.path();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Delete all workspace data" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByText("All workspace data was deleted")).toBeVisible();

  await page.getByTestId("restore-input").setInputFiles(backupPath);
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("1 folder and 2 files");
  await confirm.getByRole("button", { name: "Replace workspace" }).click();
  await expect(page.getByText(/Workspace restored/)).toBeVisible();

  await expect(card(page, "Census Form.pdf")).toBeVisible();
  await card(page, "Pet Registration").click();
  await card(page, "dogs.csv").click();
  await expect(detailPane(page).getByRole("cell", { name: "Bantay" })).toBeVisible();
});

test("a damaged backup is refused and the workspace is kept", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [sample.pdf()]);
  await page.getByTestId("restore-input").setInputFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("PK\x03\x04garbage") });
  await expect(page.getByText(/damaged|isn't a Salin backup/)).toBeVisible();
  await expect(card(page, "Census Form.pdf")).toBeVisible();
});
