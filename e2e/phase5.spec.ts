import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { openWorkspace, uploadFiles, waitForOfflineReady } from "./helpers";

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

/** The latest answer's sources: the drawer on wide screens, the bottom sheet on phones. */
async function openSources(page: Page) {
  if (wide(page)) return page.getByRole("complementary", { name: "Sources" });
  await page.getByRole("button", { name: /^Sources \(\d+\)$/ }).click();
  return page.getByRole("dialog", { name: "Sources" });
}

async function closeSources(page: Page) {
  if (!wide(page)) await page.keyboard.press("Escape");
}

for (const profile of ["laptop-browser", "phone-emulation"] as const) {
  test(`${profile}: selected document answers and exports work fully offline`, async ({ page, context }) => {
    test.setTimeout(120_000);
    if (profile === "phone-emulation") await page.setViewportSize({ width: 393, height: 851 });
    const samples = [
      { name: "notice.pdf", mimeType: "application/pdf" },
      { name: "registrations.csv", mimeType: "text/csv" },
      { name: "registrations.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ];
    await openWorkspace(page);
    await uploadFiles(page, await Promise.all(samples.map(async (s) => ({ ...s, buffer: await readFile(`docs/benchmarks/phase5/${s.name}`) }))));
    await waitForOfflineReady(page);
    await page.goto("/ai-studio");
    await expect(page.getByRole("button", { name: /^Source:/ })).toBeVisible();
    await context.setOffline(true);
    const requests: string[] = [];
    page.on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith("http://localhost:4173")) requests.push(request.url()); });
    const results = [];
    for (const [source, question, value] of [
      ["notice.pdf", "What is the deadline on page 2?", "2026-11-15"],
      ["notice.pdf", "Ano ang contact number?", "09171234567"],
      ["registrations.csv", "Total amount", "2500"],
      ["registrations.csv", "Ilang rows sa Malolos?", "2 matching rows"],
      ["registrations.xlsx", 'Total amount in sheet "Late entries"', "300"],
    ]) {
      await page.getByRole("button", { name: /^Source:/ }).click();
      await page.getByRole("menuitemradio", { name: new RegExp(source.replaceAll(".", "\\.")) }).click();
      await page.getByRole("textbox", { name: "Ask Salin AI", exact: true }).fill(question);
      const started = performance.now();
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByRole("log")).toContainText(value);
      const sources = await openSources(page);
      await expect(sources).toContainText(source);
      if (question.includes("page 2")) await expect(sources).toContainText("page 2");
      await closeSources(page);
      results.push({ source, question, expected: value, correct: true, citationCorrect: true, latencyMs: performance.now() - started });
    }
    await page.getByRole("button", { name: /^Source:/ }).click();
    await page.getByRole("menuitemradio", { name: /registrations.csv/ }).click();
    await page.getByRole("textbox", { name: "Ask Salin AI", exact: true }).fill("How many of those?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("2 rows match.");
    await page.getByRole("textbox", { name: "Ask Salin AI", exact: true }).fill("export names");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download displayed table (CSV)" }).click();
    const filePath = await (await download).path();
    expect(filePath).not.toBeNull();
    const csv = await readFile(filePath!, "utf8");
    expect(csv).toContain("Ana Cruz");
    expect(csv).toContain("Carla Reyes");
    expect(requests).toEqual([]);
    const memory = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return { userAgent: navigator.userAgent, usedJsHeapBytes: memory?.usedJSHeapSize ?? null };
    });
    await writeFile(`docs/benchmarks/phase5/${profile}-offline.json`, JSON.stringify({ profile, physicalDevice: "development laptop", physicalPhone: false, runtime: "Chrome; no local LLM installed in this test profile", offline: true, externalRequests: requests.length, ...memory, results }, null, 2));
  });
}

test("a raster form reaches Ask SALIN through real OCR and answers offline", async ({ page, browser, context }) => {
  test.setTimeout(180_000);
  const renderer = await browser.newPage({ deviceScaleFactor: 2 });
  await renderer.setContent('<main style="width:760px;padding:60px;background:white;color:black;font:28px/2 Arial"><h1 style="font-size:32px">CONTACT RECORD</h1><p>Name: Ana Cruz</p><p>Contact number: 09171234567</p><p>Reference ID: REG-00042</p></main>');
  const image = await renderer.locator("main").screenshot();
  await renderer.close();
  await writeFile("docs/benchmarks/phase5/contact-form.png", image);
  await openWorkspace(page);
  await uploadFiles(page, [{ name: "contact-form.png", mimeType: "image/png", buffer: image }]);
  await waitForOfflineReady(page);
  await page.getByRole("button", { name: "More actions for contact-form.png", exact: true }).click();
  await page.getByRole("menuitem", { name: "Read text (OCR)", exact: true }).click();
  await page.getByRole("button", { name: /^Read page$/ }).click();
  await expect(page.getByRole("checkbox", { name: "Only show what needs a look" })).toBeVisible({ timeout: 150_000 });
  await page.goto("/ai-studio");
  await context.setOffline(true);
  await page.getByRole("textbox", { name: "Ask Salin AI", exact: true }).fill("What is the contact number?");
  const started = performance.now();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("09171234567");
  await expect(await openSources(page)).toContainText("page 1");
  await writeFile("docs/benchmarks/phase5/ocr-offline.json", JSON.stringify({ environment: "Chrome on development laptop", source: "contact-form.png", engine: "real Tesseract.js through the scan workflow", offlineAnswer: true, question: "What is the contact number?", expected: "09171234567", exactMatch: true, citationCorrect: true, latencyMs: performance.now() - started }, null, 2));
});
