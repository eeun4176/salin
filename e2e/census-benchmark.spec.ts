/**
 * Census Handwriting Benchmark (opt-in)
 * Measures how well Salin reads filled census sheets without real paravet
 * samples: synthetic sheets printed from the Print forms page, filled in
 * with eight handwriting-style fonts (each letter jittered in size, angle
 * and position, in blue or black ink), photographed at an angle with blur
 * and uneven light. For every letter-box field it compares printed-text OCR
 * (Tesseract) with the handwriting reader (PP-OCRv5, one character per box),
 * and checks every tick box and bubble. Fonts are neater than real hands, so
 * treat the numbers as an upper bound until real sheets are measured.
 *
 *   SALIN_CENSUS_BENCH=1 npx playwright test e2e/census-benchmark.spec.ts --project=setup --project=desktop
 *
 * Results go to docs/benchmarks/census/synthetic.json. Model files come
 * from e2e/.models (see ai.spec.ts).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { characterErrorRate } from "../src/core/ocr/benchmark/accuracy";
import { filledPhoto, printedSheet, truthFor } from "./census-sheets";
import { uploadFiles } from "./helpers";

test.skip(!process.env.SALIN_CENSUS_BENCH, "Set SALIN_CENSUS_BENCH=1 to run the census handwriting benchmark.");
test.describe.configure({ timeout: 60 * 60_000 });

const SHEETS = Number(process.env.SALIN_CENSUS_SHEETS ?? 12);
// Just one sheet (1-based), to look into it.
const ONLY = process.env.SALIN_CENSUS_ONLY ? Number(process.env.SALIN_CENSUS_ONLY) : null;
const MODEL_DIR = path.join(import.meta.dirname, ".models");
const STYLES = ["neat", "messy", "thin"] as const;
async function serveModels(page: Page) {
  await page.context().route("https://huggingface.co/**", async (route) => {
    const file = path.join(MODEL_DIR, decodeURIComponent(new URL(route.request().url()).pathname));
    const body = await readFile(file).catch(() => null);
    return body ? route.fulfill({ status: 200, body, headers: { "content-type": "application/octet-stream", "access-control-allow-origin": "*" } }) : route.abort();
  });
}

/** What the review screen holds for the scan: OCR values and the handwriting reader's suggestions. */
async function scanResults(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const open = indexedDB.open("SalinAI");
      open.onsuccess = () => resolve(open.result);
    });
    const docs = await new Promise<{ updatedAt: number; extraction: { forms: { fields: { key: string; value: { text: string; flags: string[] } }[] }[]; tables: { rows: { id: string; cells: Record<string, { text: string; flags: string[] }> }[] }[]; suggestions?: { ref: { kind: string; id: string }; after: string; source: string }[] } }[]>((resolve) => {
      const q = db.transaction("ocrDocuments").objectStore("ocrDocuments").getAll();
      q.onsuccess = () => resolve(q.result);
    });
    const doc = docs.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const x = doc.extraction;
    const ocr: Record<string, string> = {};
    const flags: Record<string, string[]> = {};
    for (const f of x.forms[0]?.fields ?? []) [ocr[f.key], flags[f.key]] = [f.value.text, f.value.flags];
    const pet = x.tables[0]?.rows[0];
    for (const [k, v] of Object.entries(pet?.cells ?? {})) [ocr[k], flags[k]] = [v.text, v.flags];
    const reader: Record<string, string> = {};
    for (const s of x.suggestions ?? []) if (s.source === "handwriting") reader[s.ref.kind === "form" ? s.ref.id : s.ref.id.split(":")[1]] = s.after;
    return { ocr, flags, reader };
  });
}

async function readScan(page: Page, fileName: string) {
  await page.goto("/");
  await page.getByRole("button", { name: `More actions for ${fileName}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Read text (OCR)" }).click();
  const read = page.getByRole("button", { name: /^Read (page|\d+ pages)$/ });
  const review = page.getByRole("checkbox", { name: "Only show what needs a look" });
  await expect(async () => {
    if ((await read.isVisible()) && (await read.isEnabled())) await read.click();
    await expect(review).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: Number(process.env.SALIN_CENSUS_READ_TIMEOUT ?? 600_000) });
  await page.getByRole("button", { name: /^Read handwriting/ }).click();
  await expect(page.getByText(/suggestions? to review|No suggestions/).first()).toBeVisible({ timeout: 180_000 });
  // Review saves changes 400 ms after they happen; read the stored scan only once that's done.
  await page.waitForTimeout(2000);
}

// v2 sheets: Color is a tick box (checked with the other marks below).
const LETTER_FIELDS = ["owner_name", "address", "contact", "pet_name"] as const;
const normal = (key: string, text: string) => (key === "contact" ? text.replace(/\D/g, "") : text.replace(/\s+/g, " ").trim());

test("synthetic census sheets: printed-text OCR vs the handwriting reader", async ({ page, browser }) => {
  await serveModels(page);
  await page.goto("/settings");
  await page.getByRole("radio", { name: /^AI Lite/ }).check();
  const reader = page.getByRole("listitem").filter({ hasText: "Handwriting reader" });
  const download = reader.getByRole("button", { name: /^Download/ });
  if (await download.isVisible()) await download.click();
  await expect(reader.getByText("Ready offline")).toBeVisible({ timeout: 300_000 });

  const sheets: unknown[] = [];
  const totals = { ocr: { edits: 0, chars: 0 }, reader: { edits: 0, chars: 0 }, omr: { right: 0, total: 0 }, exact: { ocr: 0, reader: 0, fields: 0 } };
  const failed: { sheet: number; error: string }[] = [];
  const consoleLines: string[] = [];
  page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  for (let n = 0; n < SHEETS; n++) {
    if (ONLY !== null && n + 1 !== ONLY) continue;
    consoleLines.length = 0;
    const truth = truthFor(n);
    let photo: Awaited<ReturnType<typeof filledPhoto>>;
    let results: Awaited<ReturnType<typeof scanResults>>;
    try {
      photo = await filledPhoto(browser, await printedSheet(page, 100 + n), truth, n, STYLES[n % STYLES.length]);
      await page.goto("/");
      await uploadFiles(page, [photo]);
      await readScan(page, photo.name);
      results = await scanResults(page);
    } catch (error) {
      // One stuck sheet shouldn't lose the others' results.
      failed.push({ sheet: n + 1, error: String(error).slice(0, 300) });
      await page.screenshot({ path: test.info().outputPath(`sheet-${n + 1}-failed.png`) }).catch(() => undefined);
      console.log(`sheet ${n + 1} failed; last console lines:\n${consoleLines.slice(-15).join("\n")}`);
      continue;
    }
    const { ocr, flags, reader: read } = results;

    const fields = LETTER_FIELDS.map((key) => {
      const want = normal(key, truth[key]);
      const byOcr = normal(key, ocr[key] ?? "");
      // No suggestion: the reader agreed with OCR — or wasn't sure, flagged it, and the reviewer types it (counted as nothing read).
      const byReader = normal(key, read[key] ?? (flags[key]?.includes("illegible") ? "" : (ocr[key] ?? "")));
      const cer = { ocr: characterErrorRate(want, byOcr), reader: characterErrorRate(want, byReader) };
      totals.ocr.edits += cer.ocr * want.length;
      totals.reader.edits += cer.reader * want.length;
      totals.ocr.chars += want.length;
      totals.reader.chars += want.length;
      totals.exact.fields++;
      if (byOcr === want) totals.exact.ocr++;
      if (byReader === want) totals.exact.reader++;
      return { key, want, ocr: byOcr, reader: byReader, cer };
    });
    const omr = (["type", "sex", "vaccination", "color"] as const).map((key) => ({ key, want: truth[key], got: (ocr[key] ?? "").toUpperCase() }));
    for (const o of omr) {
      totals.omr.total++;
      if (o.got === o.want) totals.omr.right++;
    }
    sheets.push({ sheet: n + 1, font: photo.font, style: photo.style, fields, omr });
    if (process.env.SALIN_CENSUS_DEBUG) console.log("DEBUG", JSON.stringify({ ocr: LETTER_FIELDS.map((k) => ocr[k]), flags: LETTER_FIELDS.map((k) => flags[k]), read: LETTER_FIELDS.map((k) => read[k]) }));
    console.log(`sheet ${n + 1} (${photo.font}, ${photo.style}): ${fields.map((f) => `${f.key}: ${f.want} → ${f.reader}`).join(" · ")}`);
  }

  const report = {
    failed,
    kind: "census-synthetic",
    note: "Synthetic sheets in handwriting-style fonts — neater than real hands; an upper bound until real sheets are measured.",
    sheets: SHEETS,
    cer: { ocr: totals.ocr.edits / totals.ocr.chars, handwritingReader: totals.reader.edits / totals.reader.chars },
    exactFields: { ocr: totals.exact.ocr / totals.exact.fields, handwritingReader: totals.exact.reader / totals.exact.fields },
    omrAccuracy: totals.omr.right / totals.omr.total,
    details: sheets,
  };
  const out = path.join(import.meta.dirname, "..", "docs", "benchmarks", "census");
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "synthetic.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cer: report.cer, exactFields: report.exactFields, omrAccuracy: report.omrAccuracy }));
  expect(report.omrAccuracy).toBeGreaterThan(0.95);
});
