import { describe, expect, it } from "vitest";

import { censusChanges, mobileNumber, planCensusSubmission } from "@/core/census/admin-submission";
import { COLUMN } from "@/core/census/census-records";
import type { CensusRecord } from "@/core/census/summary-workbook";

const census = { name: "Census · Kaypian · Oct 22, 2026", barangay: "Kaypian", censusDate: "2026-10-22" };

const record = (sheet: number, pet: number, extra: CensusRecord = {}): CensusRecord => ({
  [COLUMN.sheet]: sheet,
  [COLUMN.pet]: pet,
  [COLUMN.owner]: `OWNER ${sheet}`,
  "Complete address": "PUROK 1",
  "Name of pet": `PET ${sheet}-${pet}`,
  "Type of pet": "Dog",
  Sex: "Male",
  [COLUMN.status]: "Validated",
  ...extra,
});

describe("planCensusSubmission", () => {
  it("sends Validated pets grouped by owner, a continuation sheet's pets with the sheet it continues", () => {
    const plan = planCensusSubmission(census, [
      record(1, 1),
      record(1, 2, { [COLUMN.status]: "Pending" }),
      record(2, 1),
      record(3, 4, { [COLUMN.continuedFrom]: 1, [COLUMN.owner]: "OWNER 1" }),
    ]);
    expect(plan).toMatchObject({ owners: 2, pets: 3, held: 1 });
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]).toMatchObject({ label: census.name, censusDate: "2026-10-22", source: "form", householdsVisited: 2 });
    expect(plan.parts[0].owners.map((o) => [o.ownerName, o.pets.map((p) => p.petName)])).toEqual([
      ["OWNER 1", ["PET 1-1", "PET 3-4"]],
      ["OWNER 2", ["PET 2-1"]],
    ]);
  });

  it("maps the sheet's answers onto e-Kapon's fields, keeping Unknown as unknown", () => {
    const [owner] = planCensusSubmission(census, [
      record(1, 1, {
        "Age (years)": 2,
        "Age (months)": 3,
        Breed: "Mongrel mix",
        Sterilized: "Yes",
        Classification: "Free roaming",
        "Vaccination status": "2nd",
        Laps: "Unknown",
        Color: "Brown",
        "Registered in": "2024",
        "Contact number": "0917 123 4567",
      }),
      record(2, 1, { "Name of pet": null, "Vaccination status": "None", "Registered in": "Before 2019", Remarks: "Shy", "Complete address": null }),
    ]).parts[0].owners;
    expect(owner).toMatchObject({ address: "PUROK 1", contact: "0917-123-4567" });
    expect(owner.pets[0]).toMatchObject({
      species: "Dog",
      sex: "Male",
      ageMonths: 27,
      breedType: "Mongrel",
      sterilized: true,
      confinement: "Free-roaming",
      vaccine1st: false,
      vaccine2nd: true,
      booster: false,
      laps: null,
      color: "Brown",
      registeredYear: 2024,
    });
    expect(owner.pets[0].remarks).toBeUndefined();

    const plan = planCensusSubmission(census, [record(2, 1, { "Name of pet": null, "Vaccination status": "None", "Registered in": "Before 2019", Remarks: "Shy", "Complete address": null })]);
    const other = plan.parts[0].owners[0];
    expect(other.address).toBe("Kaypian");
    expect(plan.noAddress).toBe(1);
    expect(other.pets[0]).toMatchObject({ petName: "(no name)", vaccine1st: false, vaccine2nd: false, vaccine3rd: false, booster: false, sterilized: null, remarks: "Shy; Registered in: Before 2019" });
    expect(planCensusSubmission(census, [record(1, 1)]).parts[0].owners[0].pets[0]).toMatchObject({ vaccine1st: null, booster: null });
  });

  it("splits a census bigger than one submission into parts, each with its own request id", () => {
    const records = Array.from({ length: 450 }, (_, i) => record(i + 1, 1));
    const plan = planCensusSubmission(census, records);
    expect(plan.parts.map((p) => p.owners.length)).toEqual([200, 200, 50]);
    expect(plan.parts[2].label).toBe(`${census.name} (part 3 of 3)`);
    const changes = censusChanges(plan);
    expect(changes.map((c) => c.path)).toEqual(["/census/submissions", "/census/submissions", "/census/submissions"]);
    expect(changes.every((c) => c.body.requestId === c.id)).toBe(true);
    expect(new Set(changes.map((c) => c.id)).size).toBe(3);

    // 1,000 pets per part at most: six-pet owners fill 166 per part.
    const big = Array.from({ length: 200 }, (_, i) => Array.from({ length: 6 }, (_, p) => record(i + 1, p + 1))).flat();
    expect(planCensusSubmission(census, big).parts.map((p) => p.owners.reduce((n, o) => n + o.pets.length, 0))).toEqual([996, 204]);
  });
});

describe("mobileNumber", () => {
  it("accepts PH mobile numbers in the usual spellings and drops the rest", () => {
    expect(mobileNumber("09171234567")).toBe("0917-123-4567");
    expect(mobileNumber("+63 917 123 4567")).toBe("0917-123-4567");
    expect(mobileNumber("917-123-4567")).toBe("0917-123-4567");
    expect(mobileNumber("044 123 4567")).toBeUndefined();
    expect(mobileNumber("")).toBeUndefined();
  });
});
