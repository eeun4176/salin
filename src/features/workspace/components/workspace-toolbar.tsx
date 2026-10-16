import { useLayoutEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { Search, X } from "lucide-react";

import { SECTION_LINKS } from "@/features/workspace/section-links";
import { useUiStore } from "@/stores/ui-store";
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
    <div role="search" className="relative w-full md:max-w-[17rem] lg:max-w-xs">
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

export function WorkspaceToolbar() {
  return (
    <div className="flex items-center justify-between gap-4">
      <SectionTabs />
      <SearchField />
    </div>
  );
}
