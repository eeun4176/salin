/**
 * Owner Name Input
 * A name box that suggests owners this phone already knows (census, the
 * program request, stubs) as the paravet types. Picking one — tap, or ↓ and
 * Enter — hands its details back so the form fills in the mobile number and
 * pets. Suggestions load from the device, so they work offline.
 */

import { useId, useState, type InputHTMLAttributes } from "react";

import { suggestOwners, type OwnerSuggestion } from "@/core/programs/owner-suggestions";
import { cn } from "@/lib/utils";

interface OwnerNameInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  owners: OwnerSuggestion[];
  onPick?: (owner: OwnerSuggestion) => void;
}

export function OwnerNameInput({ value, onChange, owners, onPick, className, onKeyDown, onBlur, ...input }: OwnerNameInputProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = open ? suggestOwners(owners, value) : [];

  function pick(owner: OwnerSuggestion) {
    onChange(owner.name);
    onPick?.(owner);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
      <input
        {...input}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (matches.length && event.key === "ArrowDown") setActive((i) => (i + 1) % matches.length);
          else if (matches.length && event.key === "ArrowUp") setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
          else if (matches.length && event.key === "Escape") setOpen(false);
          else if (matches[active] && event.key === "Enter") pick(matches[active]);
          else return onKeyDown?.(event);
          event.preventDefault();
        }}
        onBlur={(event) => {
          setOpen(false);
          onBlur?.(event);
        }}
        className={className}
      />
      {matches.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Owners you've met before" className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl bg-salin-surface p-1 shadow-lg ring-1 ring-salin-border">
          {matches.map((owner, index) => (
            <li
              key={owner.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Keep focus in the input so the pick lands before blur closes the list.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(owner)}
              className={cn("cursor-pointer rounded-lg px-3 py-2", index === active ? "bg-salin-tile" : "hover:bg-salin-tile")}
            >
              <span className="block truncate text-sm font-medium text-salin-text">{owner.name}</span>
              <span className="block truncate text-xs text-salin-muted">
                {[owner.source, owner.mobile, owner.pets.length ? owner.pets.map((p) => p.name).join(", ") : ""].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
