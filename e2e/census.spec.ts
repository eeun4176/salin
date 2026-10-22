/**
 * Census E2E
 * The CVO census sheet end to end, on the device: print a sheet for a
 * barangay and date (the code strip carries both), fill it in (ticks,
 * bubbles, capital letters), photograph it at an angle, then scan it —
 * Salin finds the corner markers, reads the boxes and the handwriting,
 * the reviewer fixes the owner's name, and the pets are saved as census
 * records (a double-ticked pet stays Unreadable). Scanning the same sheet
 * again asks before replacing it, and the official workbook counts only
 * the validated pet.
 */

import { expect, test, type Browser, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

import { downloadBytes, openWorkspace, uploadFiles, type SampleFile } from "./helpers";

test.describe.configure({ timeout: 240_000 });

/** The printed sheet's SVG, as the Print forms page makes it. */
async function printedSheet(page: Page) {
  await page.goto("/census/print");
  await page.getByLabel("Date of census").fill("2026-10-22");
  await page.getByLabel("First sheet no.").fill("7");
  await page.getByLabel("How many").fill("1");
  await expect(page.getByText("Sheets 7–7.")).toBeVisible();
  return page.locator(".census-print svg").first().evaluate((svg) => svg.outerHTML);
}

/** Fills the sheet like a paravet would and photographs it on a table, slightly tilted. */
async function filledPhoto(browser: Browser, svg: string): Promise<SampleFile> {
  const context = await browser.newContext({ deviceScaleFactor: 2.5, viewport: { width: 1000, height: 1400 } });
  const page = await context.newPage();
  await page.setContent(`<body style="margin:0;background:#8f8b84"><div id="photo" style="display:inline-block;padding:50px"><div style="transform:perspective(2200px) rotateX(5deg) rotateZ(1.2deg)">${svg}</div></div></body>`);
  await page.evaluate(() => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.querySelector("svg")!;
    const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      if (text) el.textContent = text;
      svg.append(el);
    };
    const texts = [...svg.querySelectorAll("text")];
    // Option names sit 1.2 mm right of their 4.5 mm box, baseline 1 mm above its bottom.
    const tick = (word: string, nth: number) => {
      const t = texts.filter((el) => el.textContent === word)[nth];
      const x = Number(t.getAttribute("x")) - 5.7;
      const y = Number(t.getAttribute("y")) - 3.5;
      add("path", { d: `M${x + 0.6} ${y + 2.4} L${x + 1.9} ${y + 3.9} L${x + 4} ${y + 0.5}`, stroke: "#123", "stroke-width": 0.55, fill: "none", "stroke-linecap": "round" });
    };
    // v2 and later: the owner's name goes on its open line (the first rounded one), written naturally.
    const ownerLine = svg.querySelector('rect[stroke="#8a8f8c"][rx]')!;
    const writeLine = (text: string) =>
      add("text", { x: Number(ownerLine.getAttribute("x")) + 3, y: Number(ownerLine.getAttribute("y")) + 5, "font-size": 4.6, "font-family": "Arial", "font-weight": 700, "letter-spacing": 0.6, fill: "#1a2a5a" }, text);
    const bubbles = [...svg.querySelectorAll("circle")];
    const fill = (i: number) => add("circle", { cx: bubbles[i].getAttribute("cx")!, cy: bubbles[i].getAttribute("cy")!, r: 1.6, fill: "#123" });

    writeLine("JUAN CRUZ");
    // Pet 1: a male dog, 3 years old (one row of 0–20+ bubbles), first vaccination, free roaming, brown.
    tick("BROWN", 0);
    tick("DOG", 0);
    tick("MALE", 0);
    tick("1ST", 0);
    tick("FREE ROAMING", 0);
    fill(3);
    // Pet 2: both Dog and Cat ticked — must not be guessed.
    tick("DOG", 1);
    tick("CAT", 1);
    tick("FEMALE", 1);
    // Pet 3: marked as not used.
    tick("N/A — NO PET IN THIS SLOT", 2);
  });
  const buffer = await page.locator("#photo").screenshot();
  await context.close();
  return { name: "Census sheet 7.png", mimeType: "image/png", buffer };
}

/** The reviewer checks the owner's name against the close-up: confirms what was read, or types it. */
async function checkOwner(page: Page) {
  const owner = page.getByRole("textbox", { name: "Full name of owner" });
  if ((await owner.inputValue()) === "JUAN CRUZ") await page.locator('[data-ref="form:0:owner_name"]').getByRole("button", { name: "Looks right" }).click();
  else await owner.fill("JUAN CRUZ");
}

async function scan(page: Page, fileName: string) {
  await page.goto("/");
  await page.getByRole("button", { name: `More actions for ${fileName}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Read text (OCR)" }).click();
  await expect(page).toHaveURL(/\/scans\/[\w-]+$/, { timeout: 30_000 });
  const read = page.getByRole("button", { name: /^Read (page|\d+ pages)$/ });
  // A new scan starts reading by itself once the recognition files are on the device.
  const review = page.getByRole("checkbox", { name: "Only show what needs a look" });
  // The button is enabled once the device check is done; it's gone while reading.
  await expect(async () => {
    if ((await read.isVisible()) && (await read.isEnabled())) await read.click();
    await expect(review).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 180_000 });
}

test("a printed census sheet is scanned, reviewed, counted once, and exported to the official workbook", async ({ page, browser }) => {
  const photo = await filledPhoto(browser, await printedSheet(page));
  await openWorkspace(page);
  await uploadFiles(page, [photo]);

  await scan(page, photo.name);
  // From the code strip, not handwriting.
  await expect(page.getByRole("textbox", { name: "Barangay" })).toHaveValue("Poblacion");
  await expect(page.getByRole("textbox", { name: "Sheet no." })).toHaveValue("7");
  await checkOwner(page);
  await page.getByRole("button", { name: "Save to census records" }).click();
  await expect(page).toHaveURL(/\/census$/, { timeout: 30_000 });

  const card = page.getByRole("listitem").filter({ hasText: "Census · Poblacion · Oct 22, 2026" });
  await expect(card).toContainText("1 Validated");
  await expect(card).toContainText("1 Unreadable");
  await expect(card).toContainText("2 pets");

  // The same paper again: Salin asks before replacing, and still counts it once.
  await scan(page, photo.name);
  await checkOwner(page);
  await page.getByRole("button", { name: "Save to census records" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Sheet 7 is already in");
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect(page).toHaveURL(/\/census$/, { timeout: 30_000 });
  await expect(card).toContainText("2 pets");

  const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "Export official workbook" }).click()]);
  expect(download.suggestedFilename()).toBe("Census - Poblacion - 2026-10-22.xlsx");
  const book = XLSX.read(await downloadBytes(download), { type: "buffer" });
  const summary = book.Sheets["SUMMARY OF CENSUS"];
  expect([summary.B8?.v, summary.C8?.v, summary.D8?.v, summary.E9?.v, summary.Q9?.v, summary.S9?.v, summary.C29?.v]).toEqual(["JUAN CRUZ", 1, 0, 1, 1, 1, 1]);
  expect(book.Sheets["CENSUS REVISED 2022 SINGLE"].B7?.v).toBe("JUAN CRUZ");
  expect(XLSX.utils.sheet_to_csv(book.Sheets["PENDING REVIEW"])).toContain("Unreadable");
});
