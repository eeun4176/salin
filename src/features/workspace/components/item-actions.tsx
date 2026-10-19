/**
 * Item Actions Menu
 * The ⋮ overflow menu on every folder/file card and list row: Extract data
 * (PDF, Excel, CSV, text), Read text (OCR — photos and PDFs), Download, Rename, Move to…, Make a copy, Favorite
 * and Move to trash — or, in Trash,
 * Restore and Delete forever (with confirmation).
 */

import { useState } from "react";
import { ArchiveRestore, Copy, Download, EllipsisVertical, FolderInput, Heart, HeartOff, Pencil, ScanText, Table2, Trash, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { isProcessable } from "@/core/processing/parsers";
import { useStartScan } from "@/features/ocr/hooks/use-start-scan";
import { OCR_KINDS } from "@/features/ocr/ocr-actions";
import { useExtractData } from "@/features/processing/hooks/use-document-processing";
import { NameDialog } from "@/components/common/name-dialog";
import { FolderPickerDialog } from "@/features/workspace/components/folder-picker-dialog";
import type { WorkspaceItem } from "@/features/workspace/types";
import { siblingNameValidator } from "@/features/workspace/use-open-item";
import {
  deleteItemForever,
  downloadItem,
  duplicateItem,
  moveItem,
  renameItem,
  restoreItem,
  toggleFavorite,
  trashItem,
} from "@/features/workspace/workspace-actions";
import { cn } from "@/lib/utils";

type DialogKind = "rename" | "move" | "delete" | null;

/** Three-dot overflow menu for a folder or file card. */
export function ItemActions({ item, className }: { item: WorkspaceItem; className?: string }) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const extract = useExtractData();
  const trashed = item.deletedAt !== null;
  const processable = item.kind === "file" && isProcessable(item.fileType);
  const readable = item.kind === "file" && item.fileType !== undefined && OCR_KINDS.has(item.fileType);
  const startScan = useStartScan();
  const noun = item.kind === "folder" ? "folder" : "file";
  const close = (open: boolean) => !open && setDialog(null);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`More actions for ${item.name}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            "pointer-events-auto grid size-8 shrink-0 place-items-center rounded-lg text-salin-text outline-none hover:bg-black/[0.06] focus-visible:ring-2 focus-visible:ring-salin-primary data-[state=open]:bg-black/[0.06]",
            className,
          )}
        >
          <EllipsisVertical className="size-[18px]" strokeWidth={2.2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5" onClick={(e) => e.stopPropagation()}>
          {trashed ? (
            <>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => void restoreItem(item)}>
                <ArchiveRestore /> Restore
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="gap-2.5 py-2" onSelect={() => setDialog("delete")}>
                <X /> Delete forever
              </DropdownMenuItem>
            </>
          ) : (
            <>
              {processable && (
                <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => extract([item.id])}>
                  <Table2 /> Extract data
                </DropdownMenuItem>
              )}
              {readable && (
                <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => void startScan([item.id])}>
                  <ScanText /> Read text (OCR)
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => void downloadItem(item)}>
                <Download /> Download
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => setDialog("rename")}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => setDialog("move")}>
                <FolderInput /> Move to…
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => void duplicateItem(item)}>
                <Copy /> Make a copy
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => void toggleFavorite(item)}>
                {item.isFavorite ? <HeartOff /> : <Heart />}
                {item.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="gap-2.5 py-2" onSelect={() => void trashItem(item)}>
                <Trash /> Move to trash
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={dialog === "rename"}
        onOpenChange={close}
        title={`Rename ${noun}`}
        initialValue={item.name}
        confirmLabel="Rename"
        selectBaseName={item.kind === "file"}
        validate={siblingNameValidator(item.kind, item.parentId, item.id)}
        onSubmit={async (name) => {
          await renameItem(item, name);
          setDialog(null);
        }}
      />

      <FolderPickerDialog
        open={dialog === "move"}
        onOpenChange={close}
        title={`Move “${item.name}”`}
        confirmLabel="Move here"
        initialFolderId={item.parentId}
        currentFolderId={item.parentId}
        excludeIds={item.kind === "folder" ? [item.id] : []}
        onConfirm={async (folderId) => {
          if (await moveItem(item, folderId)) setDialog(null);
        }}
      />

      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={`Delete “${item.name}” forever?`}
        description={
          item.kind === "folder"
            ? "This folder and everything inside it will be permanently removed from this device. This can't be undone."
            : "This file will be permanently removed from this device. This can't be undone."
        }
        confirmLabel="Delete forever"
        destructive
        onConfirm={() => deleteItemForever(item)}
      />
    </>
  );
}
