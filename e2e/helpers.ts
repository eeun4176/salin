/**
 * E2E Helpers
 * Shared steps for the Playwright tests: sample files, uploading through the
 * workspace menu, creating folders, using an item's ⋮ menu, and reading
 * downloads.
 */

import { readFile } from "node:fs/promises";

import { expect, type Download, type Locator, type Page } from "@playwright/test";

export interface SampleFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const sample = {
  pdf: (name = "Census Form.pdf"): SampleFile => ({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"),
  }),
  csv: (name = "Vaccination Log.csv", body = "Name,Pet,Date\nAna,Bantay,2026-10-01\nBen,Mingming,2026-10-02"): SampleFile => ({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(body),
  }),
  png: (name = "Receipt.png"): SampleFile => ({
    name,
    mimeType: "image/png",
    // 1×1 green pixel
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
  }),
};

/** Opens the app and waits until the workspace has loaded from IndexedDB. */
export async function openWorkspace(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByTestId("section-menu")).toBeVisible();
}

/** Uploads files into the folder currently open, via the hidden picker behind "Upload a File". */
export async function uploadFiles(page: Page, files: SampleFile[]) {
  await page.getByTestId("file-input").setInputFiles(files);
  for (const file of files) await expect(card(page, file.name)).toBeVisible();
}

export async function createFolder(page: Page, name: string) {
  await page.getByTestId("section-menu").click();
  await page.getByRole("menuitem", { name: "New Folder" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, name)).toBeVisible();
}

/** The clickable area that opens an item (cards and rows). */
export function card(page: Page, name: string): Locator {
  return page.locator(`[data-open-target][data-item-name="${name}"]`);
}

/** Opens an item's ⋮ menu and picks an action. */
export async function itemAction(page: Page, name: string, action: string) {
  await page.getByRole("button", { name: `More actions for ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

export async function downloadText(download: Download) {
  return (await readFile(await download.path())).toString();
}
