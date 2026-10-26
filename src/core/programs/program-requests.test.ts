/**
 * Program Request Tests
 * Which request a paravet works on (their barangay's, or the one it merged
 * into), the duplicate-owner rule, and the outbox changes edits become.
 */

import { describe, expect, it } from "vitest";

import { addOwner, currentRequest, editOwner, lastCompleted, mergedFrom, possibleDuplicates, removeOwner, sendRequest, type ProgramRequest, type RequestOwner } from "./program-requests";

const request = (extra: Partial<ProgramRequest>): ProgramRequest => ({
  id: 1, revision: 1, reference: "PI-2026-A", kind: "program_request", hostBarangayId: 4, hostBarangay: "Assumption", status: "gathering", requestedTargetPeople: 10, targetPeople: 10,
  processes: ["Neuter/Spay"], ownerCount: 0, petCount: 0, allowedBarangays: [{ id: 4, name: "Assumption" }], ...extra,
});
const owner = (extra: Partial<RequestOwner>): RequestOwner => ({
  id: 7, owner_name: "Juana Cruz", mobile: "0917-123-4567", residence_barangay_id: 4, residence_barangay: "Assumption", pets: [], status: "interested", updated_at: "2026-10-24T01:02:03.456Z", ...extra,
});

describe("currentRequest", () => {
  it("is the barangay's active request, skipping finished ones and other barangays", () => {
    const list = [request({ id: 1, status: "closed" }), request({ id: 2, hostBarangayId: 9 }), request({ id: 3, status: "requested" })];
    expect(currentRequest(list, 4)?.id).toBe(3);
    expect(currentRequest(list, 5)).toBeNull();
  });

  it("ends once the program is Completed, so a new request can start; an ongoing program still blocks it", () => {
    expect(currentRequest([request({ id: 3, status: "scheduled", programStatus: "In progress" })], 4)?.id).toBe(3);
    const done = [request({ id: 3, status: "scheduled", programStatus: "Completed", programTitle: "Kapon Day" })];
    expect(currentRequest(done, 4)).toBeNull();
    expect(lastCompleted(done, 4)?.programTitle).toBe("Kapon Day");
    const merged = [request({ id: 3, status: "merged", mergedIntoId: 8 }), request({ id: 8, hostBarangayId: 9, status: "scheduled", programStatus: "Completed" })];
    expect(currentRequest(merged, 4)).toBeNull();
    expect(lastCompleted(merged, 4)?.id).toBe(8);
  });

  it("follows a merged request to the one it joined", () => {
    const list = [request({ id: 3, status: "merged", mergedIntoId: 8 }), request({ id: 8, hostBarangayId: 9, hostBarangay: "Kaypian", status: "requested" })];
    expect(currentRequest(list, 4)?.id).toBe(8);
    expect(mergedFrom(list, 4)?.id).toBe(3);
  });
});

describe("owners", () => {
  it("flags the same name or mobile still listed, but not the owner being edited or withdrawn ones", () => {
    const listed = [owner({ id: 7 }), owner({ id: 8, owner_name: "Pedro", mobile: "09181112222" }), owner({ id: 9, owner_name: "Ana", status: "withdrawn" })];
    expect(possibleDuplicates(listed, { ownerName: " juana cruz ", mobile: "" }).map((o) => o.id)).toEqual([7]);
    expect(possibleDuplicates(listed, { ownerName: "Someone", mobile: "0918 111 2222" }).map((o) => o.id)).toEqual([8]);
    expect(possibleDuplicates(listed, { ownerName: "Juana Cruz", mobile: "" }, 7)).toEqual([]);
    expect(possibleDuplicates(listed, { ownerName: "Ana", mobile: "" })).toEqual([]);
  });

  it("become outbox changes the server can recognise if resent", () => {
    const add = addOwner(request({}), 4, { ownerName: " Juana Cruz ", mobile: "", pets: [{ name: "Bantay", species: "Dog", processes: ["Neuter/Spay"] }, { name: " ", species: "Cat", processes: [] }] });
    expect(add.body).toMatchObject({ action: "add-interest", requestId: add.id, campaignId: 1, residenceBarangayId: 4, ownerName: "Juana Cruz", pets: [{ name: "Bantay" }], confirmDistinct: true });
    expect(editOwner(request({}), owner({}), { ownerName: "Juana Cruz", mobile: "", pets: [] }).body).toMatchObject({ action: "update-interest", personId: 7, expectedUpdatedAt: "2026-10-24T01:02:03.456Z" });
    expect(removeOwner(request({}), owner({})).doneIfCodes).toEqual(["NOT_FOUND"]);
    expect(sendRequest(request({})).body).toEqual({ action: "submit-request", campaignId: 1 });
  });
});
