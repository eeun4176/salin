/**
 * Census Layout Tests
 * Every version's printed sheet stays readable: everything fits on long
 * bond paper, nothing overlaps (so a mark can't be read into the wrong box),
 * tick boxes keep clear gaps, nothing crowds the corner markers, and the
 * markers and code strip never move between versions. v2 keeps letter boxes
 * only for the contact number; v3 lines its tick boxes up in columns.
 */

import { describe, expect, it } from "vitest";

import { SUPPORTED_VERSIONS } from "./code-strip";
import { CENSUS_LAYOUT, layoutFor, optionText, PAGE, type Rect } from "./census-layout";

const overlap = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

describe.each(SUPPORTED_VERSIONS)("census layout v%i", (version) => {
  const layout = layoutFor(version);
  const readable: Rect[] = [
    ...layout.code,
    ...layout.owner.flatMap((f) => f.rows.flat()),
    ...layout.pets.flatMap((p) => [p.notApplicable, ...p.writeIns.flatMap((f) => f.rows.flat()), ...p.choices.flatMap((g) => g.options.map((o) => o.box)), ...p.numbers.flatMap((g) => g.places.flatMap((pl) => pl.bubbles))]),
  ];

  it("fits the page and keeps clear of the corner markers", () => {
    for (const r of readable) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(PAGE.width);
      expect(r.y + r.height).toBeLessThanOrEqual(PAGE.height);
      for (const m of layout.markers) expect(overlap(r, m, 3)).toBe(false);
    }
  });

  it("never overlaps two readable boxes, and leaves 3 mm or more between tick boxes", () => {
    for (let i = 0; i < readable.length; i++) for (let j = i + 1; j < readable.length; j++) expect(overlap(readable[i], readable[j])).toBe(false);
    const ticks = layout.pets.flatMap((p) => p.choices.flatMap((g) => g.options.map((o) => o.box)));
    for (let i = 0; i < ticks.length; i++) for (let j = i + 1; j < ticks.length; j++) expect(overlap(ticks[i], ticks[j], 3)).toBe(false);
  });

  it("has one owner block and three identical pet blocks, with markers and code strip where every version has them", () => {
    expect(layout.owner.map((f) => f.key)).toEqual(["owner_name", "address", "contact"]);
    const shape = (slot: number) => layout.pets[slot].choices.map((g) => [g.key, g.options.map((o) => o.value)]);
    expect(shape(1)).toEqual(shape(0));
    expect(shape(2)).toEqual(shape(0));
    expect([layout.markers, layout.code]).toEqual([CENSUS_LAYOUT.markers, CENSUS_LAYOUT.code]);
  });
});

describe("census layout v2", () => {
  const layout = layoutFor(2);

  it("keeps letter boxes only for the contact number; color and registered year are tick boxes", () => {
    const fields = [...layout.owner, ...layout.pets[0].writeIns];
    expect(fields.filter((f) => !f.open).map((f) => f.key)).toEqual(["contact"]);
    expect(layout.pets[0].choices.map((g) => g.key)).toEqual(expect.arrayContaining(["color", "registered"]));
    expect(layout.pets[0].numbers.find((g) => g.key === "age_years")?.places.map((p) => p.bubbles.length)).toEqual([21]);
  });

  it("prints Registered In years counted back from the census year", () => {
    const years = layout.pets[0].choices.find((g) => g.key === "registered")!.options.map((o) => optionText(o.value, 2026));
    expect(years).toEqual(["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026", "EARLIER", "NOT YET"]);
  });
});

describe("census layout v3", () => {
  const layout = layoutFor(3);

  it("has a one-line address and keeps the pet blocks inside the page, clear of the bottom markers", () => {
    expect(layout.owner.find((f) => f.key === "address")!.rows).toHaveLength(1);
    const last = layout.pets[2].frame;
    expect(last.y + last.height).toBeLessThanOrEqual(layout.markers[3].y - 2);
    for (const [a, b] of [[layout.frames[1], layout.pets[0].frame], [layout.pets[0].frame, layout.pets[1].frame]]) expect(a.y + a.height).toBeLessThan(b.y);
  });

  it("lines tick boxes up in the same columns on every row", () => {
    // 12 columns across the frame; every box starts 2.5 mm into one.
    const { frame } = layout.pets[0];
    const column = (x: number) => (x - frame.x - 2.5) / (frame.width / 12);
    for (const box of layout.pets[0].choices.flatMap((g) => g.options.map((o) => o.box))) expect(Math.abs(column(box.x) - Math.round(column(box.x)))).toBeLessThan(1e-9);
    const firsts = layout.pets[0].choices.filter((g) => ["type", "breed", "vaccination", "color", "registered"].includes(g.key)).map((g) => g.options[0].box.x);
    expect(new Set(firsts).size).toBe(1);
  });
});
