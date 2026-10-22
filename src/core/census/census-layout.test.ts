/**
 * Census Layout Tests
 * The printed sheet stays readable: everything fits on long bond paper,
 * nothing overlaps (so a mark can't be read into the wrong box), tick boxes
 * keep clear gaps, and nothing crowds the corner markers.
 */

import { describe, expect, it } from "vitest";

import { CENSUS_LAYOUT, PAGE, type Rect } from "./census-layout";

const layout = CENSUS_LAYOUT;
const readable: Rect[] = [
  ...layout.code,
  ...layout.owner.flatMap((f) => f.rows.flat()),
  ...layout.pets.flatMap((p) => [p.notApplicable, ...p.writeIns.flatMap((f) => f.rows.flat()), ...p.choices.flatMap((g) => g.options.map((o) => o.box)), ...p.numbers.flatMap((g) => g.places.flatMap((pl) => pl.bubbles))]),
];
const overlap = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

describe("census layout", () => {
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

  it("has one owner block and three identical pet blocks", () => {
    expect(layout.owner.map((f) => f.key)).toEqual(["owner_name", "address", "contact"]);
    const shape = (slot: number) => layout.pets[slot].choices.map((g) => [g.key, g.options.map((o) => o.value)]);
    expect(shape(1)).toEqual(shape(0));
    expect(shape(2)).toEqual(shape(0));
  });
});
