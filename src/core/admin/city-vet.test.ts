/**
 * City Vet Features Tests
 * Turning a typed request into a search term, where notice links lead in
 * Salin, and the datasets made from search results and saved program records.
 */

import { describe, expect, it } from "vitest";

import { noticeLink, programRecordsContent, searchContent, searchTerm } from "./city-vet";

describe("searchTerm", () => {
  it("keeps the name or code, dropping request words in English and Filipino", () => {
    expect(searchTerm("Give me the records of Juan Cruz")).toBe("juan cruz");
    expect(searchTerm("Hanapin ang mga aso ni Maria Santos?")).toBe("aso maria santos");
    expect(searchTerm("show CVS1.abc")).toBe("cvs1 abc");
    expect(searchTerm("show records")).toBe("show records");
  });
});

describe("noticeLink", () => {
  it("opens stub and request notices on the Programs page", () => {
    expect(noticeLink("/stubs?campaignId=4&batchId=2")).toBe("/programs?tab=stubs");
    expect(noticeLink("/program-interest?id=3")).toBe("/programs");
    expect(noticeLink("/reports")).toBeNull();
    expect(noticeLink(null)).toBeNull();
  });
});

describe("datasets", () => {
  it("lists search results as rows", () => {
    const content = searchContent([{ key: "owner:1", kind: "Owner", id: "OWN-1", label: "Juan Cruz", detail: "Assumption", source: "Registry", status: null, updatedAt: "2026-10-01T02:00:00Z" }]);
    expect(content.columns.map((c) => c.name)).toEqual(["Record", "Name", "Details", "Source", "Status", "Updated", "Record ID"]);
    expect(content.rows[0].values).toEqual({ c0: "Owner", c1: "Juan Cruz", c2: "Assumption", c3: "Registry", c4: "", c5: "2026-10-01", c6: "OWN-1" });
  });

  it("puts the request's pets, the stubs and attendance in one table", () => {
    const content = programRecordsContent({
      request: {
        campaign: { reference: "PI-1", status: "requested" } as never,
        people: [
          { id: 1, owner_name: "Juan Cruz", mobile: "0917", residence_barangay_id: 4, residence_barangay: "A", pets: [{ name: "Bantay", species: "Dog", processes: ["Neuter/Spay"] }], status: "interested", updated_at: "" },
          { id: 2, owner_name: "Gone", mobile: null, residence_barangay_id: 4, residence_barangay: "A", pets: [], status: "withdrawn", updated_at: "" },
        ],
        activity: [],
      },
      sheets: [{ program: { date: "2026-11-05" }, stubs: [{ id: 7, code: "x", ownerName: "Juan Cruz", status: "Issued", services: ["Neuter/Spay"], ownerConfirmedAt: "2026-11-01" }] } as never],
      attendance: [{ program: "Kapon Day", rows: [{ id: 1, source: "Walk-in", stubId: null, owner: { name: "Pedro" }, pets: [{ name: "Tagpi" }], attendedOn: "2026-11-05", status: "Submitted" }] }],
    });
    expect(content.rows.map((r) => Object.values(r.values))).toEqual([
      ["Request", "PI-1", "Juan Cruz", "0917", "Bantay", "Dog", "Kapon", "Sent to City Vet", ""],
      ["Stub", "Stub 7", "Juan Cruz", "", "", "", "Kapon", "Name confirmed", "2026-11-05"],
      ["Attendance", "Kapon Day", "Pedro", "", "Tagpi", "", "", "Walk-in", "2026-11-05"],
    ]);
  });
});
