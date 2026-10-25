/**
 * Offline E2E Tests
 * Once the service worker has cached the app, Salin must open with no
 * network — including deep links like /settings — and workspace changes made
 * offline must persist across offline reloads.
 */

import { expect, test } from "@playwright/test";

import { card, createFolder, openWorkspace, sample, uploadFiles } from "./helpers";

test("the cached app opens and keeps working without a network", async ({ page, context }) => {
  await openWorkspace(page);
  // Wait for the service worker to install, then reload so it controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("section-menu")).toBeVisible();

  await createFolder(page, "Offline folder");
  await uploadFiles(page, [sample.pdf("offline.pdf")]);
  await page.reload();
  await expect(card(page, "Offline folder")).toBeVisible();
  await expect(card(page, "offline.pdf")).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import Files" })).toBeVisible();

  await context.setOffline(false);
});

test("the web app manifest is served with installable icons", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "e-Vet Field", short_name: "e-Vet", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(`/${icon.src}`)).status()).toBe(200);
  }
});
