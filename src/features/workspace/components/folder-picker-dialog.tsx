/**
 * Folder Picker Dialog
 * Lets the user browse the folder tree and choose a destination — used by
 * "Move to…", and by "Save to Workspace" on the Import and Scan screens.
 * Folders that can't be chosen (the folder being moved and its subfolders)
 * are left out.
 */

import { useMemo, useState } from "react";
import { ChevronRight, Folder, House } from "lucide-react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { folderPath } from "@/features/workspace/mappers";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  /** Folder the picker opens in (`null` = top level). */
  initialFolderId?: string | null;
  /** Folder ids that can't be entered or chosen (a moved folder itself). */
  excludeIds?: string[];
  /** The destination currently holding the item; choosing it again is disabled. */
  currentFolderId?: string | null;
  onConfirm: (folderId: string | null) => void | Promise<unknown>;
}

function PickerBody({ initialFolderId = null, excludeIds = [], currentFolderId, confirmLabel, onConfirm }: Omit<FolderPickerDialogProps, "open" | "onOpenChange" | "title">) {
  const folders = useWorkspaceStore((s) => s.folders);
  const folderById = useWorkspaceStore((s) => s.folderById);
  const hidden = useWorkspaceStore((s) => s.hiddenFolderIds);
  const [location, setLocation] = useState<string | null>(initialFolderId && !hidden.has(initialFolderId) ? initialFolderId : null);
  const [busy, setBusy] = useState(false);

  const children = useMemo(
    () =>
      folders
        .filter((f) => f.parentFolderId === location && !hidden.has(f.id) && !excludeIds.includes(f.id))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })),
    [folders, location, hidden, excludeIds],
  );
  const path = folderPath(location, folderById);
  const unchanged = currentFolderId !== undefined && currentFolderId === location;

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(location);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <nav aria-label="Folder location" className="no-scrollbar mt-3 flex items-center gap-1 overflow-x-auto text-[13px] whitespace-nowrap" data-lenis-prevent="">
        <button type="button" onClick={() => setLocation(null)} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-salin-muted hover:bg-salin-tile hover:text-salin-text">
          <House className="size-3.5" /> Workspace
        </button>
        {path.map((folder) => (
          <span key={folder.id} className="flex items-center gap-1">
            <ChevronRight aria-hidden="true" className="size-3.5 text-salin-subtle" />
            <button
              type="button"
              onClick={() => setLocation(folder.id)}
              aria-current={folder.id === location ? "location" : undefined}
              className="max-w-40 truncate rounded-md px-1.5 py-1 font-medium text-salin-muted hover:bg-salin-tile hover:text-salin-text aria-[current=location]:text-salin-text"
            >
              {folder.name}
            </button>
          </span>
        ))}
      </nav>

      <ul className="mt-2 max-h-72 min-h-32 overflow-y-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent="">
        {children.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-salin-muted">No folders here</li>
        ) : (
          children.map((folder) => (
            <li key={folder.id} className="border-b border-salin-border/70 last:border-b-0">
              <button
                type="button"
                onClick={() => setLocation(folder.id)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-salin-tile"
              >
                <Folder className="size-[18px] shrink-0 text-salin-muted" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate font-medium text-salin-text">{folder.name}</span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-salin-subtle" />
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="mt-5 flex items-center justify-end gap-2">
        <DialogClose className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile">Cancel</DialogClose>
        <button
          type="button"
          disabled={busy || unchanged}
          onClick={confirm}
          className={cn("press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-[#019A53] disabled:opacity-50")}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </>
  );
}

export function FolderPickerDialog({ open, onOpenChange, title, ...body }: FolderPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-w-md">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose a folder. Open a folder to look inside it.</DialogDescription>
          <PickerBody {...body} />
        </DialogContent>
      )}
    </Dialog>
  );
}
