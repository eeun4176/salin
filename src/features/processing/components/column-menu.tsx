/**
 * Column Menu
 * The header button of each column in the review table. Opens a small menu
 * to rename the column, change its type (text, number, date, yes/no), mark it
 * required, or delete it — the whole column setup without a separate form.
 */

import { useState } from "react";
import { Calendar, ChevronDown, Hash, Pencil, ToggleLeft, Trash2, Type, type LucideIcon } from "lucide-react";

import { NameDialog } from "@/components/common/name-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MAX_COLUMN_NAME_LENGTH } from "@/core/processing/dataset-validator";
import type { ColumnType, DatasetColumn } from "@/types/processing";

const COLUMN_TYPES: { type: ColumnType; label: string; icon: LucideIcon }[] = [
  { type: "text", label: "Text", icon: Type },
  { type: "number", label: "Number", icon: Hash },
  { type: "date", label: "Date", icon: Calendar },
  { type: "boolean", label: "Yes / no", icon: ToggleLeft },
];

const TYPE_META = Object.fromEntries(COLUMN_TYPES.map((t) => [t.type, t])) as Record<ColumnType, (typeof COLUMN_TYPES)[number]>;

interface ColumnMenuProps {
  column: DatasetColumn;
  columns: DatasetColumn[];
  onRename: (name: string) => void;
  onTypeChange: (type: ColumnType) => void;
  onRequiredChange: (required: boolean) => void;
  onDelete: () => void;
}

export function ColumnMenu({ column, columns, onRename, onTypeChange, onRequiredChange, onDelete }: ColumnMenuProps) {
  const [renaming, setRenaming] = useState(false);
  const { icon: TypeIcon, label: typeLabel } = TYPE_META[column.type];

  const validate = (raw: string) => {
    const name = raw.trim();
    if (name.length > MAX_COLUMN_NAME_LENGTH) return `Keep column names under ${MAX_COLUMN_NAME_LENGTH} characters.`;
    const clash = columns.some((c) => c.id !== column.id && c.name.toLowerCase() === name.toLowerCase());
    return clash ? `There's already a column named "${name}".` : null;
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`${column.name} column (${typeLabel}${column.required ? ", required" : ""})`}
          className="flex h-10 w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-[13px] font-semibold text-salin-text outline-none hover:bg-salin-tile-hover focus-visible:ring-2 focus-visible:ring-salin-primary data-[state=open]:bg-salin-tile-hover"
        >
          <TypeIcon aria-hidden="true" className="size-3.5 shrink-0 text-salin-subtle" />
          <span className="min-w-0 flex-1 truncate" title={column.sourceHeader && column.sourceHeader !== column.name ? `From "${column.sourceHeader}"` : undefined}>
            {column.name}
            {column.required && <span className="ml-0.5 text-destructive">*</span>}
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-salin-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 rounded-xl p-1.5">
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => setRenaming(true)}>
            <Pencil /> Rename…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-salin-muted">Type</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={column.type} onValueChange={(value) => onTypeChange(value as ColumnType)}>
            {COLUMN_TYPES.map(({ type, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={type} value={type} className="gap-2.5 py-2">
                <Icon className="text-salin-subtle" /> {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem className="py-2" checked={column.required} onCheckedChange={(checked) => onRequiredChange(checked === true)}>
            Required
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="gap-2.5 py-2" disabled={columns.length <= 1} onSelect={onDelete}>
            <Trash2 /> Delete column
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename column"
        initialValue={column.name}
        confirmLabel="Rename"
        validate={validate}
        onSubmit={(name) => onRename(name.trim())}
      />
    </>
  );
}
