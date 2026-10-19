/**
 * Document Picker Dialog
 * "New dataset": lists the workspace files Salin can read (PDF, Excel, CSV,
 * text), lets the user tick one or more — their rows are combined, in the
 * order ticked — and starts extraction. An Excel workbook is picked on its
 * own and goes to "Choose tables" first.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { FILE_KIND_META } from "@/components/brand/file-kinds";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isProcessable } from "@/core/processing/parsers";
import { useExtractData } from "@/features/processing/hooks/use-document-processing";
import { folderPath } from "@/features/workspace/mappers";
import { formatBytes } from "@/features/workspace/query";
import { useWorkspaceStore } from "@/stores/workspace-store";

function PickerBody({ onDone }: { onDone: () => void }) {
  const files = useWorkspaceStore((s) => s.files);
  const folderById = useWorkspaceStore((s) => s.folderById);
  const hiddenFolderIds = useWorkspaceStore((s) => s.hiddenFolderIds);
  const extract = useExtractData();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const candidates = useMemo(
    () =>
      files
        .filter((f) => f.deletedAt === null && isProcessable(f.kind) && (f.folderId === null || !hiddenFolderIds.has(f.folderId)))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [files, hiddenFolderIds],
  );
  const shown = candidates.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  // Workbooks need their tables chosen, so they're set up one at a time.
  const workbookMixed = selected.length > 1 && selected.some((id) => candidates.find((f) => f.id === id)?.kind === "xlsx");
  const singleWorkbook = selected.length === 1 && candidates.find((f) => f.id === selected[0])?.kind === "xlsx";

  const start = () => {
    onDone();
    extract(selected);
  };

  if (candidates.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-salin-muted">
        No PDF, Excel, CSV or text files in your workspace yet. Import one, then come back.
      </p>
    );
  }

  return (
    <>
      {candidates.length > 6 && (
        <div className="relative mt-4">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-salin-subtle" />
          <input
            type="search"
            aria-label="Filter documents"
            placeholder="Filter by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full rounded-xl border border-salin-border pr-3 pl-9 text-sm outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15"
          />
        </div>
      )}
      <ul className="mt-3 max-h-[min(22rem,50vh)] divide-y divide-salin-border overflow-y-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent="">
        {shown.map((file) => {
          const order = selected.indexOf(file.id);
          const where = file.folderId === null ? "Workspace" : folderPath(file.folderId, folderById).map((f) => f.name).join(" / ");
          return (
            <li key={file.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-salin-canvas has-[:checked]:bg-salin-primary-soft/60">
                <input type="checkbox" checked={order !== -1} onChange={() => toggle(file.id)} className="size-4 accent-salin-primary" />
                <FileTypeIcon kind={file.kind} showLabel={false} className="size-8 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-salin-text">{file.name}</span>
                  <span className="block truncate text-xs text-salin-muted">
                    {FILE_KIND_META[file.kind].name} · {formatBytes(file.size)} · {where}
                  </span>
                </span>
                {selected.length > 1 && order !== -1 && (
                  <span aria-label={`Combined ${order + 1}${order === 0 ? "st" : order === 1 ? "nd" : order === 2 ? "rd" : "th"}`} className="grid size-6 shrink-0 place-items-center rounded-full bg-salin-primary text-xs font-semibold text-white">
                    {order + 1}
                  </span>
                )}
              </label>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-salin-muted">No documents match "{query}".</li>}
      </ul>
      {workbookMixed && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          Excel workbooks are set up on their own, so you can choose their tables. Pick just the workbook, or only non-Excel files.
        </p>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        <DialogClose className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile">Cancel</DialogClose>
        <button
          type="button"
          disabled={selected.length === 0 || workbookMixed}
          onClick={start}
          className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong disabled:opacity-50"
        >
          {selected.length > 1 ? `Combine ${selected.length} documents` : singleWorkbook ? "Choose tables…" : "Extract data"}
        </button>
      </div>
    </>
  );
}

export function DocumentPickerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>New dataset</DialogTitle>
          <DialogDescription>Choose the documents to turn into a table. Picking several combines their rows.</DialogDescription>
          <PickerBody onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}
