/**
 * Workspace Toolbar
 * Top row of the workspace list: the search field and the quick backup &
 * restore button. Moving between Workspace, Recents, Favorites and Trash is
 * the sidebar's job on desktop and the bottom bar's on phones.
 */

import { useLocation } from "react-router";
import { ArchiveRestore, DatabaseBackup, Download, Search, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportWorkspaceBackup } from "@/features/backup/backup-actions";
import { useRestoreBackup } from "@/features/backup/use-restore-backup";
import { DATASETS_LINK, isSectionActive } from "@/features/workspace/section-links";
import { useUiStore } from "@/stores/ui-store";

function SearchField() {
  const query = useUiStore((s) => s.query);
  const setQuery = useUiStore((s) => s.setQuery);
  const onDatasets = isSectionActive(DATASETS_LINK.to, useLocation().pathname);

  return (
    <div role="search" className="relative min-w-0 flex-1">
      <label htmlFor="workspace-search" className="sr-only">
        {onDatasets ? "Search datasets" : "Search files and folders"}
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-salin-subtle" />
      <input
        id="workspace-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        placeholder="Search"
        autoComplete="off"
        className="h-12 w-full rounded-2xl border border-salin-border bg-salin-surface pr-10 pl-10 text-[15px] text-salin-text outline-none placeholder:text-salin-subtle focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setQuery("")}
          className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-salin-subtle hover:bg-salin-tile hover:text-salin-text"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** Quick backup / restore menu that sits beside the search field. */
function BackupMenu() {
  const restore = useRestoreBackup();

  return (
    <>
      {restore.elements}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label="Backup and restore"
          title="Backup and restore"
          className="press grid size-12 shrink-0 place-items-center rounded-2xl border border-salin-border bg-salin-surface text-salin-text outline-none hover:bg-salin-tile focus-visible:ring-3 focus-visible:ring-salin-primary/15 data-[state=open]:border-salin-primary data-[state=open]:text-salin-primary"
        >
          <DatabaseBackup className="size-5" strokeWidth={1.9} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
          <DropdownMenuLabel>Backup & restore</DropdownMenuLabel>
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => void exportWorkspaceBackup()}>
            <Download /> Back up workspace
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={restore.pick}>
            <ArchiveRestore /> Restore from backup…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <p className="px-1.5 py-1 text-xs text-salin-muted">Saves every folder, original file and dataset into one .zip on this device.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function WorkspaceToolbar() {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <SearchField />
      <BackupMenu />
    </div>
  );
}
