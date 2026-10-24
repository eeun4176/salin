/**
 * City Vet Features
 * What a paravet reaches in e-Kapon from Salin, besides programs: the inbox
 * of City Vet notices, a search of the City Vet records they may see (their
 * barangay's owners, pets, stubs, attendance), the data-quality flags City
 * Vet raised on those records, and issue reports to City Vet. A typed
 * request ("give me the records of Juan Cruz") becomes a search term here,
 * by rule, not by AI; search results, and the program records saved on this
 * phone, can become a dataset that AI Studio answers questions about offline.
 */

import { z } from "zod";

import { adminRequest } from "@/core/admin/admin-api";
import { PROCESS_LABEL, requestCacheKey, STATUS_LABEL, type Process, type RequestDetail } from "@/core/programs/program-requests";
import { dayCachePrefix, stubsCacheKey, type Attendance, type DayPack, type StubSheet } from "@/core/programs/stubs";
import { db } from "@/core/storage/database";
import type { CellValue, DatasetContent } from "@/types/processing";

const notice = z.object({ id: z.number(), kind: z.string(), title: z.string(), body: z.string(), link: z.string().nullable(), created_at: z.string(), read_at: z.string().nullable() });
export type Notice = z.infer<typeof notice>;

export const loadInbox = (token: string) => adminRequest("/notifications?view=all", { token, schema: z.object({ data: z.array(notice), unread: z.number() }) });
export const markNoticeRead = (token: string, id: number) => adminRequest("/notifications", { token, method: "PATCH", body: { action: "read", id }, schema: z.unknown() });

/** Where a notice's e-Kapon link leads in Salin, if anywhere. */
export function noticeLink(link: string | null) {
  if (!link) return null;
  if (link.startsWith("/stubs")) return "/programs?tab=stubs";
  if (link.startsWith("/program-interest") || link.startsWith("/programs")) return "/programs";
  return null;
}

const found = z.object({ key: z.string(), kind: z.string(), id: z.string(), label: z.string(), detail: z.string(), source: z.string(), status: z.string().nullish(), updatedAt: z.string() });
export type FoundRecord = z.infer<typeof found>;

export const searchCityVet = (token: string, term: string) => adminRequest(`/search?q=${encodeURIComponent(term)}`, { token, schema: z.object({ data: z.array(found), hasMore: z.boolean() }) });

// Request words around the name or code being looked for, in English and Filipino.
const FILLER = new Set(
  "give show find search look up get list display me us all the a an of for about on in with records record details detail information info data owner owners pet pets please pls hanapin ipakita hanap pakihanap pakita paki ang mga ng ni kay si sa na yung lahat".split(" "),
);

/** "Give me the records of Juan Cruz" → "juan cruz"; text that is all request words is kept as typed. */
export function searchTerm(request: string) {
  const words = request.toLowerCase().replace(/[?!.,:;"“”]/g, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter((word) => !FILLER.has(word)).join(" ");
  return kept.length >= 2 ? kept : request.trim();
}

const quality = z.object({
  counts: z.object({ duplicateOwners: z.number(), duplicatePets: z.number(), missingContact: z.number(), missingAge: z.number(), unlinkedPets: z.number(), checkedRecords: z.number() }),
  rows: z.array(z.object({ id: z.number(), recordId: z.string(), dataset: z.string(), label: z.string().nullable(), otherLabel: z.string().nullish(), barangay: z.string().nullable(), status: z.string().nullish() })),
  total: z.number(),
});
export type QualityReport = z.infer<typeof quality>;
export const QUALITY_ISSUES = [
  { id: "missing-contact", label: "Owners without a mobile number", count: "missingContact" },
  { id: "missing-age", label: "Pets without an age", count: "missingAge" },
  { id: "duplicate-owners", label: "Possible duplicate owners", count: "duplicateOwners" },
  { id: "duplicate-pets", label: "Possible duplicate pets", count: "duplicatePets" },
  { id: "unlinked-pets", label: "Pets without an owner", count: "unlinkedPets" },
] as const;
export type QualityIssue = (typeof QUALITY_ISSUES)[number]["id"];
export const loadQuality = (token: string, issue: QualityIssue) => adminRequest(`/data-quality?issue=${issue}&pageSize=50`, { token, schema: quality });

const issue = z.object({ id: z.number(), title: z.string(), description: z.string(), severity: z.string(), status: z.string(), resolution: z.string().nullable(), createdAt: z.string() });
export type IssueReport = z.infer<typeof issue>;
export const loadIssues = (token: string) => adminRequest("/issues?status=all&pageSize=50", { token, schema: z.object({ data: z.array(issue) }) }).then((reply) => reply.data);
export const reportIssue = (token: string, input: { title: string; description: string; severity: "low" | "normal" | "high" }) =>
  adminRequest("/issues", { token, method: "POST", body: input, schema: z.object({ id: z.number() }) });

/** A dataset with these text columns, one row per array. */
function table(names: string[], rows: CellValue[][]): DatasetContent {
  const columns = names.map((name, i) => ({ id: `c${i}`, name, type: "text" as const, required: false, sourceHeader: null }));
  return { columns, rows: rows.map((values) => ({ values: Object.fromEntries(values.map((v, i) => [`c${i}`, v])), source: null })) };
}

export const searchContent = (records: FoundRecord[]) =>
  table(["Record", "Name", "Details", "Source", "Status", "Updated", "Record ID"], records.map((r) => [r.kind, r.label, r.detail, r.source, r.status ?? "", r.updatedAt.slice(0, 10), r.id]));

const serviceNames = (processes: Process[]) => processes.map((p) => PROCESS_LABEL[p]).join(", ");

/**
 * The program records saved on this phone as one table, one row per pet or
 * stub: the barangay's request, the stubs City Vet sent, and attendance.
 */
export function programRecordsContent({ request, sheets, attendance }: { request: RequestDetail | null; sheets: StubSheet[]; attendance: { program: string; rows: Attendance[] }[] }): DatasetContent {
  const rows: CellValue[][] = [];
  for (const person of request?.people.filter((p) => p.status === "interested") ?? []) {
    for (const pet of person.pets.length ? person.pets : [null])
      rows.push(["Request", request!.campaign.reference, person.owner_name, person.mobile ?? "", pet?.name ?? "", pet?.species ?? "", pet ? serviceNames(pet.processes) : "", STATUS_LABEL[request!.campaign.status] ?? request!.campaign.status, ""]);
  }
  for (const sheet of sheets)
    for (const stub of sheet.stubs) rows.push(["Stub", `Stub ${stub.id}`, stub.ownerName ?? "", "", "", "", serviceNames(stub.services), stub.ownerConfirmedAt ? "Name confirmed" : stub.status, sheet.program.date]);
  for (const day of attendance)
    for (const a of day.rows.filter((r) => r.status !== "Voided"))
      for (const pet of a.pets) rows.push(["Attendance", day.program, a.owner.name, "", pet.name, "", "", a.source, a.attendedOn]);
  return table(["Record", "Reference", "Owner", "Mobile", "Pet", "Species", "Services", "Status", "Date"], rows);
}

/** The program records saved on this phone (request, stub sheets, each program's attendance), ready for `programRecordsContent`. */
export async function deviceProgramRecords(account: string) {
  const request = ((await db.settings.get(requestCacheKey(account)))?.value as { detail?: RequestDetail | null } | undefined)?.detail ?? null;
  const sheets = ((await db.settings.get(stubsCacheKey(account)))?.value as { data?: { sheets: StubSheet[] } } | undefined)?.data?.sheets ?? [];
  const days = (await db.settings.where("key").startsWith(dayCachePrefix(account)).toArray()).flatMap((entry) => {
    const day = (entry.value as { data?: { pack: DayPack; attendance: Attendance[] } }).data;
    return day ? [{ program: day.pack.program.title, rows: day.attendance }] : [];
  });
  return { request, sheets, attendance: days };
}
