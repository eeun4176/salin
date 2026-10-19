/**
 * pdf.js Worker URL (tests)
 * Stands in for the app's `pdf.worker.min.mjs?url` import under Vitest,
 * pointing pdf.js at its Node-compatible ("legacy") worker file.
 */

export default new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href;
