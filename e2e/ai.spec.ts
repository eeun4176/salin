/**
 * On-device AI E2E Tests
 * The Phase 5 workflow in Chrome: the handwriting reader is downloaded from
 * the approved model host (served here from a local copy in e2e/.models,
 * fetched once), then reads handwritten values on a scanned form — in
 * airplane mode — and offers them as suggestions the reviewer approves,
 * traced into the dataset. Rule suggestions (standard forms) work without
 * any model; Transform previews, filters, deletes with confirmation and
 * undoes; without the assistant, plain-language requests point to the
 * manual tools. Requests only ever go to Salin's own site and the model
 * host, and nothing is ever uploaded. The assistant test (a ~500 MB model)
 * runs only with SALIN_E2E_ASSISTANT=1.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { openWorkspace, uploadFiles, waitForOfflineReady, type SampleFile } from "./helpers";

test.describe.configure({ timeout: 300_000 });

const MODEL_DIR = path.join(import.meta.dirname, ".models");
const APP = "http://localhost:4173";
const MODEL_HOST = "https://huggingface.co";
const LARGE = 256 * 1024 * 1024;

/**
 * Serves model files from e2e/.models (downloading each once), and records every request.
 * Files over 256 MB go to the real host: Playwright can't pass bodies that large to the browser.
 */
async function serveModels(context: BrowserContext, requests: { url: string; method: string }[]) {
  context.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  await context.route(`${MODEL_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const file = path.join(MODEL_DIR, decodeURIComponent(url.pathname));
    const size = await stat(file).then((s) => s.size, () => null);
    if (size !== null && size > LARGE) return route.continue();
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      const response = await route.fetch();
      body = await response.body();
      if (!response.ok()) return route.fulfill({ response });
      if (body.length > LARGE) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, body);
        return route.continue();
      }
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    }
    return route.fulfill({ status: 200, body, headers: { "content-type": "application/octet-stream", "access-control-allow-origin": "*" } });
  });
}

function expectOnlyApprovedRequests(requests: { url: string; method: string }[]) {
  const web = requests.filter((r) => /^https?:/.test(r.url));
  expect(web.filter((r) => !r.url.startsWith(APP) && !r.url.startsWith(MODEL_HOST)).map((r) => r.url)).toEqual([]);
  // Nothing is ever sent: no uploads of documents, text or results.
  expect(web.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`)).toEqual([]);
}

async function renderPage(browser: Browser, name: string, body: string): Promise<SampleFile> {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.setContent(`<div id="sheet" style="width:820px;padding:48px 56px;background:#fff;color:#111;font:22px/1.6 Arial,Helvetica,sans-serif">${body}</div>`);
  const buffer = await page.locator("#sheet").screenshot();
  await context.close();
  return { name, mimeType: "image/png", buffer };
}

const HAND = "font:italic 30px 'Segoe Script','Bradley Hand','Comic Sans MS',cursive;color:#1b2a6b";

async function openRead(page: Page, fileName: string, template: RegExp) {
  await page.getByRole("button", { name: `More actions for ${fileName}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Read text (OCR)" }).click();
  await expect(page).toHaveURL(/\/scans\/[\w-]+$/, { timeout: 30_000 });
  await page.getByText("Options").first().click();
  await page.getByRole("radio", { name: template }).check();
  await page.getByRole("button", { name: /^Read (page|\d+ pages)$/ }).click();
  await expect(page.getByRole("checkbox", { name: "Only show what needs a look" })).toBeVisible({ timeout: 150_000 });
}

test("handwriting is read on the device, offline, and offered as suggestions the reviewer approves", async ({ page, context, browser }) => {
  const requests: { url: string; method: string }[] = [];
  await serveModels(context, requests);
  const form = await renderPage(
    browser,
    "Handwritten.png",
    `<h2 style="text-align:center;margin:0 0 30px">PET REGISTRATION FORM</h2>
     <p>Owner's Name: <span style="${HAND}">Maria Santos</span></p>
     <p>Address: <span style="${HAND}">Purok 4, Muzon</span></p>
     <p>Pet's Name: <span style="${HAND}">Mingming</span></p>
     <p>Breed: <span style="${HAND}">Puspin</span></p>
     <p>Color: <span style="${HAND}">Orange</span></p>`,
  );

  await openWorkspace(page);
  await waitForOfflineReady(page);

  // Settings: choose AI Lite and download the handwriting reader (size, license and source shown).
  await page.goto("/settings");
  await page.getByRole("radio", { name: /^AI Lite/ }).check();
  const reader = page.getByRole("listitem").filter({ hasText: "Handwriting reader" });
  await expect(reader).toContainText("Apache-2.0");
  await expect(reader).toContainText("huggingface.co · PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx @ 3fafbc3 (pinned)");
  await reader.getByRole("button", { name: /^Download/ }).click();
  await expect(reader.getByText("Ready offline")).toBeVisible({ timeout: 180_000 });
  await reader.getByRole("button", { name: "Check files" }).click();
  await expect(page.getByText("All files are complete and ready offline.")).toBeVisible({ timeout: 60_000 });

  // Read the printed parts with OCR (downloads the OCR files too).
  await page.goto("/");
  await uploadFiles(page, [form]);
  await openRead(page, "Handwritten.png", /Pet registration form/);

  // Airplane mode from here: the handwriting reader runs from the device's copy.
  await context.setOffline(true);
  const readButton = page.getByRole("button", { name: /^Read handwriting/ });
  await expect(readButton).toBeEnabled();
  await readButton.click();
  await expect(page.getByText(/suggestions? to review|No suggestions/)).toBeVisible({ timeout: 120_000 });
  const suggestions = page.getByRole("group", { name: /^Suggestion for / });
  await expect(suggestions.first()).toBeVisible();

  // Use the first suggestion: the field takes the value, and keeps where it came from.
  const first = suggestions.first();
  const field = ((await first.getAttribute("aria-label")) ?? "").replace("Suggestion for ", "");
  const suggested = ((await first.getByLabel(/^Suggested: /).getAttribute("aria-label")) ?? "").replace("Suggested: ", "");
  await expect(first).toContainText("Handwriting");
  await first.getByRole("button", { name: "Use" }).click();
  await expect(page.getByRole("textbox", { name: field, exact: true })).toHaveValue(suggested);
  await expect(page.getByText("From an accepted handwriting suggestion").first()).toBeVisible();

  // Dismissing keeps the value as read.
  const remaining = await suggestions.count();
  if (remaining > 0) {
    await suggestions.first().getByRole("button", { name: "Dismiss" }).click();
    await expect(suggestions).toHaveCount(remaining - 1);
  }
  await context.setOffline(false);

  // Save: required values the reviewer types (the accepted one stays), then the dataset records which value came from the handwriting reader.
  const required: Record<string, string> = { "Owner's name": "Maria Santos", Address: "Purok 4, Muzon", "Pet's name": "Mingming" };
  for (const [name, value] of Object.entries(required)) if (name !== field) await page.getByRole("textbox", { name, exact: true }).fill(value);
  await page.getByRole("button", { name: /^Species: / }).click();
  await page.getByRole("menuitemradio", { name: "Cat" }).click();
  await page.getByRole("button", { name: /^Save (dataset|\d+ datasets)$/ }).click();
  await expect(page).toHaveURL(/\/datasets\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: `${field}, row 1` })).toHaveAttribute("title", /Suggested by the handwriting reader, approved in review/);

  expectOnlyApprovedRequests(requests);
});

test("rule suggestions, Transform with preview, filter and undo work without any AI model", async ({ page, browser }) => {
  const cell = "border:2px solid #111;padding:6px 12px;text-align:left";
  const rows = [
    ["1", "Ana Cruz", "Bantay", "Dog", "M"],
    ["2", "Ben Reyes", "Ming", "Cat", "F"],
    ["3", "Cara Lim", "Choco", "Dog", "F"],
  ];
  const sheet = await renderPage(
    browser,
    "Census.png",
    `<h2 style="text-align:center;margin:0 0 20px">VETERINARY CENSUS SHEET</h2>
     <p>Barangay: Poblacion</p>
     <table style="border-collapse:collapse;width:100%;margin:16px 0">
       <tr>${["No.", "Owner", "Pet Name", "Species", "Sex"].map((h) => `<th style="${cell}">${h}</th>`).join("")}</tr>
       ${rows.map((r) => `<tr>${r.map((v) => `<td style="${cell}">${v}</td>`).join("")}</tr>`).join("")}
     </table>`,
  );
  await openWorkspace(page);
  await uploadFiles(page, [sheet]);
  await openRead(page, "Census.png", /Veterinary census sheet/);

  // Standard forms are suggested by rules, never applied silently.
  await expect(page.getByRole("heading", { name: /Suggestions/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Sex, record 1" })).toHaveValue("M");
  await page.getByRole("button", { name: /^Use all \d+ rule suggestions$/ }).click();
  await expect(page.getByRole("textbox", { name: "Sex, record 1" })).toHaveValue("Male");
  await expect(page.getByRole("textbox", { name: "Sex, record 2" })).toHaveValue("Female");
  // Without AI downloaded, the tools say how to turn them on.
  await expect(page.getByText(/Set it up in Settings|Download the handwriting reader|Turn on AI Lite/).first()).toBeVisible();

  await page.getByRole("button", { name: /^Save (dataset|\d+ datasets)$/ }).click();
  await page.getByRole("link", { name: /Animals/ }).first().click().catch(async () => {
    await page.goto("/datasets");
    await page.getByRole("link", { name: /Animals/ }).click();
  });
  await expect(page.getByRole("textbox", { name: "Owner, row 3" })).toHaveValue("Cara Lim", { timeout: 30_000 });

  // Without the assistant, plain-language requests point to the manual tools.
  await expect(page.getByText(/Want to ask in plain words\?/)).toBeVisible();

  // Filter: a view, nothing changes.
  await page.getByRole("button", { name: "Transform" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Condition 1 column/ }).click();
  await page.getByRole("menuitemradio", { name: "Species" }).click();
  await dialog.getByRole("textbox", { name: "Condition 1 value" }).fill("dog");
  await dialog.getByRole("button", { name: "Preview" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Show rows where Species is “dog”");
  await dialog.getByRole("button", { name: "Show 2 rows" }).click();
  await expect(page.getByText(/Showing 2 of 3 rows/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Owner, row 2" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show all rows" }).click();

  // Delete rows: previewed, confirmed, then undone.
  await page.getByRole("button", { name: "Transform" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Action/ }).click();
  await page.getByRole("menuitemradio", { name: /Delete rows where/ }).click();
  await dialog.getByRole("button", { name: /^Condition 1 column/ }).click();
  await page.getByRole("menuitemradio", { name: "Species" }).click();
  await dialog.getByRole("textbox", { name: "Condition 1 value" }).fill("Cat");
  await dialog.getByRole("button", { name: "Preview" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("These rows will be removed");
  await dialog.getByRole("button", { name: "Delete 1 row" }).click();
  await expect(page.getByText("3 rows · ")).toHaveCount(0);
  await expect(page.getByText(/^2 rows · /)).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByText(/^3 rows · /)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Owner, row 2" })).toHaveValue("Ben Reyes");
});

// Playwright needs the fixtures argument; this test makes its own disk-backed browser instead.
// eslint-disable-next-line no-empty-pattern
test("the assistant turns a plain-language request into a previewed, validated change", async ({}, testInfo) => {
  test.skip(!process.env.SALIN_E2E_ASSISTANT, "Set SALIN_E2E_ASSISTANT=1 to run (downloads a ~600 MB model once).");
  test.setTimeout(1_200_000);
  // A disk-backed profile, like a real browser: Playwright's default in-memory storage can't keep a model file this large.
  const { channel, baseURL } = testInfo.project.use;
  const context = await chromium.launchPersistentContext(testInfo.outputPath("profile"), { channel, baseURL });
  const page = context.pages()[0] ?? (await context.newPage());
  const requests: { url: string; method: string }[] = [];
  await serveModels(context, requests);
  // The phone build (Qwen3-0.6B); the laptop build runs with WebLLM and is checked by hand (docs/PHASE5_AI.md).
  await context.addInitScript(() => Object.defineProperty(navigator, "deviceMemory", { get: () => 4 }));

  await page.goto("/settings");
  await page.getByRole("radio", { name: /^AI Advanced/ }).check();
  const assistant = page.getByRole("listitem").filter({ hasText: "On-device assistant" });
  await assistant.getByRole("button", { name: /^Download/ }).click();
  await expect(assistant.getByText("Ready offline")).toBeVisible({ timeout: 900_000 });

  await openWorkspace(page);
  await uploadFiles(page, [{ name: "Pets.csv", mimeType: "text/csv", buffer: Buffer.from("Owner,Barangay,Species,Vaccinated\nAna Cruz,Muzon,Dog,yes\nBen Reyes,Muzon,Cat,no\nCara Lim,Gaya-gaya,Dog,no") }]);
  await page.getByRole("button", { name: "More actions for Pets.csv", exact: true }).click();
  await page.getByRole("menuitem", { name: "Extract data" }).click();
  await expect(page.getByRole("textbox", { name: "Owner, row 1" })).toHaveValue("Ana Cruz", { timeout: 30_000 });

  await page.getByRole("textbox", { name: "Ask about this dataset" }).fill("show only the dogs");
  await page.getByRole("button", { name: "Ask" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("The assistant understood your request as:", { timeout: 600_000 });
  await expect(dialog).toContainText(/Species/);
  await dialog.getByRole("button", { name: /^Show \d+ rows?$/ }).click();
  await expect(page.getByText(/Showing 2 of 3 rows/)).toBeVisible();

  expectOnlyApprovedRequests(requests);
  await context.close();
});
