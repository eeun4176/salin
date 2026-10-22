/**
 * Choice Menu
 * The app's one dropdown for picking a value, so every picker looks and
 * behaves the same as the Type and Modified filters: a trigger (a compact
 * chip, a form field, or a borderless table cell) that opens a radio list
 * with an optional heading and per-option hints. Long lists can be split
 * into labelled groups and get a search box. Keyboard and screen-reader
 * behaviour comes from the Radix dropdown menu.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** Shorter text for the trigger (defaults to the label). */
  short?: string;
  hint?: string;
  /** Heading the option is listed under ("District 1"); options of a group should be next to each other. */
  group?: string;
}

interface ChoiceMenuProps<T extends string> {
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  /** Accessible name of the trigger ("Sort", "Species"). */
  label: string;
  /** Heading inside the menu. */
  heading?: string;
  /** chip: filter-style pill · field: full-width form field · cell: borderless table cell. */
  variant?: "chip" | "field" | "cell";
  /** Chip highlighted (a filter that's switched on). */
  active?: boolean;
  /** Text shown when the value isn't one of the options (e.g. "— Not filled in —"). */
  placeholder?: string;
  /** Shows the trigger as needing attention. */
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Trigger text prefix for chips: "Sort: Last edited". */
  prefix?: string;
  onFocus?: () => void;
  /** A search box on top of the list (it takes focus when the menu opens; ↓ moves into the list). */
  searchable?: boolean;
}

const TRIGGER = {
  chip: "press h-8 shrink-0 gap-1 rounded-lg border px-2.5 text-[13px] font-medium",
  field: "h-10 w-full justify-between gap-2 rounded-xl border bg-salin-surface px-3 text-left text-sm",
  cell: "h-10 w-full min-w-36 justify-between gap-2 bg-transparent px-2.5 text-left text-sm",
};

export function ChoiceMenu<T extends string>({ value, options, onChange, label, heading, variant = "chip", active, placeholder, invalid, disabled, id, className, prefix, onFocus, searchable }: ChoiceMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.value === value);
  const text = current ? (current.short ?? current.label) : (placeholder ?? value);
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.label} ${o.group ?? ""}`.toLowerCase().includes(needle)) : options;
  const groups = [...new Set(shown.map((o) => o.group))];
  // After Radix has focused the opened menu, hand focus to the search box.
  useEffect(() => {
    if (!open || !searchable) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, searchable]);
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DropdownMenuTrigger
        id={id}
        disabled={disabled}
        aria-label={`${label}: ${current?.label ?? placeholder ?? value}`}
        aria-invalid={invalid || undefined}
        onFocus={onFocus}
        className={cn(
          "inline-flex min-w-0 items-center outline-none focus-visible:ring-2 focus-visible:ring-salin-primary disabled:opacity-50",
          TRIGGER[variant],
          variant === "chip" &&
            (active ? "border-salin-primary bg-salin-primary-soft text-salin-primary-ink" : "border-salin-border-strong bg-salin-surface text-salin-text hover:bg-salin-tile"),
          variant === "field" && (invalid ? "border-amber-400 dark:border-amber-400/60" : "border-salin-border hover:border-salin-border-strong data-[state=open]:border-salin-primary"),
          variant === "cell" && (invalid ? "bg-amber-50 dark:bg-amber-400/15" : "hover:bg-salin-tile"),
          !current && variant !== "chip" && "text-salin-subtle",
          variant !== "chip" && current && "text-salin-text",
          className,
        )}
      >
        <span className="truncate">
          {prefix && <span className="text-salin-muted">{prefix} </span>}
          {text}
        </span>
        <ChevronDown aria-hidden="true" className={cn("shrink-0", variant === "chip" ? "size-3.5" : "size-4 text-salin-subtle")} strokeWidth={variant === "chip" ? 2.4 : 2} />
      </DropdownMenuTrigger>
      {/* Above dialogs (z-81), so pickers work inside them too. */}
      <DropdownMenuContent
        align="start"
        className={cn("z-[90] rounded-xl p-1.5", variant === "chip" ? "w-60" : "min-w-(--radix-dropdown-menu-trigger-width)", searchable && "max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] pt-0")}
      >
        {heading && !searchable && <DropdownMenuLabel>{heading}</DropdownMenuLabel>}
        {searchable && (
          <div className="sticky top-0 z-10 -mx-1.5 bg-popover px-1.5 pt-1.5 pb-1">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-salin-subtle" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  e.currentTarget.closest("[role=menu]")?.querySelector<HTMLElement>("[role=menuitemradio]")?.focus();
                } else if (e.key !== "Escape" && e.key !== "Tab") {
                  // Keep letters in the box instead of the menu's jump-to-item typing.
                  e.stopPropagation();
                }
              }}
              aria-label={`Search ${(heading ?? label).toLowerCase()}`}
              placeholder={`Search ${(heading ?? label).toLowerCase()}`}
              autoComplete="off"
              className="h-9 w-full rounded-lg border border-salin-border bg-salin-surface pr-2 pl-8 text-sm text-salin-text outline-none placeholder:text-salin-subtle focus:border-salin-primary focus:ring-4 focus:ring-salin-primary/20"
            />
          </div>
        )}
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {groups.map((group) => (
            <Fragment key={group ?? ""}>
              {group && <DropdownMenuLabel className="mt-1 flex items-center gap-2 text-xs font-semibold text-salin-primary-ink after:h-px after:flex-1 after:bg-salin-border">{group}</DropdownMenuLabel>}
              {shown
                .filter((o) => o.group === group)
                .map((o) => (
                  <DropdownMenuRadioItem key={o.value} value={o.value} className="py-2">
                    <span className="min-w-0">
                      <span className="block">{o.label}</span>
                      {o.hint && <span className="block text-xs text-salin-muted">{o.hint}</span>}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
        {shown.length === 0 && <p className="px-2 py-3 text-sm text-salin-muted">No matches for “{query.trim()}”.</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
