/**
 * Mobile E2E Tests (Pixel 7 emulation)
 * Layout regressions on a phone (no sideways scrolling on any screen), the
 * bottom tab bar and + quick actions, core folder/file flows by touch, and
 * the data tools (Datasets entry, guided Excel extraction, review screen,
 * the Read text steps) on a small screen.
 */

import { expect, test } from "@playwright/test";

import { card, createFolder, openWorkspace, sample, uploadFiles } from "./helpers";

for (const path of ["/", "/recents", "/trash", "/datasets", "/import", "/scan", "/ai-studio", "/settings"]) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("quick actions open Import from the + button", async ({ page }) => {
  await openWorkspace(page);
  const toggle = page.getByRole("button", { name: "Open quick actions" });
  await toggle.tap();
  await expect(page.getByRole("button", { name: "Close quick actions" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Import", exact: true }).tap();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByRole("button", { name: "Open quick actions" })).toHaveAttribute("aria-expanded", "false");
});

test("folders and files work by touch, and Workspace stays the active tab inside folders", async ({ page }) => {
  await openWorkspace(page);
  await createFolder(page, "Field Forms");
  await card(page, "Field Forms").tap();
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Workspace" })).toHaveAttribute("aria-current", "page");
  await uploadFiles(page, [sample.csv()]);

  await card(page, "Vaccination Log.csv").tap();
  const preview = page.getByRole("dialog");
  await expect(preview.getByRole("cell", { name: "Mingming" })).toBeVisible();
  // Full-screen on phones (polled, because the dialog zooms in from 95%).
  const viewport = page.viewportSize()!;
  await expect.poll(async () => Math.round((await preview.boundingBox())?.width ?? 0)).toBe(viewport.width);
  await page.getByRole("button", { name: "Close preview" }).tap();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("datasets are reachable on a phone and the review screen fits without sideways scrolling", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [sample.csv("Wide.csv", "Name,Pet,Breed,Colour,Vaccine,Date\nAna,Bantay,Aspin,Brown,Rabies,2026-10-01")]);
  await page.getByRole("button", { name: "More actions for Wide.csv", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Extract data" }).tap();
  await expect(page.getByRole("textbox", { name: "Dataset name" })).toHaveValue("Wide");

  // The table scrolls inside its own box; the page itself must not.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.goto("/");
  await page.getByRole("link", { name: /^Datasets/ }).tap();
  await expect(page).toHaveURL(/\/datasets$/);
  await expect(page.getByRole("link", { name: "Wide" })).toBeVisible();
});

test("the guided Excel extraction fits a phone without sideways scrolling", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [sample.xlsx("Wide.xlsx", { Data: [["Name", "Pet", "Breed", "Colour", "Vaccine", "Date"], ["Ana", "Bantay", "Aspin", "Brown", "Rabies", "2026-10-01"], ["Ben", "Choco", "Aspin", "Black", "5-in-1", "2026-10-02"]] })]);
  await page.getByRole("button", { name: "More actions for Wide.xlsx", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Extract data" }).tap();
  await expect(page.getByRole("button", { name: "Next: pick sections" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Next: pick sections" }).tap();
  await expect(page.getByRole("region", { name: "Name, Pet and 4 more" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the Read text steps fit a phone screen, from preparing a page to the dataset list", async ({ page }) => {
  await openWorkspace(page);
  await uploadFiles(page, [sample.png("Form photo.png")]);
  await page.getByRole("button", { name: "More actions for Form photo.png", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Read text (OCR)" }).tap();
  await expect(page).toHaveURL(/\/scans\/[\w-]+$/, { timeout: 30_000 });
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // Step 1 (page editor), step 2 (templates, model status), back to Datasets with the scan listed.
  await expect(page.getByRole("tab", { name: "Crop & rotate" })).toBeVisible();
  await noOverflow();
  await page.getByRole("button", { name: "Next: read text" }).tap();
  await expect(page.getByRole("radio", { name: /Pet registration form/ })).toBeVisible();
  await noOverflow();
  await page.goto("/datasets");
  await expect(page.getByRole("link", { name: /Form photo.*Continue/ })).toBeVisible();
  await noOverflow();
});
