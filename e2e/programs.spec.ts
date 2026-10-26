/**
 * Program Requests E2E
 * The barangay's shared request against a stand-in City Vet API: who filed
 * it, adding an owner offline (it waits on the phone, then is sent once with
 * its request id when back online), the duplicate warning, sending the list,
 * and a refused edit that needs attention and can be discarded.
 */

import { expect, test, type Page } from "@playwright/test";

import { mockCityVet } from "./helpers";

function cityVetRequest() {
  const now = new Date().toISOString();
  const campaign = {
    id: 11, revision: 1, reference: "PI-2026-TEST", kind: "program_request", hostBarangayId: 4, hostBarangay: "Assumption", status: "gathering",
    requestedTargetPeople: 2, targetPeople: 2, processes: ["Neuter/Spay", "Anti-Rabies Vaccine"], ownerCount: 1, petCount: 1,
    allowedBarangays: [{ id: 4, name: "Assumption" }], createdByName: "Juan Dela Cruz", submittedByName: null, lastEditedBy: "Juan Dela Cruz", lastEditedAt: now,
    mergedIntoId: null, mergedInto: null, requestNote: null, reviewNote: null, programTitle: null, programDate: null,
  };
  const people = [{ id: 1, owner_name: "Maria Santos", mobile: "0917-123-4567", residence_barangay_id: 4, residence_barangay: "Assumption", pets: [{ name: "Bantay", species: "Dog", processes: ["Neuter/Spay"] }], status: "interested", updated_at: now, added_by_name: "Juan Dela Cruz", updated_by_name: null }];
  const posts: Record<string, unknown>[] = [];
  const routes = {
    "/program-interest": (body: Record<string, unknown>, { method, query }: { method: string; query: URLSearchParams }) => {
      const shown = { ...campaign, ownerCount: people.filter((p) => p.status === "interested").length };
      if (method === "GET") return query.get("id") ? { json: { campaign: shown, people, activity: [] } } : { json: { campaigns: [shown], role: "Paravet", assignedBarangayId: 4 } };
      posts.push(body);
      if (body.action === "add-interest") {
        people.push({ id: people.length + 1, owner_name: String(body.ownerName), mobile: String(body.mobile) || "", residence_barangay_id: 4, residence_barangay: "Assumption", pets: body.pets as never, status: "interested", updated_at: new Date().toISOString(), added_by_name: "Temporary Paravet", updated_by_name: null });
        return { status: 201, json: { personId: people.length } };
      }
      if (body.action === "update-interest") return { status: 409, json: { error: { code: "STALE_EDIT", message: "Another Paravet changed this owner since you opened it. Review their changes and try again." } } };
      if (body.action === "submit-request") campaign.status = "requested";
      return { json: { saved: true } };
    },
  };
  return { routes, posts };
}

const syncBadge = (page: Page, name: RegExp) => page.getByRole("button", { name });

test("owners added offline wait on the phone, then go to City Vet once; the list can be sent", async ({ page, context }) => {
  const server = cityVetRequest();
  await mockCityVet(page, server.routes);
  await page.goto("/programs");
  await expect(page.getByRole("heading", { name: "Programs" })).toBeVisible();
  await expect(page.getByText("Filed by Juan Dela Cruz")).toBeVisible();
  await expect(page.getByText("1 of 2 owners")).toBeVisible();
  await expect(page.getByText("Maria Santos")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send list to City Vet" })).toBeDisabled();

  await page.getByRole("button", { name: "Add owner" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Owner name").fill("maria santos");
  await expect(dialog.getByRole("alert")).toContainText("already on this list");
  await dialog.getByLabel("Owner name").fill("Pedro Reyes");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add owner" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Add at least one pet");

  await context.setOffline(true);
  await dialog.getByLabel("Pet 1 name").fill("Muning");
  await dialog.getByRole("radio", { name: "Cat" }).click();
  await dialog.getByRole("button", { name: "Add owner" }).click();
  await expect(page.getByText("Waiting to send")).toBeVisible();
  await expect(syncBadge(page, /Offline · 1 waiting/)).toBeVisible();
  expect(server.posts).toEqual([]);

  await context.setOffline(false);
  await expect(page.getByText("2 of 2 owners")).toBeVisible();
  await expect(page.getByText("Waiting to send")).toHaveCount(0);
  expect(server.posts).toMatchObject([{ action: "add-interest", campaignId: 11, ownerName: "Pedro Reyes", requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), pets: [{ name: "Muning", species: "Cat" }] }]);

  await page.getByRole("button", { name: "Send list to City Vet" }).click();
  await expect.poll(() => server.posts.map((p) => p.action)).toEqual(["add-interest", "submit-request"]);
  await expect(page.getByText("Sent to City Vet", { exact: true })).toBeVisible();
});

test("an edit the server refuses needs attention and can be discarded", async ({ page }) => {
  const server = cityVetRequest();
  await mockCityVet(page, server.routes);
  await page.goto("/programs");
  await page.getByRole("button", { name: "Edit Maria Santos" }).click();
  await page.getByRole("dialog").getByLabel("Mobile").fill("0999-999-9999");
  await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();

  const badge = syncBadge(page, /1 needs attention/);
  await expect(badge).toBeVisible();
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await badge.click();
  await expect(page.getByRole("menu")).toContainText("Another Paravet changed this owner");
  await page.getByRole("menuitem", { name: "Discard: Edit Maria Santos" }).click();
  await expect(badge).toHaveCount(0);
});

function cityVetStubs() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const code = (n: number) => `CVS1.${String(n).padStart(22, "x")}`;
  const program = { id: 21, title: "Kapon Day", date: today, location: "Covered court", hostBarangayId: 4, hostBarangay: "Assumption", allowedBarangays: [], status: "Open", processes: ["Neuter/Spay", "Anti-Rabies Vaccine"], startTime: "08:00", endTime: "12:00" };
  const batch = { id: 31, reference: "SB-2026-1", campaignId: 21, barangay: "Assumption", status: "Approved", approvedQuantity: 2, sentAt: new Date().toISOString() };
  const owner = { name: "Maria Santos", mobile: "09171234567", address: "", barangayId: 4 };
  const posts: Record<string, unknown>[] = [];
  const routes = {
    "/stub-workflow": (body: Record<string, unknown>, { method, query }: { method: string; query: URLSearchParams }) => {
      if (method === "POST") {
        posts.push(body);
        return { json: { saved: true } };
      }
      const mode = query.get("mode");
      if (mode === "print")
        return { json: { batch, program, stubs: [{ id: 101, code: code(1), ownerName: "Maria Santos", status: "Issued", services: ["Neuter/Spay"], ownerConfirmedAt: null }, { id: 102, code: code(2), ownerName: null, status: "Available", services: [], ownerConfirmedAt: null }] } };
      if (mode === "day-pack")
        return { json: { program, generatedAt: new Date().toISOString(), stubs: [{ id: 101, code: code(1), status: "Issued", owner, pets: [{ name: "Bantay", species: "Dog", processes: ["Neuter/Spay"] }], redeemedAt: null, barangayId: 4 }] } };
      if (mode === "attendance") return { json: { data: [] } };
      return { json: { programs: [program], batches: [batch] } };
    },
  };
  return { routes, posts, code };
}

test("stubs: the written name is confirmed; program day: a stub is scanned offline once, and a walk-in recorded", async ({ page, context }) => {
  const server = cityVetStubs();
  await mockCityVet(page, server.routes);
  await page.goto("/programs?tab=stubs");
  await expect(page.getByText("Kapon Day")).toBeVisible();
  await expect(page.getByText("Blank stub · filled in on program day")).toBeVisible();
  const name = page.getByRole("combobox", { name: "Name written on stub 101" });
  await expect(name).toHaveValue("Maria Santos");
  await name.fill("Maria D. Santos");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect.poll(() => server.posts).toEqual([{ action: "confirm-owner", stubId: 101, ownerName: "Maria D. Santos" }]);

  await page.getByRole("tab", { name: "Attendance" }).click();
  await expect(page.getByText("1 stub saved on this phone for scanning offline.")).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel("Stub code").fill(server.code(1));
  await page.getByRole("button", { name: "Find" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Maria Santos")).toBeVisible();
  await dialog.getByRole("button", { name: "Record attendance" }).click();
  await expect(page.getByText(/Stub 101 · Waiting to send/)).toBeVisible();

  await page.getByLabel("Stub code").fill(server.code(1));
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText("Stub 101 was already used.")).toBeVisible();

  // Walk-ins go in like a spreadsheet: a blank owner cell is another pet of the owner above.
  await page.getByRole("button", { name: "Walk-ins" }).click();
  await dialog.getByLabel("Row 1 owner").fill("Pedro Reyes");
  await dialog.getByLabel("Row 1 pet").fill("Tagpi");
  await dialog.getByLabel("Row 2 pet").fill("Mingming");
  await dialog.getByRole("radio", { name: "Cat" }).nth(1).click();
  await expect(dialog.getByText("1 owner · 2 pets")).toBeVisible();
  await dialog.getByRole("button", { name: "Record walk-ins" }).click();
  await expect(page.getByText("1 walk-in recorded. They will be sent when you're back online.")).toBeVisible();
  expect(server.posts).toHaveLength(1);

  // The calendar lists today's program and links back to its attendance.
  await page.getByRole("tab", { name: "Calendar" }).click();
  await page.getByRole("complementary", { name: "Programs this month" }).getByRole("link", { name: /Kapon Day/ }).first().click();
  await expect(page.getByRole("tab", { name: "Attendance" })).toHaveAttribute("aria-selected", "true");

  await context.setOffline(false);
  await expect.poll(() => server.posts.map((p) => p.action)).toEqual(["confirm-owner", "redeem", "walk-in"]);
  expect(server.posts[1]).toMatchObject({ stubId: 101, owner: { name: "Maria Santos", barangayId: 4 }, pets: [{ name: "Bantay", outcome: "Completed" }], requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(server.posts[2]).toMatchObject({ campaignId: 21, owner: { name: "Pedro Reyes", barangayId: 4 }, pets: [{ name: "Tagpi", species: "Dog", processes: ["Neuter/Spay", "Anti-Rabies Vaccine"], outcome: "Completed" }, { name: "Mingming", species: "Cat" }] });
});
