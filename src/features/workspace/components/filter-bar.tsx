/**
 * Filter Bar
 * The row above the items: the section/folder title menu (New Folder, Upload
 * a File, Upload a Folder, or Empty trash), the Type and Modified filter
 * chips, and the list/grid toggle.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, FileUp, FolderPlus, FolderUp, LayoutGrid, List, Trash } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChoiceMenu, type Choice } from "@/components/common/choice-menu";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { NameDialog } from "@/components/common/name-dialog";
import { useFilePicker, useUploadToFolder } from "@/features/import/use-file-picker";
import type { WorkspaceSection } from "@/features/workspace/types";
import { folderUrl, siblingNameValidator } from "@/features/workspace/use-open-item";
import { createFolder, emptyTrash } from "@/features/workspace/workspace-actions";
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

const TYPE_OPTIONS: Choice<TypeFilter>[] = [
  { value: "any", label: "Any type", short: "Type" },
  { value: "folders", label: "Folders" },
  { value: "pdf", label: "PDFs" },
  { value: "spreadsheets", label: "Spreadsheets (XLSX, CSV)", short: "Spreadsheets" },
  { value: "images", label: "Images (PNG, JPG, WebP)", short: "Images" },
];

const MODIFIED_OPTIONS: Choice<ModifiedFilter>[] = [
  { value: "any", label: "Any time", short: "Modified" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "year", label: `This year (${new Date().getFullYear()})`, short: "This year" },
  { value: "lastYear", label: `Last year (${new Date().getFullYear() - 1})`, short: "Last year" },
];



/** "Workspace ˅" (or folder name) title menu: new folder / upload files / upload a folder — or empty trash. */
function SectionMenu({ section, folderId }: { section: WorkspaceSection; folderId: string | null }) {
  const [dialog, setDialog] = useState<"create" | "empty" | null>(null);
  const navigate = useNavigate();
  const trashCount = useWorkspaceStore((s) => s.items.filter((i) => i.deletedAt !== null).length);
  const folderName = useWorkspaceStore((s) => (folderId ? s.folderById.get(folderId)?.name : undefined));
  // Uploads from other tabs go to the top level of the workspace.
  const upload = useUploadToFolder(folderId);
  const { inputs, pickFiles, pickFolder } = useFilePicker((files) => void upload(files));
  const title = folderName ?? SECTION_TITLES[section];

  return (
    <>
      {inputs}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger data-testid="section-menu" className="press -ml-1.5 inline-flex h-10 max-w-full min-w-0 items-center gap-1.5 rounded-xl px-1.5 text-[22px] font-semibold tracking-[-0.02em] text-salin-text outline-none hover:bg-salin-tile @2xl:text-2xl">
          <span className="truncate">{title}</span>
          <ChevronDown className="size-5 shrink-0" strokeWidth={2.2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 rounded-xl p-1.5">
          {section === "trash" ? (
            <DropdownMenuItem variant="destructive" disabled={trashCount === 0} className="gap-2.5 py-2" onSelect={() => setDialog("empty")}>
              <Trash /> Empty trash
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => setDialog("create")}>
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
        open={dialog === "create"}
        onOpenChange={(open) => setDialog(open ? "create" : null)}
        title="New folder"
        initialValue="Untitled folder"
        confirmLabel="Create"
        validate={siblingNameValidator("folder", folderId)}
        onSubmit={async (name) => {
          const folder = await createFolder(name, folderId);
          setDialog(null);
          toast(`Folder “${folder.name}” created.`, { label: "Open", onClick: () => navigate(folderUrl(folder.id)) });
        }}
      />

      <ConfirmDialog
        open={dialog === "empty"}
        onOpenChange={(open) => setDialog(open ? "empty" : null)}
        title="Empty Trash?"
        description={`${trashCount} item${trashCount === 1 ? "" : "s"} in Trash, including everything inside trashed folders, will be permanently removed from this device. This can't be undone.`}
        confirmLabel="Empty trash"
        destructive
        onConfirm={emptyTrash}
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
              selected ? "bg-salin-surface text-salin-primary shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-salin-muted hover:text-salin-text",
            )}
          >
            <Icon className="size-[17px]" />
          </button>
        );
      })}
    </div>
  );
}

export function FilterBar({ section, folderId }: { section: WorkspaceSection; folderId: string | null }) {
  const type = useUiStore((s) => s.type);
  const modified = useUiStore((s) => s.modified);
  const setType = useUiStore((s) => s.setType);
  const setModified = useUiStore((s) => s.setModified);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
      <SectionMenu section={section} folderId={folderId} />
      <span aria-hidden="true" className="hidden h-5 w-px bg-salin-border-strong @xl:block" />
      <div className="order-last flex w-full gap-2 @xl:order-none @xl:w-auto">
        <ChoiceMenu heading="Type" label="Type" active={type !== "any"} value={type} options={TYPE_OPTIONS} onChange={setType} />
        <ChoiceMenu heading="Modified" label="Modified" active={modified !== "any"} value={modified} options={MODIFIED_OPTIONS} onChange={setModified} />
      </div>
      <div className="ml-auto">
        <ViewToggle />
      </div>
    </div>
  );
}
