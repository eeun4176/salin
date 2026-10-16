import { useMemo } from "react";
import { FolderSearch, Heart, RotateCcwClock, Trash } from "lucide-react";

import { FilterBar } from "@/features/workspace/components/filter-bar";
import { FileCard, FolderCard, ItemRow } from "@/features/workspace/components/item-cards";
import { SortControl } from "@/features/workspace/components/sort-control";
import { groupByDay, selectItems } from "@/features/workspace/query";
import type { WorkspaceItem, WorkspaceSection } from "@/features/workspace/types";
import { useUiStore, type ViewMode } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const gridCols = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4";

const DATE_COLUMN: Record<WorkspaceSection, string> = {
  workspace: "Date modified",
  favorites: "Date modified",
  recents: "Last opened",
  trash: "Date trashed",
};

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

function EmptyState({ section, filtered, onClear }: { section: WorkspaceSection; filtered: boolean; onClear: () => void }) {
  const copy = filtered
    ? { icon: FolderSearch, title: "No matches", body: "Nothing here matches your search or filters." }
    : {
        workspace: { icon: FolderSearch, title: "Your workspace is empty", body: "Scan a document or import files to get started." },
        recents: { icon: RotateCcwClock, title: "No recent files", body: "Files you open or edit will show up here." },
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

/** Contents of the workspace card for one tab: filters, sorter and items. */
export function SectionView({ section }: { section: WorkspaceSection }) {
  const items = useWorkspaceStore((s) => s.items);
  const query = useUiStore((s) => s.query);
  const type = useUiStore((s) => s.type);
  const modified = useUiStore((s) => s.modified);
  const viewMode = useUiStore((s) => s.viewMode);
  const workspaceSort = useUiStore((s) => s.sort);
  const trashSort = useUiStore((s) => s.trashSort);
  const setSort = useUiStore((s) => s.setSort);
  const setTrashSort = useUiStore((s) => s.setTrashSort);

  const sort = section === "trash" ? trashSort : workspaceSort;
  const visible = useMemo(() => selectItems(items, { section, query, type, modified, sort }), [items, section, query, type, modified, sort]);
  const grouped = section === "recents" || (section === "trash" && sort.key === "modified");
  const filtered = query.trim() !== "" || type !== "any" || modified !== "any";

  const clearFilters = () => {
    const ui = useUiStore.getState();
    ui.setQuery("");
    ui.setType("any");
    ui.setModified("any");
  };

  return (
    <div className="mt-5 md:mt-6">
      <FilterBar section={section} />

      {section !== "recents" && (
        <div className="mt-4">
          <SortControl sort={sort} onChange={section === "trash" ? setTrashSort : setSort} dateLabel={section === "trash" ? "Date trashed" : "Date modified"} />
        </div>
      )}

      {section === "trash" && visible.length > 0 && (
        <p className="mt-2 text-xs text-salin-muted">Items in Trash stay on this device until you restore or delete them forever.</p>
      )}

      <div className="mt-4">
        {visible.length === 0 ? (
          <EmptyState section={section} filtered={filtered} onClear={clearFilters} />
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
  );
}
