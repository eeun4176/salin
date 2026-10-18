/**
 * Sort Control
 * The "Name ≡" sorter: sort by name or date, A–Z / Z–A (or oldest/newest), and
 * folders on top or mixed with files.
 */

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SortState } from "@/stores/ui-store";

interface SortControlProps {
  sort: SortState;
  onChange: (sort: Partial<SortState>) => void;
  /** Label for the date key — "Date modified" or, in Trash, "Date trashed". */
  dateLabel: string;
}

/** "Name ≡" column sorter: field, direction and folder placement. */
export function SortControl({ sort, onChange, dateLabel }: SortControlProps) {
  const Icon = sort.direction === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;
  const byName = sort.key === "name";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="press -ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-salin-text outline-none hover:bg-salin-tile">
        {byName ? "Name" : dateLabel}
        <Icon className="size-4" strokeWidth={2.2} />
        <span className="sr-only">, change sorting</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-xl p-1.5">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort.key} onValueChange={(key) => onChange({ key: key as SortState["key"], direction: key === "name" ? "asc" : "desc" })}>
          <DropdownMenuRadioItem value="name" className="py-2">Name</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="modified" className="py-2">{dateLabel}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Order</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort.direction} onValueChange={(direction) => onChange({ direction: direction as SortState["direction"] })}>
          <DropdownMenuRadioItem value="asc" className="py-2">{byName ? "A to Z" : "Oldest first"}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc" className="py-2">{byName ? "Z to A" : "Newest first"}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Folders</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort.foldersFirst ? "top" : "mixed"} onValueChange={(v) => onChange({ foldersFirst: v === "top" })}>
          <DropdownMenuRadioItem value="top" className="py-2">On top</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="mixed" className="py-2">Mixed with files</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
