import type { WorkspaceItem } from "./types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Tentative sample content so the shell can be exercised before Phase 2 storage. */
export function createSampleItems(now = Date.now()): WorkspaceItem[] {
  return [
    folder("f-census-1", "Census Form 1", now - 2 * HOUR),
    folder("f-census-2", "Census Form 2", now - 5 * HOUR),
    folder("f-pet-1", "Pet Registration 2026", now - 3 * DAY),
    folder("f-pet-2", "Pet Registration Archive", now - 12 * DAY),
    { ...file("d-census-5", "Census Form 5", "xlsx", 48_210, now - 40 * MINUTE), openedAt: now - 30 * MINUTE, isFavorite: true },
    { ...file("d-census-6", "Census Form 6", "pdf", 1_240_000, now - 3 * HOUR), openedAt: now - 2 * HOUR, isFavorite: true },
    { ...file("d-census-3", "Census Form 3", "xlsx", 39_800, now - DAY - 2 * HOUR), openedAt: now - DAY - HOUR },
    { ...file("d-census-4", "Census Form 4", "pdf", 980_000, now - DAY - 4 * HOUR), openedAt: now - DAY - 3 * HOUR },
    { ...file("d-vaccine", "Vaccination Log", "csv", 12_400, now - 9 * DAY), openedAt: now - 6 * DAY },
    { ...file("d-receipt", "Receipt Scan", "jpg", 1_200_000, now - 20 * DAY) },
    { ...file("d-old-census", "Census Draft (old)", "pdf", 640_000, now - 40 * DAY), deletedAt: now - 3 * HOUR },
    { ...file("d-pet-draft", "Pet Registration Draft", "xlsx", 22_000, now - 50 * DAY), deletedAt: now - 2 * DAY },
  ];
}

function folder(id: string, name: string, modifiedAt: number): WorkspaceItem {
  return { id, kind: "folder", name, modifiedAt, openedAt: null, isFavorite: false, deletedAt: null };
}

function file(id: string, name: string, fileType: WorkspaceItem["fileType"], size: number, modifiedAt: number): WorkspaceItem {
  return { id, kind: "file", name, fileType, size, modifiedAt, openedAt: null, isFavorite: false, deletedAt: null };
}
