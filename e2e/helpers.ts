/**
 * E2E Helpers
 * Shared steps for the Playwright tests: sample files (including real
 * text PDFs and Excel workbooks), uploading through the workspace menu,
 * creating folders, the temporary sign-in account, using an item's ⋮ menu, reading downloads, and waiting
 * until the app works offline.
 */

import { readFile } from "node:fs/promises";

import { expect, type Download, type Locator, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

import { minimalPdf } from "../src/test/minimal-pdf";

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
  /** A real text-based PDF: one page per array, one line per string. */
  textPdf: (name: string, pages: string[][]): SampleFile => ({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(minimalPdf(pages), "latin1"),
  }),
  xlsx: (name: string, sheets: Record<string, unknown[][]>): SampleFile => {
    const book = XLSX.utils.book_new();
    for (const [sheet, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
    return {
      name,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer,
    };
  },
  txt: (name: string, body: string): SampleFile => ({ name, mimeType: "text/plain", buffer: Buffer.from(body) }),
  png: (name = "Receipt.png"): SampleFile => ({
    name,
    mimeType: "image/png",
    // 1×1 green pixel
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
  }),
};

/** The desktop dashboard's detail pane, where a file picked in the workspace list opens (phones use a full-screen dialog). */
export function detailPane(page: Page) {
  return page.getByRole("region", { name: "Document details" });
}

/** The temporary paravet account (see src/core/auth/local-auth.ts). */
export const ACCOUNT = { key: "PV2026-TMP001-3023", password: "changeme123" };

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

export async function downloadBytes(download: Download) {
  return readFile(await download.path());
}

/** Waits until the service worker controls the page, so the app keeps working offline. */
export async function waitForOfflineReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}
