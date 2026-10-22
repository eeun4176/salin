/**
 * Login E2E
 * The sign-in gate: signed-out visitors land on /login, missing or wrong
 * entries are explained inline, a correct sign-in opens the page they asked
 * for and survives a reload, and signing out returns to the login page.
 */

import { expect, test } from "@playwright/test";

import { ACCOUNT } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("signs in, stays signed in after a reload, and signs out", async ({ page }) => {
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
  await expect(page.getByText("Welcome back, Temporary Paravet")).toBeVisible();
  await expect(page).toHaveURL(/\/recents$/);

  await page.reload();
  await expect(page.getByTestId("section-menu")).toBeVisible();

  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: "Account: Temporary Paravet" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
