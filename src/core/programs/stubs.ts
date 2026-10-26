/**
 * Program Stubs and Program Day
 * The printed stubs City Vet gives a barangay, and the program day they are
 * used on. City Vet sends the barangay blank, numbered stubs; printing needs
 * owners on the barangay's request (or stubs already encoded). A paravet
 * hands a stub to an owner, then encodes the owner and pets against its
 * number (`issue`). Each QR holds a random code that belongs to exactly one
 * stub number. On the day, Salin downloads every stub of the program first
 * (the "day pack"), so scanning works with no signal; each scan or walk-in is
 * queued in the outbox. Encoded stubs never scanned are absent once the day is
 * over. Scanning only counts on the program date.
 */

import { z } from "zod";

import { adminRequest } from "@/core/admin/admin-api";
import { PROCESSES, type Process } from "@/core/programs/program-requests";
import { newRequestId, type NewOutboxItem } from "@/core/sync/outbox";
import { isMobile, MOBILE_HINT } from "@/core/programs/mobile";

/** Where stub sheets and each program's day pack are kept on the device (settings table). */
export const stubsCacheKey = (account: string) => `stubs:${account}`;
export const dayCachePrefix = (account: string) => `programday:${account}:`;
export const dayCacheKey = (account: string, campaignId: number) => `${dayCachePrefix(account)}${campaignId}`;

/** A stub's QR holds only this random code; the details are looked up. */
export const STUB_CODE = /^CVS1\.[A-Za-z0-9_-]{22}$/;

const program = z.object({
  id: z.number(),
  title: z.string(),
  date: z.string(),
  location: z.string(),
  hostBarangayId: z.number(),
  hostBarangay: z.string(),
  allowedBarangays: z.array(z.object({ id: z.number(), name: z.string() })),
  status: z.string(),
  processes: z.array(z.enum(PROCESSES)),
  startTime: z.string().nullish(),
  endTime: z.string().nullish(),
});
export type StubProgram = z.infer<typeof program>;

const batch = z.object({
  id: z.number(),
  reference: z.string(),
  campaignId: z.number(),
  barangay: z.string(),
  status: z.string(),
  approvedQuantity: z.number().nullable(),
  sentAt: z.string().nullish(),
});
export type StubBatch = z.infer<typeof batch>;

const owner = z.object({ registryOwnerId: z.string().optional(), name: z.string(), mobile: z.string().default(""), address: z.string().default(""), barangayId: z.number() });
export type StubOwner = z.infer<typeof owner>;

const pet = z.object({ name: z.string(), species: z.enum(["Dog", "Cat"]), sex: z.enum(["Male", "Female"]).optional(), ageMonths: z.number().optional(), processes: z.array(z.enum(PROCESSES)) });
export type StubPet = z.infer<typeof pet>;

const printStub = z.object({
  id: z.number(),
  code: z.string(),
  ownerName: z.string().nullish(),
  status: z.string(),
  services: z.array(z.enum(PROCESSES)).default([]),
  ownerConfirmedAt: z.string().nullish(),
});
export type PrintStub = z.infer<typeof printStub>;

/** requestedOwners: owners on the barangay's request; a sheet with none, and no encoded stubs, can't be printed. */
const printReply = z.object({ batch, program, stubs: z.array(printStub), requestedOwners: z.number().optional() });
export type StubSheet = z.infer<typeof printReply>;

// batchId (newer e-Kapon) places an encoded stub on its sheet in the Stubs tab.
const packStub = z.object({ id: z.number(), batchId: z.number().optional(), code: z.string(), status: z.enum(["Available", "Issued", "Redeemed", "Cancelled"]), owner: owner.nullable(), pets: z.array(pet).nullable().transform((pets) => pets ?? []), redeemedAt: z.string().nullable(), barangayId: z.number() });
export type PackStub = z.infer<typeof packStub>;

const dayPack = z.object({ program, generatedAt: z.string(), stubs: z.array(packStub) });
export type DayPack = z.infer<typeof dayPack>;

const attendance = z.object({ id: z.number(), source: z.enum(["Stub", "Walk-in"]), stubId: z.number().nullable(), owner: z.object({ name: z.string() }), pets: z.array(z.object({ name: z.string() })), attendedOn: z.string(), status: z.string() });
export type Attendance = z.infer<typeof attendance>;

const overview = z.object({ programs: z.array(program), batches: z.array(batch) });

export const loadStubOverview = (token: string) => adminRequest("/stub-workflow?pageSize=100", { token, schema: overview });
export const loadStubSheet = (token: string, batchId: number) => adminRequest(`/stub-workflow?mode=print&batchId=${batchId}`, { token, schema: printReply });
export const loadDayPack = (token: string, campaignId: number) => adminRequest(`/stub-workflow?mode=day-pack&campaignId=${campaignId}`, { token, schema: dayPack });
export const loadAttendance = (token: string, campaignId: number) =>
  adminRequest(`/stub-workflow?mode=attendance&campaignId=${campaignId}&pageSize=100`, { token, schema: z.object({ data: z.array(attendance) }) }).then((reply) => reply.data);

/** Today in the Philippines, as YYYY-MM-DD (how e-Kapon dates the program day). */
export const todayManila = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export type ProgramDay = "before" | "today" | "over";
export const programDay = (program: Pick<StubProgram, "date">, today = todayManila()): ProgramDay => (today < program.date ? "before" : today === program.date ? "today" : "over");

/** "8:00 AM–12:00 PM", or "" when the program has no times. */
export function programTime(program: Pick<StubProgram, "startTime" | "endTime">) {
  const clock = (value?: string | null) => (value ? `${Number(value.slice(0, 2)) % 12 || 12}:${value.slice(3, 5)} ${Number(value.slice(0, 2)) < 12 ? "AM" : "PM"}` : "");
  return [clock(program.startTime), clock(program.endTime)].filter(Boolean).join("–");
}

export type ScanResult = { kind: "ok"; stub: PackStub } | { kind: "used"; stub: PackStub } | { kind: "unknown" } | { kind: "invalid" };

/**
 * What a scanned or typed code means on program day: one of this program's
 * stubs for the paravet's area, one already used (on the server, or scanned
 * on this phone and waiting to send), or not one of these stubs at all.
 */
export function findStub(pack: DayPack, code: string, usedStubIds: ReadonlySet<number>): ScanResult {
  const text = code.trim();
  if (!STUB_CODE.test(text)) return { kind: "invalid" };
  const stub = pack.stubs.find((s) => s.code === text);
  if (!stub || stub.status === "Cancelled") return { kind: "unknown" };
  return stub.status === "Redeemed" || usedStubIds.has(stub.id) ? { kind: "used", stub } : { kind: "ok", stub };
}

type Change = Omit<NewOutboxItem, "account">;

export const markPrinted = (sheet: StubSheet): Change => ({ path: "/stub-workflow", label: `Printed stubs ${sheet.batch.reference}`, body: { action: "confirm-print", batchId: sheet.batch.id } });

/** Printing needs owners: someone on the barangay's request, or a stub already encoded. An older server that doesn't say is trusted. */
export const canPrint = (sheet: StubSheet) => sheet.requestedOwners === undefined || sheet.requestedOwners > 0 || sheet.stubs.some((stub) => stub.status !== "Available");

/** One blank stub being encoded after it was handed to an owner: the owner and up to three pets. */
export interface StubDraft {
  owner: string;
  mobile: string;
  address: string;
  pets: { name: string; species: "Dog" | "Cat"; sex: "" | "Male" | "Female"; processes: Process[] }[];
}
export const MAX_STUB_PETS = 3;

export const emptyDraft = (processes: Process[]): StubDraft => ({ owner: "", mobile: "", address: "", pets: [{ name: "", species: "Dog", sex: "", processes: [...processes] }] });

/** True when nothing was typed for the stub (it stays blank and isn't sent). */
export const draftIsBlank = (draft: StubDraft) => !draft.owner.trim() && !draft.mobile.trim() && !draft.address.trim() && draft.pets.every((p) => !p.name.trim());

/** What's wrong with a filled-in stub, in words, or null when it can be sent. */
export function draftProblem(draft: StubDraft): string | null {
  const pets = draft.pets.filter((p) => p.name.trim());
  if (!draft.owner.trim()) return "type the owner's name";
  if (draft.mobile.trim() && !isMobile(draft.mobile)) return `write the mobile as ${MOBILE_HINT}, or leave it blank`;
  if (!pets.length) return "add at least one pet";
  if (pets.length > MAX_STUB_PETS) return `one stub holds up to ${MAX_STUB_PETS} pets`;
  if (pets.some((p) => !p.processes.length)) return "choose at least one service for each pet";
  return null;
}

/**
 * A blank stub encoded after it was handed over (`issue`): the owner and pets
 * are recorded on the stub, so on program day its QR finds them. A resend
 * after it went through finds the stub already issued: that is done too.
 */
export function issueStub(stub: Pick<PrintStub, "id">, barangayId: number, draft: StubDraft): Change {
  const name = draft.owner.trim().replace(/\s+/g, " ");
  return {
    path: "/stub-workflow",
    label: `Stub ${stub.id} · ${name}`,
    body: {
      action: "issue",
      stubId: stub.id,
      owner: { name, mobile: draft.mobile.trim(), address: draft.address.trim(), barangayId },
      pets: draft.pets.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), species: p.species, ...(p.sex ? { sex: p.sex } : {}), processes: p.processes })),
    },
    doneIfCodes: ["STUB_ALREADY_ISSUED"],
  };
}

/** Search across stubs: a number finds that stub; words find owner names, pet names and mobile numbers. */
export function stubMatches(query: string, stub: { id: number; owner?: { name: string; mobile?: string } | null; pets?: { name: string }[] }) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  if (/^\d+$/.test(text)) return String(stub.id).startsWith(text) || (stub.owner?.mobile ?? "").replace(/\D/g, "").includes(text);
  return [stub.owner?.name ?? "", ...(stub.pets ?? []).map((p) => p.name)].some((name) => name.toLowerCase().includes(text));
}

export type RosterEntry = { stub: PackStub; state: "present" | "waiting" | "absent" };

/**
 * Everyone holding an encoded stub for the program: present once its QR was
 * scanned (sent, or saved on this phone), else waiting during the day and
 * absent once the program day is over.
 */
export function attendanceRoster(pack: DayPack, scanned: ReadonlySet<number>, today = todayManila()): RosterEntry[] {
  const over = programDay(pack.program, today) === "over";
  return pack.stubs
    .filter((stub) => stub.status === "Issued" || stub.status === "Redeemed")
    .map((stub): RosterEntry => ({ stub, state: stub.status === "Redeemed" || scanned.has(stub.id) ? "present" : over ? "absent" : "waiting" }));
}

export interface AttendedPet {
  name: string;
  species: "Dog" | "Cat";
  sex?: "Male" | "Female";
  processes: Process[];
  /** False when the pet came but wasn't served (recorded as deferred). */
  served: boolean;
}

const attendedPets = (pets: AttendedPet[]) =>
  pets.filter((p) => p.name.trim() && p.processes.length).map(({ served, ...p }) => ({ ...p, name: p.name.trim(), outcome: served ? "Completed" : "Deferred" }));

/** A stub used at the program: the issued owner, or for a blank stub the owner the paravet encoded. */
export function redeemStub(stub: PackStub, owner: StubOwner, pets: AttendedPet[], attendedOn = todayManila()): Change {
  const id = newRequestId();
  return { id, path: "/stub-workflow", label: `Stub of ${owner.name}`, body: { action: "redeem", stubId: stub.id, requestId: id, attendedOn, owner, pets: attendedPets(pets) } };
}

export function walkIn(programId: number, owner: StubOwner, pets: AttendedPet[], attendedOn = todayManila()): Change {
  const id = newRequestId();
  return { id, path: "/stub-workflow", label: `Walk-in ${owner.name}`, body: { action: "walk-in", campaignId: programId, requestId: id, attendedOn, owner, pets: attendedPets(pets) } };
}

/** The program to open on: today's, else the next one, else the latest that has passed. */
export function pickProgram<T extends Pick<StubProgram, "date">>(programs: T[], today = todayManila()): T | null {
  const byDate = [...programs].sort((a, b) => a.date.localeCompare(b.date));
  return byDate.find((p) => p.date >= today) ?? byDate.at(-1) ?? null;
}
