/**
 * Mobile E2E Tests (Pixel 7 emulation)
 * Layout regressions on a phone (no sideways scrolling on any screen), the
 * bottom tab bar and + quick actions, and core folder/file flows by touch.
 */

import { expect, test } from "@playwright/test";

import { card, createFolder, openWorkspace, sample, uploadFiles } from "./helpers";

for (const path of ["/", "/recents", "/trash", "/import", "/scan", "/ai-studio", "/settings"]) {
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
