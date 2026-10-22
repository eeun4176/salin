/**
 * E2E Sign-in Setup
 * Runs once before the other specs: signs in with the temporary account and
 * saves the browser state (including IndexedDB, where the session lives) so
 * every test starts signed in. auth.spec.ts opts out to test the login page.
 */

import { expect, test as setup } from "@playwright/test";

import { ACCOUNT } from "./helpers";

const SESSION_STATE = "e2e/.auth/session.json";

setup("sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Account Key").fill(ACCOUNT.key);
  await page.getByLabel("Password", { exact: true }).fill(ACCOUNT.password);
  await page.getByRole("button", { name: "Unlock Workspace" }).click();
  await expect(page.getByTestId("section-menu")).toBeVisible();
  await page.context().storageState({ path: SESSION_STATE, indexedDB: true });
});
