/**
 * Choice Menu
 * The app's one dropdown for picking a value, so every picker looks and
 * behaves the same as the Type and Modified filters: a trigger (a compact
 * chip, a form field, or a borderless table cell) that opens a radio list
 * with an optional heading and per-option hints. Keyboard and screen-reader
 * behaviour comes from the Radix dropdown menu.
 */

import { ChevronDown } from "lucide-react";

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
}

const TRIGGER = {
  chip: "press h-8 shrink-0 gap-1 rounded-lg border px-2.5 text-[13px] font-medium",
  field: "h-10 w-full justify-between gap-2 rounded-xl border bg-salin-surface px-3 text-left text-sm",
  cell: "h-10 w-full min-w-36 justify-between gap-2 bg-transparent px-2.5 text-left text-sm",
};

export function ChoiceMenu<T extends string>({ value, options, onChange, label, heading, variant = "chip", active, placeholder, invalid, disabled, id, className, prefix, onFocus }: ChoiceMenuProps<T>) {
  const current = options.find((o) => o.value === value);
  const text = current ? (current.short ?? current.label) : (placeholder ?? value);
  return (
    <DropdownMenu modal={false}>
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
      <DropdownMenuContent align="start" className={cn("z-[90] rounded-xl p-1.5", variant === "chip" ? "w-60" : "min-w-(--radix-dropdown-menu-trigger-width)")}>
        {heading && <DropdownMenuLabel>{heading}</DropdownMenuLabel>}
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="py-2">
              <span className="min-w-0">
                <span className="block">{o.label}</span>
                {o.hint && <span className="block text-xs text-salin-muted">{o.hint}</span>}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
