/**
 * Census Submission for City Vet
 * Turns a barangay's census records into e-Kapon's census submission (POST
 * /census/submissions), the same records the official workbook counts:
 * Validated pets only, grouped by owner (a continuation sheet's pets join
 * the sheet they continue), with the sheet's tick boxes mapped onto
 * e-Kapon's fields — "Unknown" is sent as unknown, never as No. A census
 * bigger than one submission may hold (200 owners or 1,000 pets) is split
 * into parts. Each part becomes an outbox change whose id is its request
 * id, so a resend after a dropped reply isn't counted twice.
 */

import { byOwner, COLUMN } from "@/core/census/census-records";
import type { CensusRecord } from "@/core/census/summary-workbook";
import { newRequestId, type NewOutboxItem } from "@/core/sync/outbox";

const MAX_OWNERS = 200;
const MAX_PETS = 1000;

export interface SubmissionPet {
  petName: string;
  species: string;
  sex: string;
  ageMonths?: number;
  breedType?: "Mongrel" | "Mix" | "Pure";
  color?: string;
  sterilized: boolean | null;
  confinement?: "Confined" | "Semi-confined" | "Free-roaming";
  vaccine1st: boolean | null;
  vaccine2nd: boolean | null;
  vaccine3rd: boolean | null;
  booster: boolean | null;
  vaccineOther?: string;
  laps: boolean | null;
  registeredYear?: number;
  remarks?: string;
}

export interface SubmissionOwner {
  ownerName: string;
  address: string;
  contact?: string;
  pets: SubmissionPet[];
}

export interface CensusSubmission {
  label: string;
  /** ISO date. */
  censusDate: string;
  source: "form";
  householdsVisited: number;
  owners: SubmissionOwner[];
}

export interface CensusSendPlan {
  parts: CensusSubmission[];
  owners: number;
  pets: number;
  /** Pending or Unreadable pets, not sent. */
  held: number;
  /** Owners with no address on the sheet: their barangay is sent instead. */
  noAddress: number;
  /** Contact numbers that aren't PH mobile numbers, left out (e-Kapon accepts only those). */
  droppedContacts: number;
}

const text = (r: CensusRecord, column: string) => String(r[column] ?? "").trim();
const answer = (r: CensusRecord, column: string) => text(r, column).toLowerCase();
const optional = (value: string) => value || undefined;

function yesNo(r: CensusRecord, column: string) {
  const value = answer(r, column);
  return value === "yes" ? true : value === "no" ? false : null;
}

const BREED: Record<string, SubmissionPet["breedType"]> = { "mongrel mix": "Mongrel", mix: "Mix", pure: "Pure" };
const CONFINEMENT: Record<string, SubmissionPet["confinement"]> = { confined: "Confined", "semi-confined": "Semi-confined", "free roaming": "Free-roaming" };

/** 0917 123 4567, +63 917…, 917… → 0917-123-4567; anything else → undefined. */
export function mobileNumber(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^63(?=9\d{9}$)/, "0").replace(/^(?=9\d{9}$)/, "0");
  return /^09\d{9}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}` : undefined;
}

function pet(r: CensusRecord): SubmissionPet {
  const years = text(r, "Age (years)");
  const months = text(r, "Age (months)");
  const ageMonths = years || months ? (Number(years) || 0) * 12 + (Number(months) || 0) : undefined;
  // "None" is no vaccine (all No); blank or "Unknown" stays unknown.
  const vaccination = answer(r, "Vaccination status");
  const known = vaccination !== "" && vaccination !== "unknown";
  const dose = (value: string) => (known ? vaccination === value : null);
  const registered = text(r, "Registered in");
  const registeredYear = /^\d{4}$/.test(registered) ? Number(registered) : undefined;
  return {
    petName: text(r, "Name of pet") || "(no name)",
    species: text(r, "Type of pet"),
    sex: text(r, "Sex"),
    ageMonths: ageMonths !== undefined && ageMonths <= 600 ? ageMonths : undefined,
    breedType: BREED[answer(r, "Breed")],
    color: optional(text(r, "Color")),
    sterilized: yesNo(r, "Sterilized"),
    confinement: CONFINEMENT[answer(r, "Classification")],
    vaccine1st: dose("1st"),
    vaccine2nd: dose("2nd"),
    vaccine3rd: dose("3rd"),
    booster: dose("booster"),
    vaccineOther: optional(text(r, "Other vaccines")),
    laps: yesNo(r, "Laps"),
    registeredYear,
    // "Before 2019" or "Not registered" has no year field in e-Kapon: kept in the remarks.
    remarks: optional([text(r, "Remarks"), registered && !registeredYear && `Registered in: ${registered}`].filter(Boolean).join("; ")),
  };
}

/** What "Send to City Vet" sends for one barangay's census: its Validated records as one or more submissions. */
export function planCensusSubmission({ name, barangay, censusDate }: { name: string; barangay: string; censusDate: string }, records: CensusRecord[]): CensusSendPlan {
  const validated = records.filter((r) => r[COLUMN.status] === "Validated");
  let noAddress = 0;
  let droppedContacts = 0;
  const owners = byOwner(validated).map((pets): SubmissionOwner => {
    const first = pets[0];
    const address = text(first, "Complete address");
    const written = text(first, "Contact number");
    const contact = mobileNumber(written);
    if (!address) noAddress++;
    if (written && !contact) droppedContacts++;
    return { ownerName: text(first, COLUMN.owner), address: address || barangay, contact, pets: pets.map(pet) };
  });

  const groups: SubmissionOwner[][] = [];
  let petsInGroup = 0;
  for (const owner of owners) {
    const last = groups.at(-1);
    if (!last || last.length === MAX_OWNERS || petsInGroup + owner.pets.length > MAX_PETS) {
      groups.push([owner]);
      petsInGroup = owner.pets.length;
    } else {
      last.push(owner);
      petsInGroup += owner.pets.length;
    }
  }
  const parts = groups.map((group, i) => ({
    label: groups.length > 1 ? `${name} (part ${i + 1} of ${groups.length})` : name,
    censusDate,
    source: "form" as const,
    householdsVisited: group.length,
    owners: group,
  }));
  return { parts, owners: owners.length, pets: validated.length, held: records.length - validated.length, noAddress, droppedContacts };
}

/** The plan's parts as outbox changes, each carrying its own request id. */
export function censusChanges(plan: CensusSendPlan): Omit<NewOutboxItem, "account">[] {
  return plan.parts.map((part) => {
    const id = newRequestId();
    return { id, path: "/census/submissions", label: `Send ${part.label}`, body: { ...part, requestId: id } };
  });
}
