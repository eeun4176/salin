/**
 * Select (Radix)
 * An accessible, styled replacement for the native <select>: a trigger
 * button showing the chosen option and a popover list whose options can
 * carry a second line of explanation (e.g. which column names a header
 * choice produces). Keyboard and screen-reader support come from Radix.
 */

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-salin-border bg-salin-surface px-3 text-left text-sm text-salin-text outline-none",
        "hover:border-salin-border-strong focus-visible:border-salin-primary focus-visible:ring-3 focus-visible:ring-salin-primary/15 data-[state=open]:border-salin-primary",
        "data-[placeholder]:text-salin-subtle [&>span]:min-w-0 [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 shrink-0 text-salin-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        className={cn(
          "z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-xl bg-salin-surface p-1.5 text-salin-text shadow-[0_12px_32px_-12px_rgb(16_40_28/0.35)] ring-1 ring-salin-border",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** An option; `description` adds a muted second line. */
export function SelectItem({ className, children, description, ...props }: React.ComponentProps<typeof SelectPrimitive.Item> & { description?: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-default flex-col rounded-lg py-2 pr-8 pl-2.5 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-salin-tile data-[state=checked]:bg-salin-primary-soft",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {description && <span className="mt-0.5 line-clamp-2 text-xs text-salin-muted">{description}</span>}
      <SelectPrimitive.ItemIndicator className="absolute top-2.5 right-2.5">
        <CheckIcon className="size-4 text-salin-primary" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
