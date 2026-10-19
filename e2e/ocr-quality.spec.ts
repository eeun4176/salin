/**
 * OCR Quality Evaluation
 * Reads the same printed registration form under difficult conditions —
 * blur, a shadow / poor lighting, skew, faint print, speckle noise, a stamp
 * over the text, and handwriting-style values — on the device, through the
 * real Read text workflow (one scan, one page per condition). Character and
 * word error rates are measured against the verified text and written to
 * test-results/ocr-quality.json (summarised in docs/OCR_BENCHMARKS.md).
 * Printed pages must stay readable; handwriting is only measured, as an
 * experimental capability.
 */

import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { characterErrorRate, wordErrorRate } from "../src/core/ocr/benchmark/accuracy";
import { openWorkspace, uploadFiles } from "./helpers";

test.describe.configure({ timeout: 300_000 });

const VARIANTS = ["clean", "blur", "shadow", "skew", "faint", "noise", "stamp", "handwriting"] as const;
type Variant = (typeof VARIANTS)[number];

/** The verified text of the form (what each page should read as). */
const REFERENCE = [
  "PET REGISTRATION FORM",
  "Owner's Name: Juan Dela Cruz",
  "Address: Purok 2, Poblacion",
  "Pet's Name: Bantay Breed: Aspin",
  "Age: 2 years Color: Brown and white",
  "Date: 10/18/2026",
].join("\n");

/** Upper bounds for printed pages (CER); handwriting has none — it's experimental. */
const MAX_CER: Partial<Record<Variant, number>> = { clean: 0.05, blur: 0.15, shadow: 0.15, skew: 0.15, faint: 0.15, noise: 0.2, stamp: 0.3 };

test("printed forms stay readable under blur, shadows, skew, faint print, noise and stamps", async ({ page }) => {
  await page.goto("/");
  const images = await page.evaluate(async (variants: readonly string[]) => {
    const out: Record<string, string> = {};
    for (const variant of variants) {
      const canvas = document.createElement("canvas");
      canvas.width = 1240;
      canvas.height = 1000;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (variant === "skew") {
        ctx.translate(620, 500);
        ctx.rotate((4 * Math.PI) / 180);
        ctx.translate(-620, -500);
      }
      if (variant === "blur") ctx.filter = "blur(1.6px)";
      ctx.fillStyle = variant === "faint" ? "rgba(17,17,17,0.33)" : "#111";
      const print = "30px Arial, Helvetica, sans-serif";
      const hand = "italic 34px 'Segoe Script', 'Bradley Hand', 'Brush Script MT', cursive";
      ctx.textAlign = "center";
      ctx.font = "bold 36px Arial, Helvetica, sans-serif";
      ctx.fillText("PET REGISTRATION FORM", 620, 120);
      ctx.textAlign = "left";
      const field = (x: number, y: number, label: string, value: string) => {
        ctx.font = print;
        ctx.fillText(label, x, y);
        const w = ctx.measureText(label + " ").width;
        ctx.font = variant === "handwriting" ? hand : print;
        ctx.fillText(value, x + w, y);
      };
      field(100, 240, "Owner's Name:", "Juan Dela Cruz");
      field(100, 330, "Address:", "Purok 2, Poblacion");
      field(100, 420, "Pet's Name:", "Bantay");
      field(700, 420, "Breed:", "Aspin");
      field(100, 510, "Age:", "2 years");
      field(700, 510, "Color:", "Brown and white");
      field(100, 600, "Date:", "10/18/2026");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = "none";
      if (variant === "shadow") {
        const g = ctx.createLinearGradient(0, 0, 1240, 0);
        g.addColorStop(0, "rgba(0,0,0,0.55)");
        g.addColorStop(0.6, "rgba(0,0,0,0.15)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 1240, 1000);
        ctx.globalCompositeOperation = "source-over";
      }
      if (variant === "noise") {
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        ctx.fillStyle = "#333";
        for (let i = 0; i < 9000; i++) ctx.fillRect(rand() * 1240, rand() * 1000, 1.6, 1.6);
      }
      if (variant === "stamp") {
        ctx.strokeStyle = "rgba(200,30,40,0.75)";
        ctx.fillStyle = "rgba(200,30,40,0.75)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(880, 300, 120, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = "bold 34px Arial";
        ctx.textAlign = "center";
        ctx.fillText("RECEIVED", 880, 312);
      }
      out[variant] = canvas.toDataURL("image/png").split(",")[1];
    }
    return out;
  }, VARIANTS);

  await openWorkspace(page);
  await uploadFiles(
    page,
    VARIANTS.map((v, i) => ({ name: `${String(i + 1).padStart(2, "0")}-${v}.png`, mimeType: "image/png", buffer: Buffer.from(images[v], "base64") })),
  );
  // One scan with every condition as a page: select all the files' first, then read.
  await page.getByRole("button", { name: `More actions for 01-clean.png`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Read text (OCR)" }).click();
  await expect(page).toHaveURL(/\/scans\/[\w-]+$/);
  const scanId = page.url().split("/").pop()!;
  // Add the other conditions as pages of the same scan.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add pages" }).click();
  await (await chooser).setFiles(VARIANTS.slice(1).map((v, i) => ({ name: `${String(i + 2).padStart(2, "0")}-${v}.png`, mimeType: "image/png", buffer: Buffer.from(images[v], "base64") })));
  await expect(page.getByRole("button", { name: /^Page 8/ })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Next: read text" }).click();
  await page.getByRole("button", { name: "Read 8 pages" }).click();
  await expect(page.getByRole("checkbox", { name: "Only show what needs a look" })).toBeVisible({ timeout: 280_000 });

  const results = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("SalinAI");
      request.onsuccess = () => resolve(request.result);
    });
    const pages = await new Promise<{ position: number; result: { text: string; confidence: number; durationMs: number } }[]>((resolve) => {
      const request = db.transaction("ocrPages").objectStore("ocrPages").index("documentId").getAll(id);
      request.onsuccess = () => resolve(request.result);
    });
    return pages.sort((a, b) => a.position - b.position).map((p) => ({ text: p.result.text, confidence: p.result.confidence, ms: p.result.durationMs }));
  }, scanId);

  const rows = VARIANTS.map((variant, i) => ({
    variant,
    cer: Math.round(characterErrorRate(REFERENCE, results[i].text) * 1000) / 1000,
    wer: Math.round(wordErrorRate(REFERENCE, results[i].text) * 1000) / 1000,
    confidence: results[i].confidence,
    readMs: results[i].ms,
  }));
  console.table(rows);
  await writeFile("test-results/ocr-quality.json", JSON.stringify({ date: new Date().toISOString(), browser: await page.evaluate(() => navigator.userAgent), rows }, null, 2));

  for (const row of rows) {
    const max = MAX_CER[row.variant];
    if (max !== undefined) expect(row.cer, `${row.variant} CER`).toBeLessThanOrEqual(max);
  }
});
