/**
 * Program Stubs Tests
 * When scanning counts (only on the program date, Manila time), what a
 * scanned code means against the day pack, encoding a blank stub, search,
 * who is present or absent, and the outbox changes scans and walk-ins become.
 */

import { describe, expect, it } from "vitest";

import { attendanceRoster, canPrint, draftIsBlank, draftProblem, emptyDraft, findStub, issueStub, pickProgram, programDay, programTime, redeemStub, stubMatches, todayManila, walkIn, type DayPack, type PackStub, type StubSheet } from "./stubs";

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

describe("encoding blank stubs", () => {
  it("checks a filled-in stub and leaves untouched ones blank", () => {
    const draft = emptyDraft(["Neuter/Spay"]);
    expect(draftIsBlank(draft)).toBe(true);
    expect(draftProblem({ ...draft, owner: "Juana" })).toBe("add at least one pet");
    expect(draftProblem({ ...draft, pets: [{ ...draft.pets[0], name: "Bantay" }] })).toBe("type the owner's name");
    expect(draftProblem({ ...draft, owner: "Juana", mobile: "12345", pets: [{ ...draft.pets[0], name: "Bantay" }] })).toMatch(/11 digits starting with 09/);
    expect(draftProblem({ ...draft, owner: "Juana", pets: [{ ...draft.pets[0], name: "Bantay", processes: [] }] })).toMatch(/service/);
    expect(draftProblem({ ...draft, owner: "Juana", pets: [{ ...draft.pets[0], name: "Bantay" }] })).toBeNull();
  });

  it("becomes an issue change with the owner's barangay; a resend after it went through is done", () => {
    const change = issueStub({ id: 12 }, 4, { owner: "  Juana   Cruz ", mobile: "0917-123-4567", address: "Purok 2", pets: [{ name: "Bantay ", species: "Dog", sex: "Male", processes: ["Neuter/Spay"] }, { name: "", species: "Cat", sex: "", processes: [] }] });
    expect(change.body).toEqual({ action: "issue", stubId: 12, owner: { name: "Juana Cruz", mobile: "0917-123-4567", address: "Purok 2", barangayId: 4 }, pets: [{ name: "Bantay", species: "Dog", sex: "Male", processes: ["Neuter/Spay"] }] });
    expect(change.doneIfCodes).toEqual(["STUB_ALREADY_ISSUED"]);
  });

  it("finds a stub by number, owner, pet or mobile", () => {
    const s = { id: 105, owner: { name: "Juana Cruz", mobile: "0917-123-4567" }, pets: [{ name: "Bantay" }] };
    expect(["10", "105", "juana", "bant", "1234567", ""].map((q) => stubMatches(q, s))).toEqual([true, true, true, true, true, true]);
    expect(["106", "pedro"].map((q) => stubMatches(q, s))).toEqual([false, false]);
  });

  it("prints only with requested or encoded owners", () => {
    const sheet = (requestedOwners: number | undefined, status: string) => ({ requestedOwners, stubs: [{ status }] }) as unknown as StubSheet;
    expect(canPrint(sheet(0, "Available"))).toBe(false);
    expect(canPrint(sheet(2, "Available"))).toBe(true);
    expect(canPrint(sheet(0, "Issued"))).toBe(true);
    expect(canPrint(sheet(undefined, "Available"))).toBe(true);
  });
});

describe("attendanceRoster", () => {
  it("marks encoded stubs present once scanned, waiting during the day, absent after it", () => {
    const day = pack([stub({ id: 1 }), stub({ id: 2, code: code(2), status: "Redeemed" }), stub({ id: 3, code: code(3) }), stub({ id: 4, code: code(4), status: "Available", owner: null, pets: [] })]);
    const states = (today: string) => attendanceRoster(day, new Set([3]), today).map((e) => [e.stub.id, e.state]);
    expect(states("2026-11-05")).toEqual([[1, "waiting"], [2, "present"], [3, "present"]]);
    expect(states("2026-11-06")).toEqual([[1, "absent"], [2, "present"], [3, "present"]]);
  });
});
