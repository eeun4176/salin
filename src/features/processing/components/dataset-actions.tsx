/**
 * Dataset Actions Menu
 * The ⋮ menu on each dataset in the Datasets list: open for review, export
 * as CSV / Excel / JSON, rename, and delete (with Undo in the toast).
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { Download, EllipsisVertical, PencilLine, Table2, Trash2 } from "lucide-react";

import { NameDialog } from "@/components/common/name-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { validateName } from "@/core/storage/names";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { deleteDataset, downloadSavedDataset, EXPORT_FORMATS, renameDataset } from "@/features/processing/processing-actions";
import { cn } from "@/lib/utils";
import type { Dataset } from "@/types/processing";

export function DatasetActions({ dataset, className }: { dataset: Dataset; className?: string }) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={`More actions for ${dataset.name}`}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg text-salin-muted outline-none hover:bg-salin-surface hover:text-salin-text focus-visible:ring-2 focus-visible:ring-salin-primary data-[state=open]:bg-salin-surface",
            className,
          )}
        >
          <EllipsisVertical className="size-[18px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => navigate(datasetUrl(dataset.id))}>
            <Table2 /> Open
          </DropdownMenuItem>
          {EXPORT_FORMATS.map(({ format, label }) => (
            <DropdownMenuItem key={format} className="gap-2.5 py-2" onSelect={() => void downloadSavedDataset(dataset.id, format)}>
              <Download /> Export as {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => setRenaming(true)}>
            <PencilLine /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="gap-2.5 py-2" onSelect={() => void deleteDataset(dataset.id)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename dataset"
        initialValue={dataset.name}
        confirmLabel="Rename"
        validate={(name) => validateName(name, [])}
        onSubmit={(name) => renameDataset(dataset.id, name)}
      />
    </>
  );
}
