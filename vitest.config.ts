/**
 * Vitest Configuration
 * Unit/integration tests for storage, processing and query logic. Runs in
 * Node with fake-indexeddb standing in for the browser's IndexedDB (see
 * src/test/setup.ts) and pdf.js swapped for its Node build. Browser UI tests
 * live in e2e/ and run with Playwright.
 */

import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "./src") },
      // pdf.js ships a separate build for Node; the app itself uses the browser build.
      { find: /^pdfjs-dist$/, replacement: "pdfjs-dist/legacy/build/pdf.mjs" },
      { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/, replacement: path.resolve(import.meta.dirname, "./src/test/pdf-worker-url.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
