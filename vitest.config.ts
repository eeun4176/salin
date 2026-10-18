/**
 * Vitest Configuration
 * Unit/integration tests for storage and query logic. Runs in Node with
 * fake-indexeddb standing in for the browser's IndexedDB (see
 * src/test/setup.ts). Browser UI tests live in e2e/ and run with Playwright.
 */

import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
