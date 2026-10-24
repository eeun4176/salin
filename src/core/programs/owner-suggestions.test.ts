/**
 * Owner Suggestion Tests
 * Matching typed names to known owners, merging the same owner from several
 * sources, and reading owners out of a census dataset on the device.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { COLUMN } from "@/core/census/census-records";
import { db } from "@/core/storage/database";
import { dayCacheKey } from "@/core/programs/stubs";
import { censusOwners, deviceOwners, mergeOwners, suggestOwners, type OwnerSuggestion } from "./owner-suggestions";

const owner = (name: string, extra: Partial<OwnerSuggestion> = {}): OwnerSuggestion => ({ name, mobile: "", source: "Census", pets: [], ...extra });

describe("suggestOwners", () => {
  const owners = [owner("Pedro Juanico"), owner("Juan Dela Cruz"), owner("Maria Juana Santos"), owner("Ana Reyes")];

  it("matches any word's start, names starting with the text first", () => {
    expect(suggestOwners(owners, "juan").map((o) => o.name)).toEqual(["Juan Dela Cruz", "Maria Juana Santos", "Pedro Juanico"]);
    expect(suggestOwners(owners, "juan cr").map((o) => o.name)).toEqual(["Juan Dela Cruz"]);
    expect(suggestOwners(owners, "j")).toEqual([]);
  });

  it("stops suggesting once the name is typed in full", () => {
    expect(suggestOwners(owners, "ana reyes")).toEqual([]);
  });
});

describe("mergeOwners", () => {
  it("keeps one entry per name with every source's pets", () => {
    const merged = mergeOwners([
      [owner("Juan Cruz", { pets: [{ name: "Bantay", species: "Dog" }] })],
      [owner("juan  cruz", { source: "Request", mobile: "0917", pets: [{ name: "Bantay", species: "Dog" }, { name: "Muning", species: "Cat" }] })],
    ]);
    expect(merged).toEqual([owner("Juan Cruz", { mobile: "0917", pets: [{ name: "Bantay", species: "Dog" }, { name: "Muning", species: "Cat" }] })]);
  });
});

describe("censusOwners", () => {
  beforeEach(async () => {
    await db.datasets.clear();
    await db.datasetRows.clear();
  });

  it("reads each owner and their pets from census datasets", async () => {
    const columns = [COLUMN.owner, "Contact number", COLUMN.pet, "Type of pet", "Sex"].map((name, i) => ({ id: `c${i}`, name, type: "text" as const, required: false, sourceHeader: null }));
    await db.datasets.add({ id: "d1", name: "Census", sourceFileIds: [], jobId: null, columns, rowCount: 2, status: "reviewed", version: 1, createdAt: 0, updatedAt: 0, lastExportedAt: null });
    await db.datasetRows.bulkAdd([
      { id: "r1", datasetId: "d1", position: 0, values: { c0: "Juan Cruz", c1: "0917-123-4567", c2: "Bantay", c3: "Dog", c4: "Male" }, source: null },
      { id: "r2", datasetId: "d1", position: 1, values: { c0: "Juan Cruz", c1: "", c2: "Muning", c3: "Cat", c4: "" }, source: null },
    ]);
    expect(await censusOwners()).toEqual([owner("Juan Cruz", { mobile: "0917-123-4567", pets: [{ name: "Bantay", species: "Dog", sex: "Male" }, { name: "Muning", species: "Cat", sex: undefined }] })]);
  });
});

describe("deviceOwners", () => {
  it("includes owners from the program day packs saved on the phone", async () => {
    await db.settings.put({ key: dayCacheKey("PV-1", 9), value: { savedAt: 0, data: { attendance: [], pack: { stubs: [{ owner: { name: "Ana Reyes", mobile: "0918" }, pets: [{ name: "Puti", species: "Cat", processes: [] }] }] } } } });
    expect(await deviceOwners("PV-1")).toContainEqual(owner("Ana Reyes", { source: "Stub", mobile: "0918", pets: [{ name: "Puti", species: "Cat", sex: undefined }] }));
  });
});
