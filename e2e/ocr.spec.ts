/**
 * OCR E2E Tests
 * Real on-device text recognition in Chrome, end to end: a printed pet
 * registration form photo goes through read (model downloaded from
 * Salin's own site, with progress; Fix pages on the side) → check & save
 * (values checked against the page, a missing required value blocks saving
 * until typed) → dataset (source region shown) → CSV export; a photo
 * imported with Extract data keeps only the columns asked for (tapped or
 * typed), and the rest are typed by hand; a census sheet becomes table
 * records; the model works offline once downloaded and explains what to do
 * when it's missing offline; damaged and blank images fail safely; and no
 * request ever leaves Salin's origin (no third-party inference).
 */

import { expect, test, type Browser, type Page } from "@playwright/test";

import { downloadText, openWorkspace, uploadFiles, waitForOfflineReady, type SampleFile } from "./helpers";

// Downloading the model and reading pages takes a while on a busy machine.
test.describe.configure({ timeout: 180_000 });

const PAGE_STYLE = "width:820px;padding:48px 56px;background:#fff;color:#111;font:22px/1.5 Arial,Helvetica,sans-serif";
const box = (checked: boolean) =>
  `<span style="display:inline-block;width:20px;height:20px;border:2.5px solid #111;vertical-align:-3px;margin:0 8px 0 18px;position:relative">${checked ? '<span style="position:absolute;inset:2px;background:#111"></span>' : ""}</span>`;

/** Renders HTML as a crisp PNG "photo" of a printed page. */
async function renderPage(browser: Browser, name: string, body: string): Promise<SampleFile> {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.setContent(`<div id="sheet" style="${PAGE_STYLE}">${body}</div>`);
  const buffer = await page.locator("#sheet").screenshot();
  await context.close();
  return { name, mimeType: "image/png", buffer };
}

const registrationForm = (browser: Browser) =>
  renderPage(
    browser,
    "Registration.png",
    `<h1 style="text-align:center;font-size:30px;margin:0">CITY VETERINARY OFFICE</h1>
     <h2 style="text-align:center;font-size:24px;margin:6px 0 36px">PET REGISTRATION FORM</h2>
     <p>Owner's Name: Juan Dela Cruz</p>
     <p>Pet's Name: Bantay</p>
     <p>Species:${box(true)}Dog${box(false)}Cat${box(false)}Other</p>
     <p>Breed: Aspin</p>
     <p>Date: 10/18/2026</p>`,
  );

async function openRead(page: Page, fileName: string) {
  await page.getByRole("button", { name: `More actions for ${fileName}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Read text (OCR)" }).click();
  await expect(page).toHaveURL(/\/scans\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Read text", level: 1 })).toBeVisible();
}

/** Before the recognition files are on the device: pick the kind of document under Options, read, and wait for Check & save. */
async function readWith(page: Page, template: RegExp) {
  await page.getByText("Options", { exact: false }).first().click();
  await page.getByRole("radio", { name: template }).check();
  await page.getByRole("button", { name: /^Read (page|\d+ pages)$/ }).click();
  await waitForCheck(page);
}

const waitForCheck = (page: Page) => expect(page.getByRole("checkbox", { name: "Only show what needs a look" })).toBeVisible({ timeout: 150_000 });

test("a printed registration form is read on the device, reviewed against the page, saved and exported", async ({ page, browser }) => {
  const origin = new URL(page.url() || "http://localhost:4173").origin;
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.origin !== "http://localhost:4173") foreign.push(request.url());
  });
  void origin;

  await openWorkspace(page);
  await uploadFiles(page, [await registrationForm(browser)]);
  await openRead(page, "Registration.png");

  // Fix pages (optional): the page and its clean-up options; the original stays as it is.
  await page.getByRole("button", { name: "Fix pages" }).click();
  await expect(page.getByRole("tab", { name: "Crop & rotate" })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Straighten text/ })).toBeChecked();
  await page.getByRole("tab", { name: "Preview for reading" }).click();
  await expect(page.getByRole("img", { name: "Page 1 as it will be read" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Done" }).click();

  // Read: the model downloads from Salin's own site, then the page is read.
  await readWith(page, /Pet registration form/);

  // Review: values with their state; the missing required address blocks saving.
  await expect(page.getByRole("textbox", { name: "Owner's name" })).toHaveValue("Juan Dela Cruz");
  await expect(page.getByRole("textbox", { name: "Pet's name" })).toHaveValue("Bantay");
  await expect(page.getByRole("button", { name: "Species: Dog" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue("");
  await page.getByRole("button", { name: "Save dataset" }).click();
  await expect(page.getByText(/1 required value needs attention/)).toBeVisible();
  await page.getByRole("textbox", { name: "Address" }).fill("Purok 2, Poblacion");

  // Save: straight to the dataset editor, with the source region.
  await page.getByRole("button", { name: "Save dataset" }).click();
  await expect(page).toHaveURL(/\/datasets\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Owner's name, row 1" })).toHaveValue("Juan Dela Cruz");
  await expect(page.getByRole("textbox", { name: "Address, row 1" })).toHaveValue("Purok 2, Poblacion");
  await expect(page.getByRole("link", { name: "View scan" })).toBeVisible();
  await page.getByRole("button", { name: /View source of row 1: Registration.png · scanned page 1/ }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "Scanned page 1" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Close" }).click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("menuitem", { name: /^CSV/ }).click();
  const csv = await downloadText(await download);
  expect(csv).toContain("Juan Dela Cruz");
  expect(csv).toContain("Bantay");

  // Nothing was sent anywhere but Salin itself — no cloud OCR.
  expect(foreign).toEqual([]);
});

test("a census sheet becomes one record per row, with totals checked against the rows", async ({ page, browser }) => {
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
     </table>
     <p>Total dogs: 3</p>`,
  );
  await openWorkspace(page);
  await uploadFiles(page, [sheet]);
  await openRead(page, "Census.png");
  await readWith(page, /Veterinary census sheet/);

  await expect(page.getByRole("textbox", { name: "Owner, record 1" })).toHaveValue("Ana Cruz");
  await expect(page.getByRole("textbox", { name: "Owner, record 3" })).toHaveValue("Cara Lim");
  await expect(page.getByRole("textbox", { name: "Species, record 2" })).toHaveValue("Cat");
  // The sheet says 3 dogs, but only 2 dog rows were read: flagged, not "fixed".
  await expect(page.getByText(/The page says 3, but 2 records were read/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save 2 datasets" })).toBeVisible();
});

test("an imported form photo is read by itself; naming the columns keeps only those, then it saves", async ({ page, browser }) => {
  await page.goto("/import");
  await page.getByTestId("file-input").setInputFiles([await registrationForm(browser)]);
  await page.getByRole("button", { name: "Extract data" }).click();
  await expect(page).toHaveURL(/\/scans\/[\w-]+$/, { timeout: 30_000 });
  // The files aren't on the device yet: downloading stays the user's choice, then reading starts.
  await page.getByRole("button", { name: /^Read page$/ }).click();
  await waitForCheck(page);

  // Labels found on the page can be tapped instead of typed.
  const bar = page.getByRole("region", { name: /What do you need/ });
  const columns = bar.getByRole("textbox", { name: "Columns you need" });
  await bar.getByRole("button", { name: /^Owner.s Name$/ }).click();
  await expect(columns).toHaveValue(/^Owner.s Name$/);
  await columns.fill("Owner's Name, Breed, Phone");
  await bar.getByRole("button", { name: "Extract" }).click();
  await expect(page.getByRole("textbox", { name: "Owner's Name", exact: true })).toHaveValue("Juan Dela Cruz");
  await expect(page.getByRole("textbox", { name: "Breed", exact: true })).toHaveValue("Aspin");
  await expect(page.getByRole("textbox", { name: /Pet.s Name/ })).toHaveCount(0);

  // Not on the page: typed by hand. Then saved, with only the asked columns.
  await page.getByRole("textbox", { name: "Phone", exact: true }).fill("0917 123 4567");
  await page.getByRole("button", { name: "Save dataset" }).click();
  await expect(page).toHaveURL(/\/datasets\/[\w-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Owner's Name, row 1" })).toHaveValue("Juan Dela Cruz");
  await expect(page.getByRole("textbox", { name: "Phone, row 1" })).toHaveValue("0917 123 4567");
  await expect(page.getByRole("textbox", { name: /Pet.s Name, row 1/ })).toHaveCount(0);
});

test("recognition works offline once downloaded, and explains what to do when the files are missing", async ({ page, context, browser }) => {
  const form = await registrationForm(browser);
  await openWorkspace(page);
  await waitForOfflineReady(page);

  // Offline before the files were ever downloaded: a clear recovery message.
  await context.setOffline(true);
  await page.goto("/settings");
  await expect(page.getByText(/Download the text-recognition files once/)).toBeVisible();
  await page.getByRole("region", { name: "Text recognition" }).getByRole("button", { name: /^Download / }).click();
  await expect(page.getByText(/aren't on this device yet, and you're offline/)).toBeVisible();

  // Back online: the download is offered again; download once.
  await context.setOffline(false);
  await page.getByRole("region", { name: "Text recognition" }).getByRole("button", { name: /^Download / }).click();
  await expect(page.getByText(/Text recognition is ready/)).toBeVisible({ timeout: 90_000 });

  // Airplane mode: open the app, add a page, read it.
  await context.setOffline(true);
  await page.goto("/");
  await uploadFiles(page, [form]);
  await openRead(page, "Registration.png");
  // The files are on the device, so reading starts by itself.
  await waitForCheck(page);
  await expect(page.getByRole("textbox", { name: "Owner's name" })).toHaveValue("Juan Dela Cruz");
  await context.setOffline(false);
});

test("damaged and blank images fail safely, and values can still be typed by hand", async ({ page, browser }) => {
  const blank = await renderPage(browser, "Blank.png", `<div style="height:600px"></div>`);
  await openWorkspace(page);
  // A PNG header followed by garbage: a damaged photo.
  const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("this image data was cut off")]);
  await uploadFiles(page, [{ name: "Broken.png", mimeType: "image/png", buffer: broken }, { name: "Notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("plain text, not a photo") }, blank]);

  // The card says what's wrong instead of showing a normal-looking preview.
  const thumb = page.locator('[data-thumbnail-for="Broken.png"]');
  await thumb.scrollIntoViewIfNeeded();
  await expect(thumb).toHaveAttribute("data-thumbnail-problem", "damaged", { timeout: 20_000 });
  await expect(thumb).toContainText("Damaged file");
  // Bytes of another format under a photo's name: said plainly, too.
  const other = page.locator('[data-thumbnail-for="Notes.jpg"]');
  await other.scrollIntoViewIfNeeded();
  await expect(other).toHaveAttribute("data-thumbnail-problem", "unsupported", { timeout: 20_000 });

  await openRead(page, "Broken.png");
  await page.getByRole("button", { name: /^Read page$/ }).click();
  await expect(page.getByRole("list", { name: "Pages" })).toContainText(/can't be opened/, { timeout: 150_000 });
  await page.goto("/");

  // The files are on the device now, so this one is read by itself.
  await openRead(page, "Blank.png");
  await waitForCheck(page);
  await expect(page.getByText(/No text was found on these pages/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add row" })).toHaveCount(0);

  // Typing by hand works without any recognition.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Type values myself" }).click();
  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByRole("textbox", { name: "Text, record 1" }).fill("Written by hand");
  await page.getByRole("button", { name: "Save dataset" }).click();
  await expect(page.getByRole("textbox", { name: "Text, row 1" })).toHaveValue("Written by hand", { timeout: 30_000 });
});

test("the camera screen offers retake-free fallbacks and sends pages straight to Read text", async ({ page }) => {
  await page.goto("/scan");
  // Headless Chrome has no camera: the fallback actions are offered.
  await expect(page.getByRole("button", { name: "Use the camera app" })).toBeVisible({ timeout: 20_000 });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload a photo or PDF" }).click();
  await (await chooser).setFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    { name: "Form.png", mimeType: "image/png", buffer: Buffer.from("x") },
  ]);
  await expect(page.getByText(/Skipped notes.txt \(not a photo or pdf\)/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await page.getByRole("button", { name: "Extract data" }).click();
  await expect(page).toHaveURL(/\/scans\/[\w-]+$/, { timeout: 30_000 });
  // The original photo was kept in the workspace.
  await page.goto("/");
  await expect(page.getByRole("button", { name: "More actions for Form.png", exact: true })).toBeVisible();
});
