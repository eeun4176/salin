/**
 * Synthetic Census Sheets (e2e)
 * Filled-in census sheets for tests and benchmarks without real paravet
 * samples: a sheet printed by the Print forms page, written in with a
 * handwriting-style font (letters jittered in size, angle and position),
 * ticked, then photographed at an angle with blur and uneven light.
 * Seeded, so a sheet can be made again exactly.
 */

import { expect, type Browser, type Page } from "@playwright/test";

export type SheetStyle = "neat" | "messy" | "thin";

export const FONTS = ["Segoe Print", "Segoe Script", "Ink Free", "Comic Sans MS", "Bradley Hand ITC", "Kristen ITC", "Lucida Handwriting", "MV Boli"];
const FIRST = ["JUAN", "MARIA", "JOSE", "ANA", "MARK", "ROSE", "IAN", "JOY", "CARLO", "LIZA", "RAMON", "NENA"];
const LAST = ["DELA CRUZ", "SANTOS", "REYES", "GARCIA", "BAUTISTA", "CABALQUINTO", "MENDOZA", "VILLANUEVA", "AQUINO", "TORRES"];
const STREETS = ["BLK 2 LOT 5", "PUROK 3", "123 RIZAL ST", "PH 1 BLK 7", "SITIO PAG ASA", "VC2 AREA G"];
const PETS = ["MOCHA", "BANTAY", "CHOCO", "MINGMING", "BROWNIE", "PUTI", "TIGER", "LUCKY"];
// The v2 sheet's Color tick boxes.
const COLORS = ["BROWN", "BLACK", "WHITE", "GRAY", "ORANGE", "MIXED/SPOTTED"];

/** Seeded random numbers, so a run can be repeated. */
function random(seed: number) {
  // mulberry32: well mixed even for neighbouring seeds.
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Truth {
  owner_name: string;
  address: string;
  contact: string;
  pet_name: string;
  color: string;
  type: string;
  sex: string;
  vaccination: string;
}

export function truthFor(n: number): Truth {
  const r = random(n + 1);
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length)];
  return {
    owner_name: `${pick(FIRST)} ${pick(LAST)}`,
    address: pick(STREETS),
    contact: `09${Array.from({ length: 9 }, () => Math.floor(r() * 10)).join("")}`,
    pet_name: pick(PETS),
    color: pick(COLORS),
    type: pick(["DOG", "CAT"]),
    sex: pick(["MALE", "FEMALE"]),
    vaccination: pick(["1ST", "2ND", "3RD", "BOOSTER"]),
  };
}

export async function printedSheet(page: Page, sheetNo: number) {
  await page.goto("/census/print");
  await page.getByLabel("Date of census").fill("2026-10-22");
  await page.getByLabel("First sheet no.").fill(String(sheetNo));
  await page.getByLabel("How many").fill("1");
  await expect(page.getByText(`Sheets ${sheetNo}–${sheetNo}.`)).toBeVisible();
  return page.locator(".census-print svg").first().evaluate((svg) => svg.outerHTML);
}

/**
 * Fills a sheet in a handwriting font and photographs it. "messy" writes
 * bigger, wobblier letters; "thin" uses a light, thin pen (the hardest case
 * for spotting writing in a box).
 */
export async function filledPhoto(browser: Browser, svg: string, truth: Truth, n: number, style: SheetStyle = "neat") {
  const r = random(1000 + n);
  const font = FONTS[n % FONTS.length];
  const tilt = { x: 2 + r() * 6, z: -2 + r() * 4 };
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1000, height: 1400 } });
  const page = await context.newPage();
  await page.setContent(
    `<body style="margin:0;background:#8f8b84"><div id="photo" style="display:inline-block;padding:40px;position:relative">` +
      `<div style="transform:perspective(2200px) rotateX(${tilt.x}deg) rotateZ(${tilt.z}deg);filter:blur(${(r() * 0.6).toFixed(2)}px)">${svg}</div>` +
      `<div style="position:absolute;inset:0;background:linear-gradient(${Math.round(r() * 360)}deg,rgba(0,0,0,${(r() * 0.18).toFixed(2)}),transparent 60%)"></div></div></body>`,
  );
  const jitter = Array.from({ length: 400 }, () => r());
  await page.evaluate(
    ({ truth, font, jitter, style }) => {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.querySelector("svg")!;
      let j = 0;
      const next = () => jitter[j++ % jitter.length];
      const ink = style === "thin" ? "#6f7fb0" : next() > 0.5 ? "#1a2a6b" : "#151515";
      const wobble = style === "messy" ? 2.2 : 1;
      const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
        const el = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        if (text) el.textContent = text;
        svg.append(el);
      };
      const texts = [...svg.querySelectorAll("text")];
      const tick = (word: string, nth: number) => {
        const t = texts.filter((el) => el.textContent === word)[nth];
        const x = Number(t.getAttribute("x")) - 5.7;
        const y = Number(t.getAttribute("y")) - 3.5;
        add("path", { d: `M${x + 0.6 + next()} ${y + 2.4} L${x + 1.9} ${y + 3.9} L${x + 3.6 + next() * 0.6} ${y + 0.4 + next()}`, stroke: ink, "stroke-width": 0.5, fill: "none", "stroke-linecap": "round" });
      };
      // v2 sheet: open lines (rounded) in print order — owner name, 2 address lines, then per pet: name, other vaccines, remarks;
      // letter boxes only for the contact number.
      const lines = [...svg.querySelectorAll('rect[stroke="#8a8f8c"][rx]')];
      const boxes = [...svg.querySelectorAll('rect[stroke="#8a8f8c"]:not([rx])')];
      const letter = (ch: string, x: number, y: number) => {
        const size = style === "messy" ? 3.6 + next() * 2.4 : 4 + next() * 1.4;
        add("text", { x, y, "font-size": size, "font-family": font, "font-weight": style === "thin" ? 300 : 400, "text-anchor": "middle", fill: ink, transform: `rotate(${(next() - 0.5) * 14 * wobble} ${x} ${y})` }, ch);
        return size;
      };
      const inBoxes = (from: number, letters: string) =>
        [...letters].forEach((ch, i) => {
          const b = boxes[from + i];
          letter(ch, Number(b.getAttribute("x")) + 3.1 + (next() - 0.5) * 1.2 * wobble, Number(b.getAttribute("y")) + 5.2 + (next() - 0.5) * 0.8 * wobble);
        });
      // Natural writing along a line: letters a little apart, words a little further.
      const onLine = (line: Element, text: string) => {
        let x = Number(line.getAttribute("x")) + 3 + next() * 2;
        const baseline = Number(line.getAttribute("y")) + 5 + (next() - 0.5) * 0.6;
        for (const ch of text) {
          if (ch === " ") {
            x += 2.6 + next() * 1.5;
            continue;
          }
          const size = letter(ch, x, baseline + (next() - 0.5) * 0.7 * wobble);
          x += size * 0.7 + (next() - 0.3) * 0.8 * wobble;
        }
      };
      onLine(lines[0], truth.owner_name);
      onLine(lines[1], truth.address);
      inBoxes(0, truth.contact);
      onLine(lines[3], truth.pet_name);
      tick(truth.color, 0);
      tick(truth.type, 0);
      tick(truth.sex, 0);
      tick(truth.vaccination, 0);
      tick("N/A — NO PET IN THIS SLOT", 1);
      tick("N/A — NO PET IN THIS SLOT", 2);
    },
    { truth, font, jitter, style },
  );
  const buffer = await page.locator("#photo").screenshot();
  await context.close();
  return { name: `Synthetic ${n + 1}.png`, mimeType: "image/png", buffer, font, style };
}

