/**
 * Image Preprocessing Tests
 * Checks the pixel routines and page analysis on synthetic images: quarter
 * turns, resizing, contrast, shadow flattening, adaptive black-and-white,
 * skew estimation and straightening, perspective cropping, page-edge
 * detection, ruling lines, checkbox states, sideways text, and the full
 * preparation pipeline (which must not modify its input).
 */

import { describe, expect, it } from "vitest";

import { detectDocumentQuad, estimateSkew, findCheckboxes, findRulingLines, inkRatio, looksSideways, speckDensity } from "@/core/ocr/imaging/analysis";
import { DEFAULT_EDITS, NOISY_SPECKS, preparePage } from "@/core/ocr/imaging/pipeline";
import {
  createGray,
  flattenLighting,
  grayToRgba,
  inkMask,
  resizeGray,
  rotateGray,
  rotateQuarter,
  stretchContrast,
  toGray,
  warpPerspective,
  type GrayImage,
} from "@/core/ocr/imaging/pixels";

function fill(image: GrayImage, x: number, y: number, w: number, h: number, value = 0) {
  for (let yy = Math.max(0, y); yy < Math.min(image.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(image.width, x + w); xx++) image.data[yy * image.width + xx] = value;
  }
}

const grainyToRgba = (image: GrayImage) => grayToRgba(image);

function outline(image: GrayImage, x: number, y: number, size: number, stroke = 2) {
  fill(image, x, y, size, stroke);
  fill(image, x, y + size - stroke, size, stroke);
  fill(image, x, y, stroke, size);
  fill(image, x + size - stroke, y, stroke, size);
}

/** A page of fake text: rows of short dark "words". */
function textPage(width = 600, height = 800, rowGap = 40) {
  const page = createGray(width, height);
  for (let y = 60; y < height - 60; y += rowGap) {
    for (let x = 50; x < width - 80; x += 70) fill(page, x, y, 50, 14);
  }
  return page;
}

describe("pixel routines", () => {
  it("converts RGBA to gray, treating transparency as white paper", () => {
    const rgba = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]) };
    expect([...toGray(rgba).data]).toEqual([0, 255]);
    expect(grayToRgba(toGray(rgba)).data.length).toBe(8);
  });

  it("turns by quarter turns clockwise and back", () => {
    const image = createGray(3, 2);
    image.data.set([1, 2, 3, 4, 5, 6]);
    const turned = rotateQuarter(image, 90, 1);
    expect([turned.width, turned.height]).toEqual([2, 3]);
    // The top-left pixel moves to the top-right corner.
    expect(turned.data[1]).toBe(1);
    expect([...rotateQuarter(turned, 270, 1).data]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...rotateQuarter(rotateQuarter(image, 180, 1), 180, 1).data]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("shrinks by averaging so thin strokes survive as gray", () => {
    const image = createGray(4, 4);
    fill(image, 0, 0, 1, 4); // a 1-px line
    const small = resizeGray(image, 2, 2);
    expect(small.data[0]).toBeLessThan(200);
    expect(small.data[1]).toBe(255);
  });

  it("stretches faint text to full contrast", () => {
    const image = createGray(100, 100, 200);
    fill(image, 10, 10, 30, 30, 150);
    const out = stretchContrast(image);
    expect(Math.min(...out.data)).toBe(0);
    expect(Math.max(...out.data)).toBe(255);
  });

  it("flattens a shadow so the paper is white everywhere while text stays dark", () => {
    const image = createGray(400, 300);
    // Shadow: the right half is much darker paper.
    for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) image.data[y * 400 + x] = x < 200 ? 240 : 120;
    fill(image, 50, 100, 60, 10, 40);
    fill(image, 300, 100, 60, 10, 20);
    const flat = flattenLighting(image);
    expect(flat.data[50 * 400 + 350]).toBeGreaterThan(230); // shadowed paper
    expect(flat.data[105 * 400 + 320]).toBeLessThan(100); // text in the shadow
    // Adaptive black-and-white finds both words and no shadow edge.
    const mask = inkMask(flat);
    expect(mask[105 * 400 + 70]).toBe(1);
    expect(mask[105 * 400 + 320]).toBe(1);
    expect(mask[50 * 400 + 200]).toBe(0);
  });

  it("crops a four-cornered region flat (perspective correction)", () => {
    const image = createGray(200, 200, 0);
    fill(image, 50, 40, 100, 120, 255);
    const out = warpPerspective(image, [
      { x: 50, y: 40 },
      { x: 149, y: 40 },
      { x: 149, y: 159 },
      { x: 50, y: 159 },
    ]);
    expect(out.width).toBe(99);
    expect(out.height).toBe(119);
    expect(Math.min(...out.data.subarray(out.width * 5, out.width * 6))).toBeGreaterThan(200);
  });
});

describe("page analysis", () => {
  it("measures and corrects skewed text", () => {
    const page = textPage();
    expect(estimateSkew(inkMask(page), page.width, page.height)).toBe(0);
    const tilted = rotateGray(page, 3);
    const skew = estimateSkew(inkMask(tilted), tilted.width, tilted.height);
    expect(Math.abs(skew - 3)).toBeLessThanOrEqual(0.5);
    const straightened = rotateGray(tilted, -skew);
    expect(Math.abs(estimateSkew(inkMask(straightened), straightened.width, straightened.height))).toBeLessThanOrEqual(0.3);
  });

  it("tells sideways pages from upright ones", () => {
    const page = textPage();
    expect(looksSideways(inkMask(page), page.width, page.height)).toBe(false);
    const turned = rotateQuarter(page, 90, 1);
    expect(looksSideways(inkMask(turned), turned.width, turned.height)).toBe(true);
  });

  it("finds a page lying on a darker table", () => {
    const photo = createGray(400, 300, 60);
    fill(photo, 80, 40, 220, 230, 235);
    const found = detectDocumentQuad(photo);
    expect(found).not.toBeNull();
    const [tl, , br] = found!.quad;
    expect(tl.x).toBeCloseTo(80 / 399, 1);
    expect(tl.y).toBeCloseTo(40 / 299, 1);
    expect(br.x).toBeCloseTo(299 / 399, 1);
    // A scan that is all paper needs no crop.
    expect(detectDocumentQuad(createGray(400, 300, 240))).toBeNull();
  });

  it("finds table rules and fill-in lines but not letters", () => {
    const page = createGray(1000, 800);
    for (let y = 100; y <= 400; y += 60) fill(page, 100, y, 700, 2); // 6 rows lines
    for (const x of [100, 300, 500, 798]) fill(page, x, 100, 2, 302); // 4 column lines
    fill(page, 120, 500, 10, 25); // a letter-sized stroke
    const { horizontal, vertical } = findRulingLines(inkMask(page), page.width, page.height);
    expect(horizontal).toHaveLength(6);
    expect(vertical).toHaveLength(4);
    expect(vertical.every((v) => v.height >= 290)).toBe(true);
  });

  it("classifies checkboxes as checked, unchecked or unclear", () => {
    const page = createGray(1000, 600);
    outline(page, 100, 100, 24); // empty
    outline(page, 200, 100, 24); // ticked with an X
    for (let i = 4; i < 20; i++) {
      fill(page, 200 + i, 100 + i, 2, 2);
      fill(page, 200 + 23 - i, 100 + i, 2, 2);
    }
    outline(page, 300, 100, 24); // a small, faint stroke
    fill(page, 309, 109, 3, 4);
    const boxes = findCheckboxes(inkMask(page, 0.1), page.width, page.height).sort((a, b) => a.box.x - b.box.x);
    expect(boxes.map((b) => b.state)).toEqual(["unchecked", "checked", "unclear"]);
  });

  it("tells grainy pages from clean print, and cleans grainy ones automatically", () => {
    const clean = textPage();
    expect(speckDensity(inkMask(clean), clean.width, clean.height)).toBeLessThan(NOISY_SPECKS / 10);
    const grainy = textPage();
    let seed = 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 3000; i++) fill(grainy, Math.floor(rand() * 600), Math.floor(rand() * 800), 2, 2, 40);
    expect(speckDensity(inkMask(grainy), grainy.width, grainy.height)).toBeGreaterThan(NOISY_SPECKS);
    const prepared = preparePage(grainyToRgba(grainy), DEFAULT_EDITS, { max: 900, min: 300 });
    expect(prepared.marks.autoDenoised).toBe(true);
    expect(preparePage(grainyToRgba(clean), DEFAULT_EDITS, { max: 900, min: 300 }).marks.autoDenoised).toBe(false);
  });

  it("measures ink to spot blank pages", () => {
    expect(inkRatio(inkMask(createGray(200, 200)))).toBe(0);
    expect(inkRatio(inkMask(textPage()))).toBeGreaterThan(0.01);
  });
});

describe("preparePage", () => {
  it("rotates, crops, enhances and straightens without touching the original", () => {
    const page = rotateGray(textPage(), 2);
    const source = grayToRgba(page);
    const checksum = (d: Uint8ClampedArray) => d.reduce((sum, v, i) => (sum + v * ((i % 251) + 1)) % 1_000_000_007, 0);
    const before = checksum(source.data);
    const prepared = preparePage(source, { ...DEFAULT_EDITS, rotation: 90 }, { max: 900, min: 300 });
    expect(prepared.image.width).toBeGreaterThan(prepared.image.height); // turned sideways
    expect(Math.abs(prepared.marks.skew)).toBeGreaterThan(1);
    expect(checksum(source.data)).toBe(before);

    const cropped = preparePage(source, { ...DEFAULT_EDITS, crop: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] }, { max: 2000, min: 100 });
    expect(cropped.image.width).toBeCloseTo(300, -1);
    expect(cropped.marks.inkRatio).toBeGreaterThan(0);
  });

  it("scales small photos up and huge ones down for OCR", () => {
    const small = preparePage(grayToRgba(createGray(400, 300)), DEFAULT_EDITS, { max: 2200, min: 1400 });
    expect(small.image.width).toBe(800);
    const big = preparePage(grayToRgba(createGray(3000, 2000)), DEFAULT_EDITS, { max: 2200, min: 1400 });
    expect(big.image.width).toBe(2200);
  });
});
