/**
 * City Vet Page E2E
 * Against a stand-in City Vet API: a stub notice in the inbox opens the
 * Stubs tab, and a plain-words request searches City Vet's records and
 * saves them as a dataset for AI Studio.
 */

import { expect, test } from "@playwright/test";

import { mockCityVet } from "./helpers";

test("the inbox links to stubs, and a typed request becomes a City Vet search saved as a dataset", async ({ page }) => {
  const searched: string[] = [];
  await mockCityVet(page, {
    "/notifications": () => ({ json: { data: [{ id: 1, kind: "program", title: "Stubs to print", body: "Kapon Day: City Vet sent your barangay's stubs.", link: "/stubs?campaignId=21&batchId=31", created_at: new Date().toISOString(), read_at: null }], unread: 1 } }),
    "/search": (_body, { query }) => {
      searched.push(query.get("q") ?? "");
      return { json: { data: [{ key: "owner:1", kind: "Owner", id: "OWN-1", label: "Juan Cruz", detail: "Assumption · 2 pets", source: "Registry", status: null, updatedAt: "2026-10-01T00:00:00Z" }], hasMore: false } };
    },
    "/stub-workflow": () => ({ json: { programs: [], batches: [] } }),
  });

  await page.goto("/city-vet");
  const notice = page.getByRole("button", { name: /Stubs to print/ });
  await expect(notice).toContainText("New");
  await notice.click();
  await expect(page).toHaveURL(/\/programs\?tab=stubs/);

  await page.goto("/city-vet?tab=records");
  await page.getByLabel("What to look for").fill("Give me the records of Juan Cruz");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Assumption · 2 pets")).toBeVisible();
  expect(searched).toEqual(["juan cruz"]);
  await page.getByRole("button", { name: "Save as dataset and ask AI" }).first().click();
  await expect(page).toHaveURL(/\/ai-studio/);
  await expect(page.getByText(/City Vet records juan cruz/).first()).toBeVisible();
});
