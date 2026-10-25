/**
 * Walk-in Sheet Tests
 * Rows become one walk-in per owner (a blank owner cell continues the owner
 * above), blank rows are ignored, and a bad row is named.
 */

import { describe, expect, it } from "vitest";

import { blankWalkInRow, groupWalkIns, type WalkInRow } from "@/core/programs/walk-in-sheet";

const row = (owner: string, pet: string, extra: Partial<WalkInRow> = {}): WalkInRow => ({ ...blankWalkInRow(["Anti-Rabies Vaccine"]), owner, pet, ...extra });

describe("walk-in sheet", () => {
  it("groups pets under the owner above a blank owner cell", () => {
    const { owners, error } = groupWalkIns([row("Ana Cruz", "Bantay", { mobile: "0917-123-4567" }), row("", "Mingming", { species: "Cat" }), row("", ""), row("Ben Reyes", "Choco")]);
    expect(error).toBeNull();
    expect(owners.map((o) => [o.name, o.mobile, o.pets.map((p) => p.name)])).toEqual([
      ["Ana Cruz", "0917-123-4567", ["Bantay", "Mingming"]],
      ["Ben Reyes", "", ["Choco"]],
    ]);
    expect(owners[0].pets[1].species).toBe("Cat");
  });

  it("names the row that needs fixing", () => {
    expect(groupWalkIns([row("", "Bantay")]).error).toBe("Row 1: enter the owner's name.");
    expect(groupWalkIns([row("Ana", "Bantay"), row("Ben", "")]).error).toBe("Row 2: enter the pet's name.");
    expect(groupWalkIns([row("Ana", "Bantay", { mobile: "123" })]).error).toMatch(/^Row 1: enter the mobile/);
    expect(groupWalkIns([row("Ana", "Bantay", { processes: [] })]).error).toBe("Row 1: choose at least one service.");
  });

  it("needs at least one pet", () => {
    expect(groupWalkIns([row("", "")]).error).toBe("Add at least one owner and pet.");
  });

  it("caps pets per owner", () => {
    const rows = [row("Ana", "Pet 1"), ...Array.from({ length: 10 }, (_, i) => row("", `Pet ${i + 2}`))];
    expect(groupWalkIns(rows).error).toBe("Row 11: one owner can bring at most 10 pets.");
  });
});
