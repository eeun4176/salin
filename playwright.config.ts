/**
 * Playwright Configuration
 * Real-browser UI tests (e2e/) against the production build served by
 * `vite preview`, so the service worker and offline behaviour are the real
 * thing. Uses the installed Google Chrome by default; set PW_CHROMIUM=1 to
 * use Playwright's bundled Chromium instead (after `npx playwright install chromium`).
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const channel = process.env.PW_CHROMIUM ? undefined : "chrome";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 1 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
