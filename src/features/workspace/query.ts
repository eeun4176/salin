import type { FileKind, WorkspaceItem, WorkspaceSection } from "./types";
import type { ModifiedFilter, SortState, TypeFilter } from "@/stores/ui-store";

const DAY = 24 * 60 * 60 * 1000;

const TYPE_GROUPS: Record<Exclude<TypeFilter, "any" | "folders">, FileKind[]> = {
  pdf: ["pdf"],
  spreadsheets: ["xlsx", "csv"],
  images: ["png", "jpg", "webp"],
};

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function matchesType(item: WorkspaceItem, type: TypeFilter) {
  if (type === "any") return true;
  if (type === "folders") return item.kind === "folder";
  return item.kind === "file" && !!item.fileType && TYPE_GROUPS[type].includes(item.fileType);
}

function matchesModified(item: WorkspaceItem, filter: ModifiedFilter, now: number) {
  const today = startOfDay(now);
  const t = item.modifiedAt;
  switch (filter) {
    case "any":
      return true;
    case "today":
      return t >= today;
    case "7d":
      return t >= today - 6 * DAY;
    case "30d":
      return t >= today - 29 * DAY;
    case "year":
      return new Date(t).getFullYear() === new Date(now).getFullYear();
    case "lastYear":
      return new Date(t).getFullYear() === new Date(now).getFullYear() - 1;
  }
}

/** The timestamp a section is ordered and grouped by. */
export function sectionTime(item: WorkspaceItem, section: WorkspaceSection) {
  if (section === "trash") return item.deletedAt ?? item.modifiedAt;
  if (section === "recents") return item.openedAt ?? item.modifiedAt;
  return item.modifiedAt;
}

export interface QueryOptions {
  section: WorkspaceSection;
  query: string;
  type: TypeFilter;
  modified: ModifiedFilter;
  sort: SortState;
  now?: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function selectItems(items: WorkspaceItem[], opts: QueryOptions) {
  const now = opts.now ?? Date.now();
  const q = opts.query.trim().toLowerCase();

  const visible = items.filter((item) => {
    const inTrash = item.deletedAt !== null;
    if (opts.section === "trash" ? !inTrash : inTrash) return false;
    if (opts.section === "favorites" && !item.isFavorite) return false;
    // Recents lists files the user touched, like Drive does.
    if (opts.section === "recents" && item.kind !== "file") return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return matchesType(item, opts.type) && matchesModified(item, opts.modified, now);
  });

  if (opts.section === "recents") {
    return visible.sort((a, b) => sectionTime(b, "recents") - sectionTime(a, "recents"));
  }

  const dir = opts.sort.direction === "asc" ? 1 : -1;
  return visible.sort((a, b) => {
    if (opts.sort.foldersFirst && a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    if (opts.sort.key === "name") return collator.compare(a.name, b.name) * dir;
    return (sectionTime(a, opts.section) - sectionTime(b, opts.section)) * dir;
  });
}

export function dayGroupLabel(ts: number, now = Date.now()) {
  const today = startOfDay(now);
  if (ts >= today) return "Today";
  if (ts >= today - DAY) return "Yesterday";
  if (ts >= today - 6 * DAY) return "Earlier this week";
  if (ts >= today - 29 * DAY) return "Earlier this month";
  return "Older";
}

/** Groups already-sorted items into consecutive day buckets. */
export function groupByDay(items: WorkspaceItem[], section: WorkspaceSection, now = Date.now()) {
  const groups: { label: string; items: WorkspaceItem[] }[] = [];
  for (const item of items) {
    const label = dayGroupLabel(sectionTime(item, section), now);
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(ts: number, now = Date.now()) {
  const sameDay = startOfDay(ts) === startOfDay(now);
  return new Intl.DateTimeFormat(
    undefined,
    sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" },
  ).format(ts);
}
