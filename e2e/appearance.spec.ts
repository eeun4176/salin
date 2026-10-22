/**
 * Appearance & Thumbnails E2E Tests
 * Settings → Appearance switches theme and density, applies them at once,
 * and keeps them after a reload (and sits below Privacy); the tab bar has
 * the same four tabs as the phone, with Datasets opened from a card inside
 * Workspace; file cards preview each file's real content
 * (image, PDF page, table rows — an Excel workbook's main table — text).
 */

import { expect, test } from "@playwright/test";

import { workbookBytes } from "../src/test/workbooks";
import { openWorkspace, sample, uploadFiles } from "./helpers";

test("theme and density are applied immediately and remembered", async ({ page }) => {
  await page.goto("/settings");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(html).toHaveClass(/dark/);
  await page.getByRole("radio", { name: "Compact", exact: true }).click();
  await expect(html).toHaveAttribute("data-density", "compact");
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).not.toBe("rgb(248, 250, 249)");

  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await expect(html).toHaveAttribute("data-density", "compact");
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await page.getByRole("radio", { name: "Comfortable", exact: true }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(html).not.toHaveAttribute("data-density", "compact");
});

test("file cards show each file's real content", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [
    sample.png("Photo.png"),
    sample.textPdf("Form.pdf", [["Census Form 2026", "Household: Cruz"]]),
    sample.csv("Pets.csv", "Name,Pet\nAna,Bantay"),
    sample.xlsx("Clinics.xlsx", { Clinics: [["Clinic", "Town"], ["Vet Plus", "Poblacion"]] }),
  ]);

  // Previews load as cards scroll into view.
  const thumb = (name: string) => page.locator(`[data-thumbnail-for="${name}"]`);
  const expected: [string, string, string?][] = [
    ["Photo.png", "image"],
    ["Form.pdf", "image"],
    ["Pets.csv", "table", "Bantay"],
    ["Clinics.xlsx", "table", "Vet Plus"],
  ];
  for (const [name, kind, text] of expected) {
    await thumb(name).scrollIntoViewIfNeeded();
    await expect(thumb(name)).toHaveAttribute("data-thumbnail", kind, { timeout: 20_000 });
    if (text) await expect(thumb(name)).toContainText(text);
  }

  // Saved, so they come straight back after a reload.
  await page.reload();
  await thumb("Pets.csv").scrollIntoViewIfNeeded();
  await expect(thumb("Pets.csv")).toContainText("Bantay");
  await expect(thumb("Form.pdf")).toHaveAttribute("data-thumbnail", "image");
});

test("Datasets lives inside Workspace, and Appearance comes after Privacy in Settings", async ({ page }) => {
  await openWorkspace(page);
  const tabs = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
  await expect(tabs).toHaveText([/^Workspace/, /^Recents/, /^Favorites/, /^Trash/, "Census", "AI Studio", "Settings"]);
  await page.getByRole("link", { name: /^Datasets/ }).click();
  await expect(page).toHaveURL(/\/datasets$/);
  // Still inside Workspace: its tab stays selected, and the breadcrumb leads back.
  await expect(tabs.first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Workspace");

  await page.goto("/settings");
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings.indexOf("Appearance")).toBe(headings.indexOf("Privacy") + 1);
});

test("an Excel card previews the workbook's main table, skipping hidden and empty sheets", async ({ page }) => {
  await openWorkspace(page);
  const bytes = workbookBytes([
    { name: "Lookup", rows: [["x"]], hidden: true },
    { name: "Cover", rows: [] },
    { name: "Data", rows: [["Monthly Report"], [], ["Name", "Age"], ["Ana", 3], ["Ben", 4]] },
  ]);
  await uploadFiles(page, [{ name: "Report.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) }]);
  const thumb = page.locator('[data-thumbnail-for="Report.xlsx"]');
  await thumb.scrollIntoViewIfNeeded();
  await expect(thumb).toHaveAttribute("data-thumbnail", "table", { timeout: 20_000 });
  await expect(thumb).toContainText("Monthly Report");
  await expect(thumb).toContainText("Ana");
  await expect(thumb).not.toContainText("x");
});
