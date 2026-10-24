/**
 * Program Requests
 * A barangay's request for City Vet programs (Kapon, anti-rabies vaccine,
 * microchipping), shared by the 2–3 paravets assigned there and kept by the
 * City Veterinary Office's e-Kapon system. This file reads it (`GET
 * /program-interest`), finds the barangay's current request (only one may
 * be active until it finishes, a merged one included), and turns paravet
 * edits — add, edit or remove an owner, start, send — into outbox changes,
 * so they work offline and are sent when there is signal.
 */

import { z } from "zod";

import { adminRequest } from "@/core/admin/admin-api";
import { newRequestId, type NewOutboxItem } from "@/core/sync/outbox";

export const PROCESSES = ["Neuter/Spay", "Anti-Rabies Vaccine", "Microchipping"] as const;
export type Process = (typeof PROCESSES)[number];
/** What paravets and owners call each service. */
export const PROCESS_LABEL: Record<Process, string> = { "Neuter/Spay": "Kapon", "Anti-Rabies Vaccine": "Anti-rabies", Microchipping: "Microchip" };

export type RequestStatus = "gathering" | "requested" | "approved" | "rejected" | "scheduled" | "closed" | "cancelled" | "merged";
export const STATUS_LABEL: Record<RequestStatus, string> = {
  gathering: "Gathering",
  requested: "Sent to City Vet",
  approved: "Approved",
  rejected: "Not approved",
  scheduled: "Scheduled",
  closed: "Finished",
  cancelled: "Cancelled",
  merged: "Merged",
};
/** What happens next, for the paravet: shown under the status. */
export const STATUS_HINT: Partial<Record<RequestStatus, string>> = {
  gathering: "Add owners, then send the list to City Vet.",
  requested: "City Vet is reviewing your list.",
  approved: "Approved. City Vet will set the program date and send your stubs.",
  scheduled: "Scheduled. Your stubs appear under Stubs once City Vet sends them.",
  closed: "The program has finished.",
  rejected: "City Vet didn't approve this request.",
  cancelled: "This request was cancelled.",
};
const ACTIVE: RequestStatus[] = ["gathering", "requested", "approved", "scheduled", "merged"];

const pet = z.object({
  name: z.string(),
  species: z.enum(["Dog", "Cat"]),
  sex: z.enum(["Male", "Female"]).nullish(),
  ageMonths: z.number().nullish(),
  processes: z.array(z.enum(PROCESSES)),
});
export type RequestPet = z.infer<typeof pet>;

const campaign = z.object({
  id: z.number(),
  revision: z.number(),
  reference: z.string(),
  kind: z.string(),
  hostBarangayId: z.number(),
  hostBarangay: z.string(),
  status: z.string() as z.ZodType<RequestStatus>,
  requestedTargetPeople: z.number(),
  targetPeople: z.number(),
  processes: z.array(z.enum(PROCESSES)),
  ownerCount: z.number(),
  petCount: z.number(),
  requestNote: z.string().nullish(),
  reviewNote: z.string().nullish(),
  programTitle: z.string().nullish(),
  programDate: z.string().nullish(),
  allowedBarangays: z.array(z.object({ id: z.number(), name: z.string() })),
  createdByName: z.string().nullish(),
  submittedByName: z.string().nullish(),
  lastEditedBy: z.string().nullish(),
  lastEditedAt: z.string().nullish(),
  mergedIntoId: z.number().nullish(),
  mergedInto: z.object({ reference: z.string(), hostBarangay: z.string() }).nullish(),
});
export type ProgramRequest = z.infer<typeof campaign>;

const person = z.object({
  id: z.number(),
  owner_name: z.string(),
  mobile: z.string().nullable(),
  residence_barangay_id: z.number(),
  residence_barangay: z.string(),
  pets: z.array(pet),
  status: z.string(),
  updated_at: z.string(),
  added_by_name: z.string().nullish(),
  updated_by_name: z.string().nullish(),
});
export type RequestOwner = z.infer<typeof person>;

export const listReply = z.object({ campaigns: z.array(campaign), role: z.string(), assignedBarangayId: z.number().nullable() });
export const detailReply = z.object({
  campaign,
  people: z.array(person),
  activity: z.array(z.object({ id: z.number(), actorName: z.string(), action: z.string(), createdAt: z.string() })),
});
export type RequestDetail = z.infer<typeof detailReply>;

/** Where the barangay's request is kept on the device (settings table), so it opens offline. */
export const requestCacheKey = (account: string) => `programs:${account}`;

export const loadRequests = (token: string) => adminRequest("/program-interest", { token, schema: listReply });
export const loadRequest = (token: string, id: number) => adminRequest(`/program-interest?id=${id}`, { token, schema: detailReply });

/** The request the paravet works on now: their barangay's active one, or — once merged — the one it joined. */
export function currentRequest(requests: ProgramRequest[], barangayId: number | null): ProgramRequest | null {
  const own = requests.find((request) => request.kind === "program_request" && request.hostBarangayId === barangayId && ACTIVE.includes(request.status));
  if (own?.status === "merged") return requests.find((request) => request.id === own.mergedIntoId) ?? own;
  return own ?? null;
}

/** The barangay's own request that was merged into `current`, if any (to say "merged into …"). */
export function mergedFrom(requests: ProgramRequest[], barangayId: number | null) {
  return requests.find((request) => request.kind === "program_request" && request.hostBarangayId === barangayId && request.status === "merged") ?? null;
}

export interface OwnerInput {
  ownerName: string;
  mobile: string;
  pets: { name: string; species: "Dog" | "Cat"; sex?: "Male" | "Female"; processes: Process[] }[];
}

type Change = Omit<NewOutboxItem, "account">;
const change = (label: string, body: Record<string, unknown>, extra: Partial<Change> = {}): Change => ({ path: "/program-interest", label, body, ...extra });

export const startRequest = (input: { targetPeople: number; processes: Process[]; note: string }): Change =>
  change("Start a program request", { action: "create-demand", targetPeople: input.targetPeople, processes: input.processes, note: input.note.trim() || undefined });

export function addOwner(request: ProgramRequest, barangayId: number, input: OwnerInput): Change {
  const id = newRequestId();
  return { id, ...change(`Add ${input.ownerName.trim()}`, { action: "add-interest", requestId: id, campaignId: request.id, residenceBarangayId: barangayId, ...cleanOwner(input) }) };
}

export const editOwner = (request: ProgramRequest, owner: RequestOwner, input: OwnerInput): Change =>
  change(`Edit ${input.ownerName.trim()}`, { action: "update-interest", campaignId: request.id, personId: owner.id, residenceBarangayId: owner.residence_barangay_id, expectedUpdatedAt: new Date(owner.updated_at).toISOString(), ...cleanOwner(input) });

// A resend after the first removal went through finds nothing to remove: that is done too.
export const removeOwner = (request: ProgramRequest, owner: RequestOwner): Change =>
  change(`Remove ${owner.owner_name}`, { action: "withdraw-interest", campaignId: request.id, personId: owner.id, expectedUpdatedAt: new Date(owner.updated_at).toISOString() }, { doneIfCodes: ["NOT_FOUND"] });

export const sendRequest = (request: ProgramRequest): Change =>
  change("Send the list to City Vet", { action: "submit-request", campaignId: request.id }, { doneIfCodes: ["REQUEST_NOT_OPEN"] });

/**
 * e-Kapon's own duplicate rule, run on the phone before saving: the same name
 * (any case) or the same mobile number among the owners still listed. The UI
 * asks before adding one; changes then go out as confirmed distinct.
 */
export function possibleDuplicates(owners: RequestOwner[], input: Pick<OwnerInput, "ownerName" | "mobile">, exceptId?: number) {
  const name = input.ownerName.trim().toLowerCase();
  const phone = input.mobile.replace(/\D/g, "");
  return owners.filter((owner) => owner.id !== exceptId && owner.status === "interested" && (owner.owner_name.trim().toLowerCase() === name || (phone !== "" && (owner.mobile ?? "").replace(/\D/g, "") === phone)));
}

function cleanOwner({ ownerName, mobile, pets }: OwnerInput) {
  return {
    ownerName: ownerName.trim(),
    mobile: mobile.trim(),
    pets: pets.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), species: p.species, ...(p.sex ? { sex: p.sex } : {}), processes: p.processes })),
    // Owners with the same name are confirmed distinct on the phone, where the duplicate check can't reach the server.
    confirmDistinct: true,
  };
}
