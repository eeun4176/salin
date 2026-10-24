/**
 * Owner Suggestions
 * Owners the paravet has met before, offered while typing a name so details
 * aren't typed twice: from census datasets on this phone, the barangay's
 * program request, and the program day's stubs. Typing "juan" matches any
 * name with a word starting with "juan"; picking one fills in the mobile
 * number and pets. Everything is read from the device, so it works offline.
 */

import { COLUMN } from "@/core/census/census-records";
import { requestCacheKey, type RequestDetail } from "@/core/programs/program-requests";
import { dayCachePrefix, type DayPack } from "@/core/programs/stubs";
import { db } from "@/core/storage/database";

export interface OwnerSuggestion {
  name: string;
  mobile: string;
  /** Where the paravet saw this owner, e.g. "Census" or "Request". */
  source: string;
  pets: { name: string; species: "Dog" | "Cat"; sex?: "Male" | "Female" }[];
}

const key = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const words = (name: string) => key(name).split(/[\s,.-]+/).filter(Boolean);

/** One entry per owner name: the first source's details, with every source's pets. */
export function mergeOwners(lists: OwnerSuggestion[][]): OwnerSuggestion[] {
  const byName = new Map<string, OwnerSuggestion>();
  for (const owner of lists.flat()) {
    if (!owner.name.trim()) continue;
    const seen = byName.get(key(owner.name));
    if (!seen) {
      byName.set(key(owner.name), { ...owner, pets: [...owner.pets] });
      continue;
    }
    seen.mobile ||= owner.mobile;
    for (const pet of owner.pets) if (!seen.pets.some((p) => key(p.name) === key(pet.name) && p.species === pet.species)) seen.pets.push(pet);
  }
  return [...byName.values()];
}

/** Owners whose name has a word starting with each typed word; names starting with the text come first. */
export function suggestOwners(owners: OwnerSuggestion[], typed: string, limit = 5): OwnerSuggestion[] {
  const wanted = words(typed);
  if (!wanted.length || key(typed).length < 2) return [];
  const text = key(typed);
  return owners
    .filter((owner) => key(owner.name) !== text && wanted.every((w) => words(owner.name).some((n) => n.startsWith(w))))
    .sort((a, b) => Number(key(b.name).startsWith(text)) - Number(key(a.name).startsWith(text)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const species = (value: unknown) => (/^cat$/i.test(String(value ?? "").trim()) ? "Cat" : /^dog$/i.test(String(value ?? "").trim()) ? "Dog" : null);
const sex = (value: unknown) => (/^male$/i.test(String(value ?? "").trim()) ? "Male" : /^female$/i.test(String(value ?? "").trim()) ? "Female" : undefined);

/** Census owners from the census datasets on this phone (one row per pet). */
export async function censusOwners(): Promise<OwnerSuggestion[]> {
  const datasets = (await db.datasets.toArray()).filter((d) => d.columns.some((c) => c.name === COLUMN.owner));
  const owners: OwnerSuggestion[] = [];
  for (const dataset of datasets) {
    const id = (name: string) => dataset.columns.find((c) => c.name === name)?.id ?? "";
    const [ownerId, contactId, petId, typeId, sexId] = [COLUMN.owner, "Contact number", COLUMN.pet, "Type of pet", "Sex"].map(id);
    for (const row of await db.datasetRows.where("datasetId").equals(dataset.id).toArray()) {
      const name = String(row.values[ownerId] ?? "").trim();
      const kind = species(row.values[typeId]);
      const petName = String(row.values[petId] ?? "").trim();
      owners.push({ name, mobile: String(row.values[contactId] ?? "").trim(), source: "Census", pets: kind && petName ? [{ name: petName, species: kind, sex: sex(row.values[sexId]) }] : [] });
    }
  }
  return mergeOwners([owners]);
}

/** Every owner this phone knows: census datasets, the saved program request, and saved day packs. */
export async function deviceOwners(account: string): Promise<OwnerSuggestion[]> {
  const request = (await db.settings.get(requestCacheKey(account)))?.value as { detail?: RequestDetail | null } | undefined;
  const packs = (await db.settings.where("key").startsWith(dayCachePrefix(account)).toArray()).map((entry) => (entry.value as { data?: { pack?: DayPack } }).data?.pack);
  const requested = (request?.detail?.people ?? []).map((p) => ({ name: p.owner_name, mobile: p.mobile ?? "", source: "Request", pets: p.pets.map(({ name, species, sex }) => ({ name, species, sex: sex ?? undefined })) }));
  const stubs = packs.flatMap((pack) => pack?.stubs ?? []).flatMap((s) => (s.owner ? [{ name: s.owner.name, mobile: s.owner.mobile, source: "Stub", pets: s.pets.map(({ name, species, sex }) => ({ name, species, sex })) }] : []));
  return mergeOwners([requested, stubs, await censusOwners()]);
}
