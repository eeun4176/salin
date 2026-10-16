import { useLayoutEffect, useRef, type ChangeEvent } from "react";
import { NavLink, useLocation } from "react-router";
import { ArchiveRestore, DatabaseBackup, Download, Search, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadBackup, readBackup } from "@/features/workspace/backup";
import { SECTION_LINKS } from "@/features/workspace/section-links";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

/** Segmented switcher with a sliding white pill behind the active tab. */
function SectionTabs() {
  const { pathname } = useLocation();
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const pill = pillRef.current;
    if (!list || !pill) return;

    const place = () => {
      const active = list.querySelector<HTMLElement>("[aria-current='page']");
      if (!active) {
        pill.style.opacity = "0";
        return;
      }
      pill.style.opacity = "1";
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <nav aria-label="Workspace sections" className="hidden md:block">
      <div ref={listRef} className="relative flex rounded-2xl bg-salin-tile p-1.5">
        <span
          ref={pillRef}
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 left-0 rounded-xl bg-white shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition-[transform,width] duration-500 ease-spring motion-reduce:transition-none"
        />
        {SECTION_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              cn(
                "relative z-10 flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors lg:px-5",
                isActive ? "text-salin-primary" : "text-salin-muted hover:text-salin-text",
              )
            }
          >
            <Icon className="size-[18px]" strokeWidth={1.9} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function SearchField() {
  const query = useUiStore((s) => s.query);
  const setQuery = useUiStore((s) => s.setQuery);

  return (
    <div role="search" className="relative min-w-0 flex-1">
      <label htmlFor="workspace-search" className="sr-only">
        Search files and folders
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
        className="h-12 w-full rounded-2xl border border-salin-border bg-white pr-10 pl-10 text-[15px] text-salin-text outline-none placeholder:text-salin-subtle focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15 [&::-webkit-search-cancel-button]:hidden"
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
  const fileRef = useRef<HTMLInputElement>(null);

  function backUp() {
    const { items } = useWorkspaceStore.getState();
    downloadBackup(items);
    toast(`Backed up ${items.length} item${items.length === 1 ? "" : "s"}.`);
  }

  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const restored = await readBackup(file);
      const { items: previous, replaceAll } = useWorkspaceStore.getState();
      replaceAll(restored);
      toast(`Restored ${restored.length} item${restored.length === 1 ? "" : "s"} from backup.`, {
        label: "Undo",
        onClick: () => replaceAll(previous),
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't restore that backup.");
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={restore} />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label="Backup and restore"
          title="Backup and restore"
          className="press grid size-12 shrink-0 place-items-center rounded-2xl border border-salin-border bg-white text-salin-text outline-none hover:bg-salin-tile focus-visible:ring-3 focus-visible:ring-salin-primary/15 data-[state=open]:border-salin-primary data-[state=open]:text-salin-primary"
        >
          <DatabaseBackup className="size-5" strokeWidth={1.9} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
          <DropdownMenuLabel>Backup & restore</DropdownMenuLabel>
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={backUp}>
            <Download /> Back up workspace
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5 py-2" onSelect={() => fileRef.current?.click()}>
            <ArchiveRestore /> Restore from backup…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <p className="px-1.5 py-1 text-xs text-salin-muted">Saves folders and file details as a .json file on this device.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function WorkspaceToolbar() {
  return (
    <div className="flex items-center gap-3 md:gap-4">
      <SectionTabs />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SearchField />
        <BackupMenu />
      </div>
    </div>
  );
}
