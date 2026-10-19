/**
 * Section View
 * The body of the workspace card for one tab — Workspace (including any
 * open folder at /folders/:folderId), Recents, Favorites or Trash. Renders
 * breadcrumbs, filters, the sorter and the items, plus loading, error,
 * empty and "folder not found" states. On phones the top level also links
 * to Datasets.
 */

import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { ChevronRight, FolderOpen, FolderSearch, Heart, House, RotateCcw, RotateCcwClock, Table2, Trash, TriangleAlert } from "lucide-react";

import { useDatasets } from "@/features/processing/hooks/use-datasets";
import { FilterBar } from "@/features/workspace/components/filter-bar";
import { FileCard, FolderCard, ItemRow } from "@/features/workspace/components/item-cards";
import { SortControl } from "@/features/workspace/components/sort-control";
import { folderPath } from "@/features/workspace/mappers";
import { groupByDay, selectItems } from "@/features/workspace/query";
import type { WorkspaceItem, WorkspaceSection } from "@/features/workspace/types";
import { folderUrl } from "@/features/workspace/use-open-item";
import { useUiStore, type ViewMode } from "@/stores/ui-store";
import { startWorkspaceSync, useWorkspaceStore } from "@/stores/workspace-store";

const gridCols = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4";

const DATE_COLUMN: Record<WorkspaceSection, string> = {
  workspace: "Date modified",
  favorites: "Date modified",
  recents: "Last opened",
  trash: "Date trashed",
};

/** Phones have no tab switcher in the card, so the workspace top level links to Datasets here. */
function DatasetsEntry() {
  const state = useDatasets();
  const count = state.status === "ready" ? state.datasets.length : 0;
  return (
    <Link
      to="/datasets"
      className="press mt-4 flex items-center gap-3 rounded-2xl bg-salin-primary-soft px-3.5 py-3 text-salin-text md:hidden"
    >
      <Table2 aria-hidden="true" className="size-5 shrink-0 text-salin-primary" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Datasets</span>
        <span className="block truncate text-xs text-salin-muted">
          {count ? `${count} saved · tables extracted from your files` : "Turn PDF, Excel, CSV or text files into tables"}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-salin-muted" />
    </Link>
  );
}

function ItemsBlock({
  items,
  section,
  viewMode,
  foldersFirst,
}: {
  items: WorkspaceItem[];
  section: WorkspaceSection;
  viewMode: ViewMode;
  foldersFirst: boolean;
}) {
  if (viewMode === "list") {
    return (
      <div role="table" aria-label="Items" className="-mx-3">
        <div role="row" className="hidden grid-cols-[minmax(0,1fr)_9rem_6rem_auto] gap-3 px-3 pb-1 text-xs font-medium text-salin-subtle sm:grid">
          <span role="columnheader">Name</span>
          <span role="columnheader">{DATE_COLUMN[section]}</span>
          <span role="columnheader">Size</span>
          <span role="columnheader" className="w-8">
            <span className="sr-only">Actions</span>
          </span>
        </div>
        <div role="rowgroup" className="divide-y divide-salin-border/70">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} section={section} />
          ))}
        </div>
      </div>
    );
  }

  if (!foldersFirst) {
    return (
      <div className={gridCols}>
        {items.map((item) => (
          <FileCard key={item.id} item={item} />
        ))}
      </div>
    );
  }

  const folders = items.filter((i) => i.kind === "folder");
  const files = items.filter((i) => i.kind === "file");
  return (
    <div className="space-y-4">
      {folders.length > 0 && (
        <div className={gridCols}>
          {folders.map((item) => (
            <FolderCard key={item.id} item={item} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className={gridCols}>
          {files.map((item) => (
            <FileCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ section, filtered, inFolder, onClear }: { section: WorkspaceSection; filtered: boolean; inFolder: boolean; onClear: () => void }) {
  const copy = filtered
    ? { icon: FolderSearch, title: "No matches", body: "Nothing here matches your search or filters." }
    : inFolder
      ? { icon: FolderOpen, title: "This folder is empty", body: "Use the folder menu above to add a subfolder or upload files." }
      : {
          workspace: { icon: FolderSearch, title: "Your workspace is empty", body: "Scan a document or import files to get started." },
          recents: { icon: RotateCcwClock, title: "No recent files", body: "Files you open will show up here." },
          favorites: { icon: Heart, title: "No favorites yet", body: "Use ⋮ → Add to Favorites on any file or folder." },
          trash: { icon: Trash, title: "Trash is empty", body: "Deleted items stay here until you remove them for good." },
        }[section];
  const Icon = copy.icon;

  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
        <Icon className="size-6" />
      </span>
      <p className="mt-4 font-semibold text-salin-text">{copy.title}</p>
      <p className="mt-1 max-w-xs text-sm text-salin-muted">{copy.body}</p>
      {filtered && (
        <button type="button" onClick={onClear} className="press mt-4 h-9 rounded-xl px-4 text-sm font-semibold text-salin-primary ring-1 ring-salin-border hover:bg-salin-primary-soft">
          Clear filters
        </button>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div role="status" aria-label="Loading workspace" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 md:mt-6">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="aspect-[5/4.6] animate-pulse rounded-2xl bg-salin-tile motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </span>
      <p className="mt-4 font-semibold text-salin-text">Workspace unavailable</p>
      <p className="mt-1 max-w-sm text-sm text-salin-muted">{message}</p>
      <button type="button" onClick={startWorkspaceSync} className="press mt-4 inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-salin-primary ring-1 ring-salin-border hover:bg-salin-primary-soft">
        <RotateCcw className="size-4" /> Try again
      </button>
    </div>
  );
}

function Breadcrumbs({ folderId }: { folderId: string }) {
  const folderById = useWorkspaceStore((s) => s.folderById);
  const path = folderPath(folderId, folderById);
  return (
    <nav aria-label="Breadcrumb" className="no-scrollbar mt-5 -mb-2 overflow-x-auto md:mt-6" data-lenis-prevent-horizontal="">
      <ol className="flex items-center gap-1 text-[13px] whitespace-nowrap">
        <li>
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-salin-muted hover:bg-salin-tile hover:text-salin-text">
            <House className="size-3.5" /> Workspace
          </Link>
        </li>
        {path.map((folder, i) => {
          const current = i === path.length - 1;
          return (
            <li key={folder.id} className="flex items-center gap-1">
              <ChevronRight aria-hidden="true" className="size-3.5 text-salin-subtle" />
              {current ? (
                <span aria-current="page" className="max-w-48 truncate px-1.5 py-1 font-semibold text-salin-text">
                  {folder.name}
                </span>
              ) : (
                <Link to={folderUrl(folder.id)} className="max-w-40 truncate rounded-md px-1.5 py-1 font-medium text-salin-muted hover:bg-salin-tile hover:text-salin-text">
                  {folder.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FolderMissing() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-salin-tile text-salin-muted">
        <FolderSearch className="size-6" />
      </span>
      <p className="mt-4 font-semibold text-salin-text">Folder not found</p>
      <p className="mt-1 max-w-xs text-sm text-salin-muted">It may have been deleted or moved to Trash.</p>
      <Link to="/" className="press mt-4 inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold text-salin-primary ring-1 ring-salin-border hover:bg-salin-primary-soft">
        Back to Workspace
      </Link>
    </div>
  );
}

/** Contents of the workspace card for one tab: filters, sorter and items. */
export function SectionView({ section }: { section: WorkspaceSection }) {
  const { folderId: routeFolderId } = useParams();
  const folderId = section === "workspace" ? (routeFolderId ?? null) : null;

  const status = useWorkspaceStore((s) => s.status);
  const error = useWorkspaceStore((s) => s.error);
  const items = useWorkspaceStore((s) => s.items);
  const hiddenFolderIds = useWorkspaceStore((s) => s.hiddenFolderIds);
  const folderExists = useWorkspaceStore((s) => folderId === null || (s.folderById.has(folderId) && !s.hiddenFolderIds.has(folderId)));
  const query = useUiStore((s) => s.query);
  const type = useUiStore((s) => s.type);
  const modified = useUiStore((s) => s.modified);
  const viewMode = useUiStore((s) => s.viewMode);
  const workspaceSort = useUiStore((s) => s.sort);
  const trashSort = useUiStore((s) => s.trashSort);
  const setSort = useUiStore((s) => s.setSort);
  const setTrashSort = useUiStore((s) => s.setTrashSort);

  const sort = section === "trash" ? trashSort : workspaceSort;
  const grouped = section === "recents" || (section === "trash" && sort.key === "modified");
  // Day groups need a purely chronological list (folders-first would split a day into
  // two groups); ItemsBlock still puts folders on top inside each group.
  const visible = useMemo(
    () =>
      selectItems(items, {
        section,
        query,
        type,
        modified,
        sort: grouped ? { ...sort, foldersFirst: false } : sort,
        folderId,
        hiddenFolderIds,
      }),
    [items, section, query, type, modified, sort, grouped, folderId, hiddenFolderIds],
  );
  const filtered = query.trim() !== "" || type !== "any" || modified !== "any";
  const searchingEverywhere = section === "workspace" && query.trim() !== "";

  const clearFilters = () => {
    const ui = useUiStore.getState();
    ui.setQuery("");
    ui.setType("any");
    ui.setModified("any");
  };

  if (status === "loading") return <LoadingState />;
  if (status === "error") return <ErrorState message={error ?? "Something went wrong."} />;
  if (!folderExists) return <FolderMissing />;

  return (
    <div>
      {folderId !== null && <Breadcrumbs folderId={folderId} />}
      <div className="mt-5 md:mt-6">
        <FilterBar section={section} folderId={folderId} />
        {section === "workspace" && folderId === null && <DatasetsEntry />}

        {section !== "recents" && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <SortControl sort={sort} onChange={section === "trash" ? setTrashSort : setSort} dateLabel={section === "trash" ? "Date trashed" : "Date modified"} />
            {searchingEverywhere && <p className="text-xs text-salin-muted">Searching all folders</p>}
          </div>
        )}

        {section === "trash" && visible.length > 0 && (
          <p className="mt-2 text-xs text-salin-muted">Items in Trash stay on this device until you restore or delete them forever.</p>
        )}

        <div className="mt-4">
          {visible.length === 0 ? (
            <EmptyState section={section} filtered={filtered} inFolder={folderId !== null} onClear={clearFilters} />
          ) : grouped ? (
            <div className="space-y-6">
              {groupByDay(visible, section).map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h3 className="mb-3 text-[13px] font-semibold text-salin-text">{group.label}</h3>
                  <ItemsBlock items={group.items} section={section} viewMode={viewMode} foldersFirst={sort.foldersFirst} />
                </section>
              ))}
            </div>
          ) : (
            <ItemsBlock items={visible} section={section} viewMode={viewMode} foldersFirst={sort.foldersFirst} />
          )}
        </div>
      </div>
    </div>
  );
}
