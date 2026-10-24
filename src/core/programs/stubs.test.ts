/**
 * Program Stubs Tests
 * When scanning counts (only on the program date, Manila time), what a
 * scanned code means against the day pack, and the outbox changes that
 * names, scans and walk-ins become.
 */

import { describe, expect, it } from "vitest";

import { confirmOwner, findStub, pickProgram, programDay, programTime, redeemStub, todayManila, walkIn, type DayPack, type PackStub } from "./stubs";

const code = (n: number) => `CVS1.${String(n).padStart(22, "a")}`;
const stub = (extra: Partial<PackStub>): PackStub => ({
  id: 1, code: code(1), status: "Issued", owner: { name: "Juana Cruz", mobile: "09171234567", address: "", barangayId: 4 }, pets: [{ name: "Bantay", species: "Dog", processes: ["Neuter/Spay"] }], redeemedAt: null, barangayId: 4, ...extra,
});
const pack = (stubs: PackStub[]): DayPack => ({
  program: { id: 9, title: "Kapon Day", date: "2026-11-05", location: "Covered court", hostBarangayId: 4, hostBarangay: "Assumption", allowedBarangays: [], status: "Open", processes: ["Neuter/Spay"] },
  generatedAt: "2026-11-04T00:00:00Z", stubs,
});

describe("programDay", () => {
  it("counts scans only on the program date, in Manila time", () => {
    expect(programDay({ date: "2026-11-05" }, "2026-11-04")).toBe("before");
    expect(programDay({ date: "2026-11-05" }, "2026-11-05")).toBe("today");
    expect(programDay({ date: "2026-11-05" }, "2026-11-06")).toBe("over");
    // 17:00 UTC on the 4th is already the 5th in Manila.
    expect(todayManila(new Date("2026-11-04T17:00:00Z"))).toBe("2026-11-05");
  });

  it("writes the program's hours in 12-hour time", () => {
    expect(programTime({ startTime: "08:00", endTime: "13:30" })).toBe("8:00 AM–1:30 PM");
    expect(programTime({})).toBe("");
  });
});

describe("pickProgram", () => {
  it("opens on today's program, else the next, else the latest past one", () => {
    const programs = [{ date: "2026-10-01" }, { date: "2026-11-20" }, { date: "2026-11-05" }];
    expect(pickProgram(programs, "2026-11-05")?.date).toBe("2026-11-05");
    expect(pickProgram(programs, "2026-11-06")?.date).toBe("2026-11-20");
    expect(pickProgram(programs, "2026-12-01")?.date).toBe("2026-11-20");
    expect(pickProgram([], "2026-12-01")).toBeNull();
  });
});

describe("findStub", () => {
  const day = pack([stub({}), stub({ id: 2, code: code(2), status: "Redeemed" }), stub({ id: 3, code: code(3), status: "Cancelled" }), stub({ id: 4, code: code(4), status: "Available", owner: null, pets: [] })]);

  it("finds this program's stubs and refuses used, cancelled and foreign ones", () => {
    expect(findStub(day, ` ${code(1)} `, new Set())).toMatchObject({ kind: "ok", stub: { id: 1 } });
    expect(findStub(day, code(4), new Set())).toMatchObject({ kind: "ok", stub: { id: 4 } });
    expect(findStub(day, code(2), new Set())).toMatchObject({ kind: "used" });
    expect(findStub(day, code(1), new Set([1]))).toMatchObject({ kind: "used" });
    expect(findStub(day, code(3), new Set())).toEqual({ kind: "unknown" });
    expect(findStub(day, code(5), new Set())).toEqual({ kind: "unknown" });
    expect(findStub(day, "https://example.com", new Set())).toEqual({ kind: "invalid" });
  });
});

describe("changes", () => {
  it("sends the written name tidied", () => {
    expect(confirmOwner({ id: 5 }, "  Juana   Cruz ").body).toEqual({ action: "confirm-owner", stubId: 5, ownerName: "Juana Cruz" });
  });

  it("redeems a stub with each pet served or deferred, the item id doubling as the request id", () => {
    const s = stub({});
    const change = redeemStub(s, s.owner!, [{ name: "Bantay ", species: "Dog", processes: ["Neuter/Spay"], served: true }, { name: "Muning", species: "Cat", processes: ["Neuter/Spay"], served: false }, { name: "", species: "Dog", processes: [], served: true }], "2026-11-05");
    expect(change.id).toBe(change.body.requestId);
    expect(change.body).toMatchObject({ action: "redeem", stubId: 1, attendedOn: "2026-11-05", owner: { name: "Juana Cruz" } });
    expect(change.body.pets).toEqual([{ name: "Bantay", species: "Dog", processes: ["Neuter/Spay"], outcome: "Completed" }, { name: "Muning", species: "Cat", processes: ["Neuter/Spay"], outcome: "Deferred" }]);
  });

  it("records a walk-in for the program", () => {
    const change = walkIn(9, { name: "Pedro", mobile: "", address: "", barangayId: 4 }, [{ name: "Tagpi", species: "Dog", processes: ["Neuter/Spay"], served: true }], "2026-11-05");
    expect(change.body).toMatchObject({ action: "walk-in", campaignId: 9, requestId: change.id, pets: [{ name: "Tagpi", outcome: "Completed" }] });
  });
});
