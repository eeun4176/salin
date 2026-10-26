/**
 * Walk-in Sheet
 * Program-day walk-ins typed like a spreadsheet: one row per pet, and a row
 * with the owner cell left blank belongs to the owner above (as on a paper
 * sheet). Turns the rows into one walk-in per owner, or says which row
 * needs fixing. Fully blank rows are ignored.
 */

import type { Process } from "@/core/programs/program-requests";
import type { AttendedPet } from "@/core/programs/stubs";
import { isMobile, MOBILE_HINT } from "@/core/programs/mobile";

export interface WalkInRow {
  owner: string;
  mobile: string;
  pet: string;
  species: "Dog" | "Cat";
  processes: Process[];
  served: boolean;
}

export interface WalkInOwner {
  name: string;
  mobile: string;
  pets: AttendedPet[];
}

export const MAX_WALK_IN_PETS = 10;


export const blankWalkInRow = (processes: Process[]): WalkInRow => ({ owner: "", mobile: "", pet: "", species: "Dog", processes: [...processes], served: true });

export function groupWalkIns(rows: WalkInRow[]): { owners: WalkInOwner[]; error: string | null } {
  const owners: WalkInOwner[] = [];
  for (const [index, row] of rows.entries()) {
    const at = `Row ${index + 1}`;
    const owner = row.owner.trim();
    const pet = row.pet.trim();
    const mobile = row.mobile.trim();
    if (!owner && !pet && !mobile) continue;
    if (!pet) return { owners: [], error: `${at}: enter the pet's name.` };
    if (!row.processes.length) return { owners: [], error: `${at}: choose at least one service.` };
    if (mobile && !isMobile(mobile)) return { owners: [], error: `${at}: enter the mobile number as ${MOBILE_HINT}, or leave it blank.` };
    let current = owners.at(-1);
    if (owner) {
      current = { name: owner, mobile: "", pets: [] };
      owners.push(current);
    } else if (!current) return { owners: [], error: `${at}: enter the owner's name.` };
    if (current.pets.length >= MAX_WALK_IN_PETS) return { owners: [], error: `${at}: one owner can bring at most ${MAX_WALK_IN_PETS} pets.` };
    if (mobile && !current.mobile) current.mobile = mobile;
    current.pets.push({ name: pet, species: row.species, processes: row.processes, served: row.served });
  }
  return { owners, error: owners.length ? null : "Add at least one owner and pet." };
}
