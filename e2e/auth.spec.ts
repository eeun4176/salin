/**
 * Login E2E
 * The sign-in gate against a stand-in City Vet API: signed-out visitors land
 * on /login, missing or wrong entries are explained inline, a correct sign-in
 * opens the page they asked for and survives a reload, signing out returns
 * to the login page, signing back in works offline, and a first sign-in goes
 * from the temporary password to a new password and the paravet terms.
 */

import { expect, test } from "@playwright/test";

import { ACCOUNT, mockCityVet } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("signs in, stays signed in after a reload, and signs out", async ({ page }) => {
  await mockCityVet(page);
  await page.goto("/recents");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Access Your Workspace" })).toBeVisible();

  const key = page.getByLabel("Account Key");
  const password = page.getByLabel("Password", { exact: true });
  const unlock = page.getByRole("button", { name: "Unlock Workspace" });

  await unlock.click();
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").first()).toHaveText("Enter your Account Key.");
  await expect(key).toBeFocused();

  await key.fill(ACCOUNT.key);
  await password.fill("short");
  await unlock.click();
  await expect(password).toHaveAttribute("aria-invalid", "true");

  await password.fill("wrong-password");
  await unlock.click();
  await expect(page.getByRole("alert")).toContainText("don't match");

  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");

  await password.fill(ACCOUNT.password);
  await unlock.click();
  await expect(page.getByText(`Welcome back, ${ACCOUNT.name}`)).toBeVisible();
  await expect(page).toHaveURL(/\/recents$/);

  await page.reload();
  await expect(page.getByTestId("section-menu")).toBeVisible();

  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: `Account: ${ACCOUNT.name}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  // Signed in online on this device before, so signing back in works with no connection.
  await page.context().setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "You're offline" })).toBeVisible();
  await key.fill(ACCOUNT.key);
  await password.fill("wrong-password");
  await unlock.click();
  await expect(page.getByRole("alert")).toContainText("don't match");
  await password.fill(ACCOUNT.password);
  await unlock.click();
  await expect(page.getByText(`Welcome back, ${ACCOUNT.name}`)).toBeVisible();
  await expect(page.getByTestId("section-menu")).toBeVisible();
});

test("first sign-in turns the temporary password into the paravet's own, with the terms accepted", async ({ page }) => {
  const section = { title: "Mga tuntunin sa paggamit", body: "Gamitin lamang ang iyong account para sa awtorisadong gawain." };
  const policy = { version: "2026-10-20-draft-1", en: { title: "Paravet Terms", draft: "Draft for review.", sections: [["Terms of use", "Use your account only for office work."]] }, fil: { title: "Mga Tuntunin", draft: "Burador.", sections: [[section.title, section.body]] } };
  let saved: Record<string, unknown> | null = null;
  await mockCityVet(page, {
    "/auth/first-signin": (body) => (body.temporaryPassword === "Temp-1234" ? { json: { mustCreatePassword: true, token: "reset-token", expiresAt: new Date(Date.now() + 600_000).toISOString(), policy } } : { status: 401, json: { error: { code: "INVALID_CREDENTIALS", message: "The account key or temporary password is incorrect." } } }),
    "/auth/set-password": (body) => {
      saved = body;
      return { json: { account: { id: 7, type: "Paravet", name: ACCOUNT.name, accountKey: ACCOUNT.key, barangayId: 4, barangay: ACCOUNT.barangay }, token: "full-token", expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() } };
    },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "First time? Use your temporary password" }).click();
  await expect(page.getByRole("heading", { name: "First sign-in" })).toBeVisible();
  await page.getByLabel("Account Key").fill(ACCOUNT.key.toLowerCase());
  await page.getByLabel("Temporary password").fill("Temp-1234");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Create your password" })).toBeVisible();
  const save = page.getByRole("button", { name: "Save password and sign in" });
  await page.getByLabel("New password", { exact: true }).fill("abcdefgh");
  await page.getByLabel("Confirm new password").fill("abcdefgh");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("letter and a number");

  await page.getByLabel("New password", { exact: true }).fill("Strong-Pass-1");
  await page.getByLabel("Confirm new password").fill("Strong-Pass-1");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("Accept the terms");

  await page.getByRole("radio", { name: "Filipino" }).click();
  await page.getByRole("button", { name: "Basahin ang tuntunin at abiso" }).click();
  await expect(page.getByRole("dialog").getByText(section.body)).toBeVisible();
  await page.getByRole("button", { name: "Isara" }).click();
  await page.getByLabel(/Tinatanggap ko/).check();
  await page.getByLabel(/Nabasa at kinikilala ko/).check();
  await save.click();

  await expect(page.getByText(`Welcome back, ${ACCOUNT.name}`)).toBeVisible();
  await expect(page.getByTestId("section-menu")).toBeVisible();
  expect(saved).toMatchObject({ newPassword: "Strong-Pass-1", acceptedTerms: true, acknowledgedPrivacy: true, policyVersion: policy.version, policyLanguage: "fil" });
});
