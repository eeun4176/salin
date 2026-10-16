import { useState } from "react";
import { ChevronDown, FileUp, FolderPlus, FolderUp, LayoutGrid, List, Trash } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NameDialog } from "@/components/common/name-dialog";
import { useFilePicker, useUploadToImport } from "@/features/import/use-file-picker";
import type { WorkspaceSection } from "@/features/workspace/types";
import { useUiStore, type ModifiedFilter, type TypeFilter, type ViewMode } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

const SECTION_TITLES: Record<WorkspaceSection, string> = {
  workspace: "Workspace",
  recents: "Recents",
  favorites: "Favorites",
  trash: "Trash",
};

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "any", label: "Any type" },
  { value: "folders", label: "Folders" },
  { value: "pdf", label: "PDFs" },
  { value: "spreadsheets", label: "Spreadsheets (XLSX, CSV)" },
  { value: "images", label: "Images (PNG, JPG, WebP)" },
];

const MODIFIED_OPTIONS: { value: ModifiedFilter; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "year", label: `This year (${new Date().getFullYear()})` },
  { value: "lastYear", label: `Last year (${new Date().getFullYear() - 1})` },
];

const SHORT_LABELS: Partial<Record<TypeFilter | ModifiedFilter, string>> = {
  spreadsheets: "Spreadsheets",
  images: "Images",
  year: "This year",
  lastYear: "Last year",
};

function chipLabel<T extends TypeFilter | ModifiedFilter>(value: T, options: { value: T; label: string }[], fallback: string) {
  if (value === "any") return fallback;
  return SHORT_LABELS[value] ?? options.find((o) => o.value === value)?.label ?? fallback;
}

function FilterChip<T extends string>({
  label,
  active,
  value,
  options,
  onChange,
  heading,
}: {
  label: string;
  active: boolean;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  heading: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          "press inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium outline-none",
          active
            ? "border-salin-primary bg-salin-primary-soft text-[#016A39]"
            : "border-[#C9D1CC] bg-white text-salin-text hover:bg-salin-tile",
        )}
      >
        {label}
        <ChevronDown className="size-3.5" strokeWidth={2.4} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 rounded-xl p-1.5">
        <DropdownMenuLabel>{heading}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="py-2">
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Workspace ˅" title menu: create folder / upload files / upload a folder (or empty trash). */
function SectionMenu({ section }: { section: WorkspaceSection }) {
  const [creating, setCreating] = useState(false);
  const createFolder = useWorkspaceStore((s) => s.createFolder);
  const emptyTrash = useWorkspaceStore((s) => s.emptyTrash);
  const trashCount = useWorkspaceStore((s) => s.items.filter((i) => i.deletedAt !== null).length);
  const upload = useUploadToImport();
  const { inputs, pickFiles, pickFolder } = useFilePicker(upload);

  return (
    <>
      {inputs}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="press -ml-1.5 inline-flex h-10 items-center gap-1.5 rounded-xl px-1.5 text-[22px] font-semibold tracking-[-0.02em] text-salin-text outline-none hover:bg-salin-tile md:text-2xl">
          {SECTION_TITLES[section]}
          <ChevronDown className="size-5" strokeWidth={2.2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 rounded-xl p-1.5">
          {section === "trash" ? (
            <DropdownMenuItem
              variant="destructive"
              disabled={trashCount === 0}
              className="gap-2.5 py-2"
              onSelect={() => {
                emptyTrash();
                toast("Trash emptied.");
              }}
            >
              <Trash /> Empty trash
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => setCreating(true)}>
                <FolderPlus /> New Folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={pickFiles}>
                <FileUp /> Upload a File
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={pickFolder}>
                <FolderUp /> Upload a Folder
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New folder"
        initialValue="Untitled folder"
        confirmLabel="Create"
        onSubmit={(name) => {
          createFolder(name);
          setCreating(false);
          toast(`Folder “${name}” created.`);
        }}
      />
    </>
  );
}

function ViewToggle() {
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const options: { value: ViewMode; label: string; icon: typeof List }[] = [
    { value: "list", label: "List view", icon: List },
    { value: "grid", label: "Grid view", icon: LayoutGrid },
  ];

  return (
    <div role="radiogroup" aria-label="Layout" className="flex rounded-xl bg-salin-tile p-1">
      {options.map(({ value, label, icon: Icon }) => {
        const selected = viewMode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setViewMode(value)}
            className={cn(
              "grid size-8 place-items-center rounded-lg transition-colors",
              selected ? "bg-white text-salin-primary shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-salin-muted hover:text-salin-text",
            )}
          >
            <Icon className="size-[17px]" />
          </button>
        );
      })}
    </div>
  );
}

export function FilterBar({ section }: { section: WorkspaceSection }) {
  const type = useUiStore((s) => s.type);
  const modified = useUiStore((s) => s.modified);
  const setType = useUiStore((s) => s.setType);
  const setModified = useUiStore((s) => s.setModified);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
      <SectionMenu section={section} />
      <span aria-hidden="true" className="hidden h-5 w-px bg-[#C9D1CC] sm:block" />
      <div className="order-last flex w-full gap-2 sm:order-none sm:w-auto">
        <FilterChip
          heading="Type"
          label={chipLabel(type, TYPE_OPTIONS, "Type")}
          active={type !== "any"}
          value={type}
          options={TYPE_OPTIONS}
          onChange={setType}
        />
        <FilterChip
          heading="Modified"
          label={chipLabel(modified, MODIFIED_OPTIONS, "Modified")}
          active={modified !== "any"}
          value={modified}
          options={MODIFIED_OPTIONS}
          onChange={setModified}
        />
      </div>
      <div className="ml-auto">
        <ViewToggle />
      </div>
    </div>
  );
}
