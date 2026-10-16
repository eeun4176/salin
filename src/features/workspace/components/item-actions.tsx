import { useState } from "react";
import { ArchiveRestore, Copy, Download, EllipsisVertical, Heart, HeartOff, Pencil, Trash, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NameDialog } from "@/components/common/name-dialog";
import type { WorkspaceItem } from "@/features/workspace/types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

/** Three-dot overflow menu for a folder or file card. */
export function ItemActions({ item, className }: { item: WorkspaceItem; className?: string }) {
  const [renaming, setRenaming] = useState(false);
  const { rename, duplicate, toggleFavorite, moveToTrash, restore, deleteForever } = useWorkspaceStore.getState();
  const trashed = item.deletedAt !== null;
  const noun = item.kind === "folder" ? "Folder" : "File";

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
              <DropdownMenuItem
                className="gap-2.5 py-2"
                onSelect={() => {
                  restore(item.id);
                  toast(`Restored “${item.name}”.`);
                }}
              >
                <ArchiveRestore /> Restore
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="gap-2.5 py-2"
                onSelect={() => {
                  deleteForever(item.id);
                  toast(`“${item.name}” deleted forever.`);
                }}
              >
                <X /> Delete forever
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem
                className="gap-2.5 py-2"
                onSelect={() => toast("Sample item — downloads arrive with local file storage in Phase 2.")}
              >
                <Download /> Download
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => setRenaming(true)}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2.5 py-2"
                onSelect={() => {
                  duplicate(item.id);
                  toast(`Made a copy of “${item.name}”.`);
                }}
              >
                <Copy /> Make a copy
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => toggleFavorite(item.id)}>
                {item.isFavorite ? <HeartOff /> : <Heart />}
                {item.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="gap-2.5 py-2"
                onSelect={() => {
                  moveToTrash(item.id);
                  toast(`${noun} moved to Trash.`, { label: "Undo", onClick: () => restore(item.id) });
                }}
              >
                <Trash /> Move to trash
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={`Rename ${noun.toLowerCase()}`}
        initialValue={item.name}
        confirmLabel="Rename"
        onSubmit={(name) => {
          rename(item.id, name);
          setRenaming(false);
        }}
      />
    </>
  );
}
