/**
 * Program Calendar Tests
 * Month grids are whole Sunday-first weeks with the neighbouring months'
 * days filled in.
 */

import { describe, expect, it } from "vitest";

import { monthGrid, monthKey } from "@/core/programs/calendar";

describe("program calendar", () => {
  it("fills whole weeks from Sunday", () => {
    // October 2026 starts on a Thursday and has 31 days: 4 + 31 = 35 cells.
    const grid = monthGrid(2026, 9);
    expect(grid).toHaveLength(35);
    expect(grid[0]).toBe("2026-09-27");
    expect(grid[4]).toBe("2026-10-01");
    expect(grid.at(-1)).toBe("2026-10-31");
  });

  it("crosses the year", () => {
    const grid = monthGrid(2027, 0);
    expect(grid[0] < "2027-01-01").toBe(true);
    expect(grid).toContain("2027-01-31");
    expect(grid.length % 7).toBe(0);
  });

  it("names a month by its date prefix", () => {
    expect(monthKey(2026, 0)).toBe("2026-01");
  });
});
